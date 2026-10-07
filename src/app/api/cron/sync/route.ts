import { isAuthorizedCron } from '@/lib/cron';
import { db, hasDatabase } from '@/lib/db';
import { jobsLog } from '@/lib/db/schema';
import { expireCandidates } from '@/lib/inbox/candidates';
import { FORCE_COOLDOWN_MS, syncIcsFeeds } from '@/lib/inbox/sync-ics';
import { describeError } from '@/lib/log-safe';
import { purgeOldUnsubscribed, purgeStalePending } from '@/lib/subscribers/service';

// 13:00 UTC daily: pull the three private ICS feeds into the candidate inbox and expire rows that
// ended more than 7 days ago. Opening /admin/inbox also syncs (10-minute cooldown). Also deletes
// newsletter sign-ups left unconfirmed for 7 days (guide「待确认」) and rows unsubscribed for more
// than a year, with their send history (DESIGN D3 retention; suppressed rows are kept).
export const maxDuration = 60;

export async function GET(req: Request) {
  if (!isAuthorizedCron(req)) return new Response(null, { status: 401 });
  if (!hasDatabase()) return Response.json({ ok: true, job: 'sync', skipped: 'no_database' });
  const result = await syncIcsFeeds({ cooldownMs: FORCE_COOLDOWN_MS });
  // Expiry still runs when no feed is configured or another run holds the lock.
  const expired = result.ran ? result.expired : await expireCandidates();
  const purge = await purgePending();
  const retention = await purgeUnsubscribed();
  return Response.json({
    ok: (!result.ran || result.feeds.every((f) => f.ok)) && purge !== null && retention !== null,
    job: 'sync',
    ...(result.ran ? { feeds: result.feeds } : { skipped: result.reason }),
    expired,
    pending_purged: purge?.deleted ?? null,
    pending_reverted: purge?.reverted ?? null,
    unsubscribed_purged: retention?.deleted ?? null,
  });
}

const purgePending = () => logged('subscribers_purge', 'subscribers purge', purgeStalePending);
const purgeUnsubscribed = () => logged('subscribers_retention', 'subscribers retention', purgeOldUnsubscribed);

/**
 * Each subscriber cleanup gets its own jobs_log row, written on failure too so monitoring sees it.
 * A failure never hides the inbox result or the other cleanup: it returns null (ok: false).
 */
async function logged<T extends Record<string, number>>(
  job: string,
  label: string,
  run: (opts: { now: Date }) => Promise<T>,
): Promise<T | null> {
  const startedAt = new Date();
  try {
    const r = await run({ now: startedAt });
    await db.insert(jobsLog).values({ job, startedAt, finishedAt: new Date(), ok: true, detail: r });
    return r;
  } catch (e) {
    console.error(`[cron] ${label} failed: ${describeError(e)}`);
    // The pg error code (23503 for a foreign key) says what failed without any row data.
    const code = (e as { code?: unknown; cause?: { code?: unknown } })?.cause?.code ?? (e as { code?: unknown })?.code;
    const error = typeof code === 'string' ? code : e instanceof Error ? e.name : 'unknown';
    await db
      .insert(jobsLog)
      .values({ job, startedAt, finishedAt: new Date(), ok: false, detail: { error } })
      .catch(() => undefined);
    return null;
  }
}
