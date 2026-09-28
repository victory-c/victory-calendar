import { isAuthorizedCron } from '@/lib/cron';

// 13:00 UTC daily — pulls the three private ICS feeds into the candidate inbox (M2 week 11).
export async function GET(req: Request) {
  if (!isAuthorizedCron(req)) return new Response(null, { status: 401 });
  return Response.json({ ok: true, job: 'sync', skipped: 'inbox sync lands in M2 week 11' });
}
