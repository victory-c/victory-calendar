import { eq } from 'drizzle-orm';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Store } from '@/lib/covers/blob';
import { braveConfigured, braveSearchUrl, searchBrave } from '@/lib/covers/brave';
import { coverFromBrave } from '@/lib/covers/chain';
import { emailCover } from '@/lib/digest/cover';
import type { DB } from '@/lib/db';
import { covers, events } from '@/lib/db/schema';
import { __setHopForTests, type Hop } from '@/lib/ingest/safe-fetch';
import { _resetMemoryLimits, LIMITS } from '@/lib/ratelimit';
import { testDb } from './helpers/pglite';

// M4 F11 step 6: Brave image search, suggestions only. The key travels to api.search.brave.com
// and nowhere else; picks are fetched like pasted links.

const KEY = 'test-brave-key-0000';
const result = (n: number, over: Record<string, unknown> = {}) => ({
  type: 'image_result', title: `Poster ${n}`, url: `https://www.host.example/events/${n}`, source: 'host.example',
  thumbnail: { src: `https://imgs.search.brave.com/abc${n}/rs:fit:500:0:0/g:ce/aHR0cHM` },
  properties: { url: `https://cdn.host.example/img/${n}.jpg?w=1600&utm_source=x`, width: 1600, height: 1600 },
  meta_url: { scheme: 'https', netloc: 'www.host.example', hostname: 'www.host.example', path: '/events' }, confidence: 'high',
  ...over,
});

const png = (w: number, h: number) => sharp({ create: { width: w, height: h, channels: 3, background: { r: 20, g: 120, b: 100 } } }).png().toBuffer();
const stream = (b: Buffer | string) => ({
  async *[Symbol.asyncIterator]() {
    yield typeof b === 'string' ? Buffer.from(b) : b;
  },
  destroy() {},
});

type Reply = { status: number; json?: unknown; image?: Buffer; location?: string };
let restore: (() => void) | undefined;
let seen: { url: string; headers: Record<string, string> }[] = [];
function route(fn: (url: URL) => Reply | Promise<Reply>) {
  seen = [];
  const hop: Hop = async (url, _s, headers) => {
    seen.push({ url: url.toString(), headers });
    const r = await fn(url);
    if (r.location) return { status: r.status, headers: { location: r.location }, body: stream('') };
    if (r.json !== undefined) return { status: r.status, headers: { 'content-type': 'application/json' }, body: stream(JSON.stringify(r.json)) };
    if (r.image) return { status: r.status, headers: { 'content-type': 'image/png' }, body: stream(r.image) };
    return { status: r.status, headers: {}, body: stream('') };
  };
  restore = __setHopForTests(hop);
}

beforeEach(() => {
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.KV_REST_API_URL;
  process.env.BRAVE_SEARCH_API_KEY = KEY;
  _resetMemoryLimits();
});
afterEach(() => {
  restore?.();
  delete process.env.BRAVE_SEARCH_API_KEY;
});

