import { isAuthorizedCron } from '@/lib/cron';
import { hasDatabase } from '@/lib/db';
import { expireCandidates } from '@/lib/inbox/candidates';
import { FORCE_COOLDOWN_MS, syncIcsFeeds } from '@/lib/inbox/sync-ics';

// 13:00 UTC daily: pull the three private ICS feeds into the candidate inbox and expire rows that
// ended more than 7 days ago. Opening /admin/inbox also syncs (10-minute cooldown).
export const maxDuration = 60;

export async function GET(req: Request) {
  if (!isAuthorizedCron(req)) return new Response(null, { status: 401 });
  if (!hasDatabase()) return Response.json({ ok: true, job: 'sync', skipped: 'no_database' });
  const result = await syncIcsFeeds({ cooldownMs: FORCE_COOLDOWN_MS });
  // Expiry still runs when no feed is configured or another run holds the lock.
  const expired = result.ran ? result.expired : await expireCandidates();
  return Response.json({
    ok: !result.ran || result.feeds.every((f) => f.ok),
    job: 'sync',
    ...(result.ran ? { feeds: result.feeds } : { skipped: result.reason }),
    expired,
  });
}
