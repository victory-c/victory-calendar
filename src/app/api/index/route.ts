import { principalFrom } from '@/lib/api/principal';
import { hasDatabase } from '@/lib/db';
import { publishedIndex } from '@/lib/ingest/pipeline';

// GET /api/index: published events with their external ids, so the weekly-events skill can skip
// them. Token-only (candidates or ingest scope); otherwise anyone could list every source link.
export async function GET(req: Request) {
  const who = await principalFrom(req);
  if (!who) return new Response(null, { status: 401, headers: { 'cache-control': 'no-store' } });
  if (!who.scopes.includes('candidates') && !who.scopes.includes('ingest')) {
    return Response.json({ error: 'scope' }, { status: 403, headers: { 'cache-control': 'no-store' } });
  }
  const events = hasDatabase() ? await publishedIndex() : [];
  return Response.json({ events }, { headers: { 'cache-control': 'no-store' } });
}
