import { adminSessionFrom } from '@/lib/admin-session';
import { db } from '@/lib/db';
import { jobsLog } from '@/lib/db/schema';
import { dayKey, PT } from '@/lib/format/date';
import { describeError } from '@/lib/log-safe';
import { EXPORT_COLUMNS, exportRows, toCsv } from '@/lib/subscribers/admin';

// GET /admin/subscribers/export (DESIGN D12, PRD「订阅者月度 CSV」): every subscriber, every status,
// as CSV. The admin session cookie only, never principalFrom: a Bearer vp_ token must never read
// the subscribers table (guide「鉴权（只有 Victor）」). No dot in the path, so proxy.ts still
// sends a signed-out browser to sign-in; this handler re-checks the session either way. Reading the
// request makes it dynamic under Cache Components, and the response is never stored anywhere.

const deny = (status: number) => new Response(null, { status, headers: { 'cache-control': 'no-store' } });

export async function GET(req: Request) {
  // A link from another site can't trigger the download with the admin's cookie.
  if (req.headers.get('sec-fetch-site') === 'cross-site') return deny(403);
  let session = null;
  try {
    session = await adminSessionFrom(req);
  } catch (err) {
    console.warn('[subscribers] export session check failed', err instanceof Error ? err.message : err);
  }
  if (!session) return deny(401);

  const now = new Date();
  let csv: string;
  try {
    const rows = await exportRows();
    await db.insert(jobsLog).values({ job: 'subscribers_export', startedAt: now, finishedAt: new Date(), ok: true, detail: { rows: rows.length } });
    csv = toCsv(EXPORT_COLUMNS, rows);
  } catch (e) {
    console.error(`[subscribers] export failed: ${describeError(e)}`);
    return deny(500);
  }
  return new Response(csv, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="subscribers-${dayKey(now, PT)}.csv"`,
      'cache-control': 'no-store, private',
      'x-robots-tag': 'noindex',
      'x-content-type-options': 'nosniff',
    },
  });
}