describe('searchBrave', () => {
  it('without a key: a clear not-configured error and no network call', async () => {
    delete process.env.BRAVE_SEARCH_API_KEY;
    route(() => ({ status: 200, json: { results: [] } }));
    expect(braveConfigured()).toBe(false);
    await expect(searchBrave('anything')).rejects.toMatchObject({ code: 'not_configured', message: 'Needs a Brave Search API key · 需要 Brave 搜索 API 密钥' });
    expect(seen).toHaveLength(0);
  });

  it('sends the token only to api.search.brave.com, with safesearch=strict, and maps results', async () => {
    route(() => ({ status: 200, json: { type: 'images', results: [result(1), result(2)], extra: { might_be_offensive: false } } }));
    const r = await searchBrave('Agent Night poster');
    expect(seen).toHaveLength(1);
    const u = new URL(seen[0].url);
    expect(u.origin + u.pathname).toBe('https://api.search.brave.com/res/v1/images/search');
    expect(Object.fromEntries(u.searchParams)).toEqual({ q: 'Agent Night poster', count: '20', safesearch: 'strict' });
    expect(seen[0].headers).toEqual({ accept: 'application/json', 'x-subscription-token': KEY });
    expect(braveSearchUrl('x')).toContain('safesearch=strict');
    expect(r.remaining).toBe(LIMITS.coverBrave.max - 1);
    expect(r.hits[0]).toEqual({
      id: 'https://cdn.host.example/img/1.jpg?w=1600&utm_source=x', title: 'Poster 1',
      imageUrl: 'https://cdn.host.example/img/1.jpg?w=1600&utm_source=x', pageUrl: 'https://www.host.example/events/1',
      thumbUrl: 'https://imgs.search.brave.com/abc1/rs:fit:500:0:0/g:ce/aHR0cHM', host: 'host.example', width: 1600, height: 1600,
    });
  });

  it('a redirect to another host is refused before the token could follow it', async () => {
    route((u) => (u.hostname === 'api.search.brave.com' ? { status: 302, location: 'https://collector.example.net/x' } : { status: 200, json: {} }));
    await expect(searchBrave('q')).rejects.toMatchObject({ code: 'unavailable' });
    expect(seen.map((s) => new URL(s.url).hostname)).toEqual(['api.search.brave.com']);
    expect(JSON.stringify(seen)).not.toContain('collector.example.net');
  });

  it('a query Brave flags as possibly offensive shows nothing; http or off-host links are dropped', async () => {
    route(() => ({ status: 200, json: { results: [result(1)], extra: { might_be_offensive: true } } }));
    expect((await searchBrave('q')).hits).toEqual([]);
    route(() => ({
      status: 200,
      json: {
        results: [
          result(1, { url: 'http://www.host.example/plain' }),
          result(2, { properties: { url: 'http://cdn.host.example/2.jpg' } }),
          result(3, { thumbnail: { src: 'https://tracker.example.net/t.jpg' } }),
          result(4),
          result(4),
          { junk: true },
        ],
      },
    }));
    expect((await searchBrave('q')).hits.map((h) => h.title)).toEqual(['Poster 4']);
  });

  it('maps a rejected key and rate limits to bilingual messages; 30 a day, then no request', async () => {
    route(() => ({ status: 401 }));
    await expect(searchBrave('q')).rejects.toMatchObject({ code: 'rejected' });
    route(() => ({ status: 429 }));
    await expect(searchBrave('q')).rejects.toMatchObject({ code: 'busy', message: expect.stringContaining('繁忙') });
    route(() => ({ status: 200, json: { results: [] } }));
    for (let i = 2; i < LIMITS.coverBrave.max; i++) await searchBrave(`q${i}`);
    expect(seen).toHaveLength(LIMITS.coverBrave.max - 2);
    await expect(searchBrave('one more')).rejects.toMatchObject({ code: 'cap' });
    expect(seen).toHaveLength(LIMITS.coverBrave.max - 2);
  });
});

