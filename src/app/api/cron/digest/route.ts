import { revalidateTag } from 'next/cache';
import { isAuthorizedCron } from '@/lib/cron';
import { db, hasDatabase } from '@/lib/db';
import { jobsLog } from '@/lib/db/schema';
import { runDigest, type RunResult } from '@/lib/digest/run';
import { describeError } from '@/lib/log-safe';

// 01:00 and 02:00 UTC daily (vercel.json): sends the scheduled issue once send_after has passed
// (Sunday 17:00 PT). Both runs do the same thing, resumable: the second finishes or retries what the
// first left. Work stops being started at 240 s so it ends well inside the 300 s limit. Runs with
// nothing due write no jobs_log row; the response and jobs_log carry counts and codes only.
export const maxDuration = 300;

const NO_OP: readonly RunResult['skipped'][] = ['nothing_due', 'locked', 'no_verified_sender'];

/** A run worth a jobs_log row: it worked on, closed or skipped an issue, or it failed. */
function worthLogging(r: RunResult) {
  return !r.ok || Boolean(r.issue) || Boolean(r.closed?.length) || Boolean(r.tooLate?.length) || !NO_OP.includes(r.skipped);
}

/** The pg error code, or the error's class name: what failed, with no row data. */
function errorCode(e: unknown) {
  const code = (e as { code?: unknown; cause?: { code?: unknown } })?.cause?.code ?? (e as { code?: unknown })?.code;
  return typeof code === 'string' ? code : e instanceof Error ? e.name : 'unknown';
}

export async function GET(req: Request) {
  if (!isAuthorizedCron(req)) return new Response(null, { status: 401 });
  if (!hasDatabase()) return Response.json({ ok: true, job: 'digest', skipped: 'no_database' });
  const startedAt = new Date();
  let result: RunResult;
  // The /weekly archive, its index and the sitemap follow an issue's status and snapshot: refresh
  // them when this run froze, worked on, finished or closed one (an idle run changes nothing). A
  // run that throws may already have frozen or closed one, so it refreshes too (as "Send now" does);
  // a throw before that only costs a cache miss.
  let touched = true;
  try {
    result = await runDigest();
    touched = Boolean(result.issue || result.closed?.length);
  } catch (e) {
    // Claims made before the failure stay; the next run retries them after 10 minutes.
    console.error(`[cron] digest failed: ${describeError(e)}`);
    result = {
      ok: false, reason: errorCode(e), claimed: 0, sent: 0, replayed: 0, failed: 0, emptyNotices: 0, skippedEmpty: 0, batches: 0, htmlMaxBytes: 0,
    };
  }
  if (touched) revalidateTag('digest', { expire: 0 });
  if (worthLogging(result)) {
    await db
      .insert(jobsLog)
      .values({ job: 'digest', startedAt, finishedAt: new Date(), ok: result.ok, detail: result })
      .catch((e) => console.error(`[cron] digest jobs_log write failed: ${describeError(e)}`));
  }
  return Response.json({ job: 'digest', ...result }, { status: result.ok ? 200 : 500 });
}
