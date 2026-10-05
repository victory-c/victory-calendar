import { isAuthorizedCron } from '@/lib/cron';
import { db, hasDatabase } from '@/lib/db';
import { jobsLog } from '@/lib/db/schema';
import { expireCandidates } from '@/lib/inbox/candidates';
import { FORCE_COOLDOWN_MS, syncIcsFeeds } from '@/lib/inbox/sync-ics';
import { describeError } from '@/lib/log-safe';
import { purgeStalePending } from '@/lib/subscribers/service';

// 13:00 UTC daily: pull the three private ICS feeds into the candidate inbox and expire rows that
// ended more than 7 days ago. Opening /admin/inbox also syncs (10-minute cooldown). Also deletes
// newsletter sign-ups left unconfirmed for 7 days (guide「待确认」).
export const maxDuration = 60;

export async function GET(req: Request) {
  if (!isAuthorizedCron(req)) return new Response(null, { status: 401 });
  if (!hasDatabase()) return Response.json({ ok: true, job: 'sync', skipped: 'no_database' });
  const result = await syncIcsFeeds({ cooldownMs: FORCE_COOLDOWN_MS });
  // Expiry still runs when no feed is configured or another run holds the lock.
  const expired = result.ran ? result.expired : await expireCandidates();
  const purge = await purgePending();
  return Response.json({
    ok: (!result.ran || result.feeds.every((f) => f.ok)) && purge !== null,
    job: 'sync',
    ...(result.ran ? { feeds: result.feeds } : { skipped: result.reason }),
    expired,
    pending_purged: purge?.deleted ?? null,
    pending_reverted: purge?.reverted ?? null,
  });
}

/** Its own jobs_log row, written on failure too so monitoring sees it; never hides the inbox result. */
async function purgePending(): Promise<{ deleted: number; reverted: number } | null> {
  const startedAt = new Date();
  try {
    const r = await purgeStalePending({ now: startedAt });
    await db.insert(jobsLog).values({ job: 'subscribers_purge', startedAt, finishedAt: new Date(), ok: true, detail: r });
    return r;
  } catch (e) {
    console.error(`[cron] subscribers purge failed: ${describeError(e)}`);
    // The pg error code (23503 for a foreign key) says what failed without any row data.
    const code = (e as { code?: unknown; cause?: { code?: unknown } })?.cause?.code ?? (e as { code?: unknown })?.code;
    const error = typeof code === 'string' ? code : e instanceof Error ? e.name : 'unknown';
    await db
      .insert(jobsLog)
      .values({ job: 'subscribers_purge', startedAt, finishedAt: new Date(), ok: false, detail: { error } })
      .catch(() => undefined);
    return null;
  }
}