describe('coverFromBrave (pick)', () => {
  let db: DB;
  let store: Store & { files: Map<string, Buffer> };
  let n = 0;
  beforeEach(async () => {
    db = (await testDb()).db as unknown as DB;
    const files = new Map<string, Buffer>();
    store = {
      files,
      async put(path, body) {
        const url = `https://store0.public.blob.vercel-storage.com/${path.replace(/\.webp$/, '')}-${n++}.webp`;
        files.set(url, body);
        return url;
      },
      async del(urls) {
        for (const u of urls) files.delete(u);
      },
    };
    await db.insert(events).values({ id: 'evt_1', slug: 'agent-night', status: 'draft', sourceUrl: 'https://luma.com/abcd1234', category: 'ai', titleEn: 'Agent Night' });
  });
  const cover = async () => {
    const [e] = await db.select().from(events).where(eq(events.id, 'evt_1'));
    return e.coverId ? (await db.select().from(covers).where(eq(covers.id, e.coverId)))[0] : null;
  };
  const hit = result(1);

  it('fetches the image from its own host without the key and credits the page', async () => {
    route(async (u) => (u.hostname === 'cdn.host.example' ? { status: 200, image: await png(1200, 1200) } : { status: 404 }));
    const r = await coverFromBrave('evt_1', { imageUrl: hit.properties.url, pageUrl: hit.url, thumbUrl: hit.thumbnail.src }, { db, store });
    expect(r.lowRes).toBe(false);
    expect(seen.map((s) => s.url)).toEqual([hit.properties.url]);
    expect(seen[0].headers).toEqual({});
    expect(await cover()).toMatchObject({
      kind: 'brave', sourceUrl: 'https://cdn.host.example/img/1.jpg?w=1600', sourcePageUrl: 'https://www.host.example/events/1',
      attribution: 'Image via host.example', license: null,
    });
  });

  it("falls back to Brave's thumbnail only on imgs.search.brave.com", async () => {
    route(async (u) => (u.hostname === 'imgs.search.brave.com' ? { status: 200, image: await png(500, 500) } : { status: 403 }));
    const pick = { imageUrl: hit.properties.url, pageUrl: hit.url, thumbUrl: hit.thumbnail.src };
    expect((await coverFromBrave('evt_1', pick, { db, store })).lowRes).toBe(true);
    route(async () => ({ status: 403 }));
    await expect(coverFromBrave('evt_1', { ...pick, thumbUrl: 'https://tracker.example.net/t.jpg' }, { db, store })).rejects.toMatchObject({ code: 'status' });
    expect(seen.map((s) => new URL(s.url).hostname)).toEqual(['cdn.host.example']);
  });

  it('refuses http links, private addresses and logins (they come from the client)', async () => {
    route(async () => ({ status: 200, image: await png(800, 800) }));
    await expect(coverFromBrave('evt_1', { imageUrl: 'http://cdn.host.example/1.jpg', pageUrl: hit.url }, { db, store })).rejects.toMatchObject({ code: 'bad_input' });
    await expect(coverFromBrave('evt_1', { imageUrl: hit.properties.url, pageUrl: 'javascript:alert(1)' }, { db, store })).rejects.toMatchObject({ code: 'bad_input' });
    await expect(coverFromBrave('evt_1', { imageUrl: 'https://10.0.0.5/x.jpg', pageUrl: hit.url }, { db, store })).rejects.toMatchObject({ code: 'blocked_ip' });
    await expect(coverFromBrave('evt_1', { imageUrl: 'https://169.254.169.254/latest/', pageUrl: hit.url }, { db, store })).rejects.toMatchObject({ code: 'blocked_ip' });
    await expect(coverFromBrave('evt_1', { imageUrl: 'https://u:p@cdn.host.example/1.jpg', pageUrl: hit.url }, { db, store })).rejects.toMatchObject({ code: 'bad_input' });
    expect(seen).toHaveLength(0);
    expect(await cover()).toBeNull();
  });
});

describe('where a Brave cover appears', () => {
  it('email uses the template (licence unknown), like a Luma cover', () => {
    const e = {
      id: 'evt_1', category: 'ai' as const, hostName: 'Example Labs', sourceUrl: 'https://partiful.com/e/1', coverId: 'cov_b',
      cover: {
        kind: 'brave' as const, url400: 'https://store0.public.blob.vercel-storage.com/covers/x-400.webp', url800: '', url1600: '', thumbhash: '',
        dominant: '', letterboxed: false, attribution: 'Image via host.example', license: null, sourcePageUrl: 'https://host.example/e',
      },
    };
    const opts = { keep: new Set(['evt_1']), allToTemplate: false };
    expect(emailCover(e, 'https://picks.example.org', opts)).toEqual({ url: 'https://picks.example.org/og/template/ai?s=192', credit: null });
    const openverse = { ...e, cover: { ...e.cover, kind: 'openverse' as const, attribution: '"Bridge" by A. Person · CC BY 2.0', license: 'by/2.0' } };
    expect(emailCover(openverse, 'https://picks.example.org', opts)).toEqual({
      url: 'https://picks.example.org/og/email-cover/cov_b', credit: '"Bridge" by A. Person · CC BY 2.0',
      sourceUrl: 'https://host.example/e', licenseUrl: 'https://creativecommons.org/licenses/by/2.0/',
    });
    const ai = { ...e, cover: { ...e.cover, kind: 'ai' as const, attribution: 'AI-generated cover (Recraft V4.1 Flash)' } };
    expect(emailCover(ai, 'https://picks.example.org', opts)).toEqual({
      url: 'https://picks.example.org/og/email-cover/cov_b', credit: 'AI-generated cover (Recraft V4.1 Flash)',
    });
  });
});
