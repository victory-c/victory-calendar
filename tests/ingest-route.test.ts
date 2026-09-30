import { readFileSync } from 'node:fs';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { testDb } from './helpers/pglite';

// Route-level contract (guide「快速添加与 skill 共用的 API 契约」): 201 / 202 / 401 / 403 / 409 / 429.
const h = vi.hoisted(() => ({ db: null as unknown, session: false, revalidated: [] as string[] }));

vi.mock('@/lib/db', async (orig) => ({ ...(await orig()), db: new Proxy({}, { get: (_t, p) => Reflect.get(h.db as object, p) }), hasDatabase: () => true }));
vi.mock('@/lib/admin-session', () => ({
  adminSessionFrom: async () => (h.session ? { user: { email: 'v@example.org' } } : null),
}));
vi.mock('next/cache', () => ({ revalidateTag: (tag: string) => h.revalidated.push(tag) }));
// after() callbacks run once the response is built; the tests flush them explicitly.
const afters = vi.hoisted(() => [] as (() => Promise<void>)[]);
vi.mock('next/server', async (orig) => ({ ...(await orig()), after: (fn: () => Promise<void>) => afters.push(fn) }));
const flushAfter = async () => {
  while (afters.length) await afters.shift()!();
};

const { POST } = await import('@/app/api/ingest/route');
const { GET } = await import('@/app/api/index/route');
const { createToken, revokeToken } = await import('@/lib/api/tokens');
const { apiTokens, events } = await import('@/lib/db/schema');
const { __setHopForTests } = await import('@/lib/ingest/safe-fetch');
const { _resetMemoryLimits } = await import('@/lib/ratelimit');

const html = readFileSync('fixtures/luma-event.html');
let restoreHop: () => void;
beforeAll(() => {
  process.env.INGEST_AI = 'off';
  restoreHop = __setHopForTests(async (url) => {
    const ok = url.hostname === 'luma.com';
    return {
      status: ok ? 200 : 404,
      headers: { 'content-type': 'text/html; charset=utf-8' },
      body: { async *[Symbol.asyncIterator]() { if (ok) yield html; }, destroy() {} },
    };
  });
});
afterAll(() => {
  restoreHop();
  delete process.env.INGEST_AI;
});
beforeEach(async () => {
  h.db = (await testDb()).db;
  h.session = false;
  h.revalidated = [];
  afters.length = 0;
  _resetMemoryLimits();
});

const post = (body: unknown, token?: string) =>
  POST(new Request('http://localhost/api/ingest', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  }));

describe('POST /api/ingest', () => {
  it('401 without credentials or with a bad/revoked token', async () => {
    expect((await post({ url: 'https://luma.com/abcd1234' })).status).toBe(401);
    expect((await post({ url: 'https://luma.com/abcd1234' }, 'vp_notarealtokennotarealtoken00')).status).toBe(401);
    const { id, token } = await createToken('phone', ['ingest']);
    await revokeToken(id);
    expect((await post({ url: 'https://luma.com/abcd1234' }, token)).status).toBe(401);
  });

  it('201 draft with an ingest token; stores only the hash and tracks last use', async () => {
    const { id, token } = await createToken('phone', ['ingest']);
    const res = await post({ url: 'https://lu.ma/abcd1234', comment: 'Bring a laptop', mode: 'draft', client: 'ios-shortcut' }, token);
    expect(res.status).toBe(201);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body = await res.json();
    // No Blob store in tests: the official cover can't be kept, so the event ends on the template.
    expect(body).toMatchObject({ status: 'draft', title_en: 'Agent Builders Night', ai: false, cover_status: 'template' });
    await flushAfter();
    const [withCover] = await (h.db as import('@/lib/db').DB).select().from(events).where(eq(events.id, body.id));
    expect(withCover.coverId).toMatch(/^cov_/);
    expect(body.admin_url).toMatch(/\/admin\/e\/evt_/);
    const [row] = await (h.db as import('@/lib/db').DB).select().from(apiTokens).where(eq(apiTokens.id, id));
    expect(row.tokenHash).not.toContain(token);
    expect(row.lastUsedAt).toBeInstanceOf(Date);
    const [e] = await (h.db as import('@/lib/db').DB).select().from(events).where(eq(events.id, body.id));
    expect(e.createdVia).toBe('shortcut');
    expect(h.revalidated).toEqual([]);
  });

  it('403 when publish is asked for without the publish scope', async () => {
    const { token } = await createToken('phone', ['ingest']);
    const res = await post({ url: 'https://luma.com/abcd1234', mode: 'publish' }, token);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'scope' });
    const skill = await createToken('weekly-events-skill', ['candidates']);
    expect((await post({ url: 'https://luma.com/abcd1234' }, skill.token)).status).toBe(403);
  });

  it('409 on a duplicate, 202 on an unreadable page, 400 on a bad body', async () => {
    const { token } = await createToken('phone', ['ingest']);
    const first = await (await post({ url: 'https://luma.com/abcd1234' }, token)).json();
    const dup = await post({ url: 'https://lu.ma/abcd1234' }, token);
    expect(dup.status).toBe(409);
    expect((await dup.json()).existing_id).toBe(first.id);
    const manual = await post({ url: 'https://example.org/gone' }, token);
    expect(manual.status).toBe(202);
    expect((await manual.json()).needs_manual).toBe(true);
    expect((await post('{not json', token)).status).toBe(400);
    expect((await post({ comment: 'no url' }, token)).status).toBe(400);
  });

  it('session publish revalidates the events tag (needs a comment and a category)', async () => {
    h.session = true;
    // Without a model there is no category for Luma's 'ai' hint → 'ai' at 0.5, so it can publish.
    const res = await post({ url: 'https://luma.com/abcd1234', comment: 'Good one', mode: 'publish' });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toMatchObject({ status: 'published', category: 'ai', cover_status: 'template' });
    expect(h.revalidated).toEqual(['events']);
    await flushAfter();
    expect(h.revalidated).toEqual(['events', 'events']);
    const [e] = await (h.db as import('@/lib/db').DB).select().from(events).where(eq(events.id, body.id));
    expect(e.createdVia).toBe('admin');
  });

  it('429 after 60 requests an hour per token, with Retry-After', async () => {
    const { token } = await createToken('phone', ['ingest']);
    for (let i = 0; i < 60; i++) await post({ comment: 'x' }, token); // 400s still count
    const res = await post({ url: 'https://luma.com/abcd1234' }, token);
    expect(res.status).toBe(429);
    expect(Number(res.headers.get('retry-after'))).toBeGreaterThan(0);
  });
});

describe('GET /api/index', () => {
  it('needs a token with candidates or ingest scope and lists published ids', async () => {
    expect((await GET(new Request('http://localhost/api/index'))).status).toBe(401);
    const skill = await createToken('weekly-events-skill', ['candidates']);
    const pub = await createToken('phone', ['ingest', 'publish']);
    await post({ url: 'https://luma.com/abcd1234', comment: 'Good', mode: 'publish' }, pub.token);
    const res = await GET(new Request('http://localhost/api/index', { headers: { authorization: `Bearer ${skill.token}` } }));
    expect(res.status).toBe(200);
    const { events: list } = await res.json();
    expect(list).toHaveLength(1);
    expect(list[0].external_ids.sort()).toEqual(['luma:abcd1234', 'luma:evt-TestLuma000001']);
  });
});
