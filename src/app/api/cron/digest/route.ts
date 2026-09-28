import { isAuthorizedCron } from '@/lib/cron';

// 01:00 and 02:00 UTC daily — sends the scheduled issue once send_after has passed (M3 week 14).
export async function GET(req: Request) {
  if (!isAuthorizedCron(req)) return new Response(null, { status: 401 });
  return Response.json({ ok: true, job: 'digest', skipped: 'digest sending lands in M3 week 14' });
}
