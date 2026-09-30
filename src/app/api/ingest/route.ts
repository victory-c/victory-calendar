import { revalidateTag } from 'next/cache';
import { after } from 'next/server';
import { z } from 'zod';
import { principalFrom } from '@/lib/api/principal';
import { runCoverChain } from '@/lib/covers/chain';
import { hasDatabase } from '@/lib/db';
import { ingest, type CreatedVia } from '@/lib/ingest/pipeline';
import { limit } from '@/lib/ratelimit';

// POST /api/ingest (guide「快速添加与 skill 共用的 API 契约」).
export const maxDuration = 60;

const Body = z.object({
  url: z.string().min(4).max(2048),
  comment: z.string().max(2000).nullish(),
  mode: z.enum(['draft', 'publish', 'candidate']).default('draft'),
  client: z.string().max(40).nullish(),
  name: z.string().max(200).nullish(),
});

const json = (status: number, body: unknown, headers?: HeadersInit) =>
  Response.json(body, { status, headers: { 'cache-control': 'no-store', ...headers } });

function createdVia(kind: 'session' | 'token', tokenName: string, client: string | null | undefined): CreatedVia {
  if (client === 'share-target' || client === 'android') return 'share_target';
  if (kind === 'session') return 'admin';
  if (tokenName === 'weekly-events-skill' || client === 'weekly-events-skill') return 'skill';
  return 'shortcut';
}

export async function POST(req: Request) {
  const who = await principalFrom(req);
  if (!who) return new Response(null, { status: 401, headers: { 'cache-control': 'no-store' } });

  const rl = await limit('token', who.id);
  if (!rl.success) {
    return json(429, { error: 'rate_limited' }, { 'retry-after': String(Math.max(1, Math.ceil((rl.reset - Date.now()) / 1000))) });
  }

  let parsed: z.infer<typeof Body>;
  try {
    parsed = Body.parse(await req.json());
  } catch {
    return json(400, { error: 'bad_request' });
  }
  if (parsed.mode === 'candidate') return json(400, { error: 'unsupported_mode', detail: 'candidate batches arrive with the inbox' });
  if (!who.scopes.includes('ingest')) return json(403, { error: 'scope' });
  if (parsed.mode === 'publish' && !who.scopes.includes('publish')) return json(403, { error: 'scope' });
  if (!hasDatabase()) return json(503, { error: 'no_database' });

  const result = await ingest({
    url: parsed.url,
    comment: parsed.comment ?? null,
    mode: parsed.mode,
    name: parsed.name ?? null,
    createdVia: createdVia(who.kind, who.name, parsed.client),
  });
  if (result.status === 201) {
    const published = result.body.status === 'published';
    if (published) revalidateTag('events', { expire: 0 });
    // Cover chain after the response (guide: official → host composite → template within ~15 s).
    const { id } = result.body;
    after(async () => {
      try {
        const r = await runCoverChain({ eventId: id, ...result.cover });
        if (published && r.coverId) revalidateTag('events', { expire: 0 });
      } catch (err) {
        console.error('[ingest] cover chain failed', err);
      }
    });
  }
  return json(result.status, result.body);
}
