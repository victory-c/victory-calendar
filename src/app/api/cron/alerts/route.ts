import { runAlerts, type AlertRunResult } from '@/lib/alerts/run';
import { isAuthorizedCron } from '@/lib/cron';
import { db, hasDatabase } from '@/lib/db';
import { jobsLog } from '@/lib/db/schema';
import { describeError } from '@/lib/log-safe';

// 15:00 and 16:00 UTC daily (vercel.json; 07:00–09:00 PT): F20 going alerts for the marks Victor
// made before today 00:00 PT. Both runs do the same thing, resumable: the second finishes or retries
// what the first left. Work stops being started at 240 s, inside the 300 s limit. A run that did
// something or failed writes one jobs_log row (job 'alerts'); the response and the row carry counts
// and codes only, never an address.
export const maxDuration = 300;

/**
 * A run worth a jobs_log row: it claimed, sent, replayed or failed something, left work, failed, or
 * held alerts back for the digest. Idle runs (nothing marked, sending off, locked) write nothing.
 */
function worthLogging(r: AlertRunResult) {
  return !r.ok || r.partial === true || r.skipped === 'digest_day' || r.claimed + r.sent + r.replayed + r.failed + r.ineligible > 0;
}

/** The pg error code, or the error's class name: what failed, with no row data. */
function errorCode(e: unknown) {
  const code = (e as { code?: unknown; cause?: { code?: unknown } })?.cause?.code ?? (e as { code?: unknown })?.code;
  return typeof code === 'string' ? code : e instanceof Error ? e.name : 'unknown';
}

export async function GET(req: Request) {
  if (!isAuthorizedCron(req)) return new Response(null, { status: 401 });
  if (!hasDatabase()) return Response.json({ ok: true, job: 'alerts', skipped: 'no_database' });
  const startedAt = new Date();
  let result: AlertRunResult;
  try {
    result = await runAlerts();
  } catch (e) {
    // Claims made before the failure stay; the next run (or the same day's second run) retries them.
    console.error(`[cron] alerts failed: ${describeError(e)}`);
    result = { ok: false, reason: errorCode(e), pool: 0, claimed: 0, sent: 0, replayed: 0, failed: 0, ineligible: 0, batches: 0, htmlMaxBytes: 0 };
  }
  if (worthLogging(result)) {
    await db
      .insert(jobsLog)
      .values({ job: 'alerts', startedAt, finishedAt: new Date(), ok: result.ok, detail: result })
      .catch((e) => console.error(`[cron] alerts jobs_log write failed: ${describeError(e)}`));
  }
  return Response.json({ job: 'alerts', ...result }, { status: result.ok ? 200 : 500 });
}
