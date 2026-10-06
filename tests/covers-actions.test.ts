import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Admin Server Functions for cover selector steps 4–6: each checks the session before anything
// else (Server Functions are reachable by direct POST), and errors come back as editor messages.

const h = vi.hoisted(() => ({ admin: true, tags: [] as string[], refreshed: 0, hops: [] as string[] }));
vi.mock('@/lib/admin-session', () => ({
  requireAdmin: async () => {
    if (!h.admin) throw new Error('NEXT_REDIRECT');
    return { user: { email: 'v@example.org' } };
  },
}));
vi.mock('next/cache', () => ({ refresh: () => void h.refreshed++, updateTag: (t: string) => void h.tags.push(t), revalidateTag: () => {} }));
vi.mock('next/server', async (orig) => ({ ...(await orig()), after: () => {} }));

const actions = await import('@/app/admin/actions');
const { __setHopForTests } = await import('@/lib/ingest/safe-fetch');
const { _resetMemoryLimits, LIMITS } = await import('@/lib/ratelimit');

let restore: () => void;
beforeEach(() => {
  h.admin = true;
  h.tags = [];
  h.refreshed = 0;
  h.hops = [];
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.KV_REST_API_URL;
  delete process.env.BLOB_READ_WRITE_TOKEN;
  _resetMemoryLimits();
  restore = __setHopForTests(async (url) => {
    h.hops.push(url.hostname);
    return { status: 429, headers: {}, body: { async *[Symbol.asyncIterator]() {}, destroy() {} } };
  });
});
afterEach(() => {
  restore();
  delete process.env.BRAVE_SEARCH_API_KEY;
  delete process.env.INGEST_AI;
});

describe('cover source actions', () => {
  it('refuse without an admin session, before any request or spend', async () => {
    h.admin = false;
    process.env.BRAVE_SEARCH_API_KEY = 'k';
    await expect(actions.searchBraveCovers('q')).rejects.toThrow('NEXT_REDIRECT');
    await expect(actions.searchOpenverseCovers('q')).rejects.toThrow('NEXT_REDIRECT');
    await expect(actions.generateAiCover('evt_1', 'fast')).rejects.toThrow('NEXT_REDIRECT');
    await expect(actions.applyAiCover('evt_1', 'https://x', 'fast')).rejects.toThrow('NEXT_REDIRECT');
    await expect(actions.pickOpenverseCover('evt_1', 'x')).rejects.toThrow('NEXT_REDIRECT');
    await expect(actions.pickBraveCover('evt_1', { imageUrl: 'https://x', pageUrl: 'https://y' })).rejects.toThrow('NEXT_REDIRECT');
    expect(h.hops).toEqual([]);
    h.admin = true;
    expect((await actions.searchBraveCovers('q')).remaining).toBe(LIMITS.coverBrave.max - 1); // nothing was spent above
  });

  it('turn failures into bilingual messages with the count left today', async () => {
    expect(await actions.searchBraveCovers('q')).toEqual({ ok: false, message: 'Needs a Brave Search API key · 需要 Brave 搜索 API 密钥', remaining: LIMITS.coverBrave.max });
    expect(await actions.searchOpenverseCovers('bridge')).toMatchObject({ ok: false, message: expect.stringContaining('Openverse 繁忙'), remaining: LIMITS.coverOpenverse.max - 1 });
    process.env.INGEST_AI = 'off';
    expect(await actions.generateAiCover('evt_1', 'fast')).toMatchObject({ ok: false, message: expect.stringContaining('checklist 8') });
    expect(await actions.generateAiCover('evt_1', 'mega' as never)).toEqual({ ok: false, message: 'Unknown model · 未知模型' });
    expect(await actions.pickOpenverseCover('evt_1', 'f9384235-b72e-4f1e-9b05-e1b116262a29')).toMatchObject({ ok: false, message: expect.stringContaining('Blob') });
    expect(await actions.applyAiCover('evt_1', 'https://evil.example/uploads/ai-evt_1-1.png', 'fast')).toMatchObject({ ok: false, message: expect.stringContaining('AI 预览图') });
    expect(h.tags).toEqual([]);
    expect(h.refreshed).toBe(0);
  });
});
