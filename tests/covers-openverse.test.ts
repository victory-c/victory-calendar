import { eq } from 'drizzle-orm';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Store } from '@/lib/covers/blob';
import { coverFromOpenverse } from '@/lib/covers/chain';
import {
  coverEdit, formatOpenverseCredit, licenseCode, licenseCodeOfUrl, licenseLabel, licenseUrl, openverseCreditParts, shareCardAllowed,
} from '@/lib/covers/credit';
import { CoverSourceError } from '@/lib/covers/errors';
import { _resetOpenverseCache, openverseSearchUrl, searchOpenverse } from '@/lib/covers/openverse';
import type { DB } from '@/lib/db';
import { covers, events } from '@/lib/db/schema';
import { __setHopForTests, type Hop } from '@/lib/ingest/safe-fetch';
import { _resetMemoryLimits, LIMITS } from '@/lib/ratelimit';
import { testDb } from './helpers/pglite';

// M4 F11 step 4: Openverse search and pick. Every request goes through safe-fetch's test hop.

const ID = 'f9384235-b72e-4f1e-9b05-e1b116262a29';
const ID2 = '0aff3595-8168-440b-83ff-7a80b65dea42';
const item = (over: Record<string, unknown> = {}) => ({
  id: ID, title: 'Golden Gate at dusk', creator: 'A. Person', license: 'by-sa', license_version: '2.0',
  url: 'https://live.staticflickr.example/123/gg.jpg', thumbnail: `https://api.openverse.org/v1/images/${ID}/thumb/`,
  foreign_landing_url: 'https://www.flickr.example/photos/a/123', width: 1600, height: 1200, filetype: 'jpg', filesize: 400_000,
  mature: false, unstable__sensitivity: [], attribution: 'ignored', ...over,
});

const png = (w: number, h: number) => sharp({ create: { width: w, height: h, channels: 3, background: { r: 30, g: 90, b: 160 } } }).png().toBuffer();
const stream = (b: Buffer | string) => ({
  async *[Symbol.asyncIterator]() {
    yield typeof b === 'string' ? Buffer.from(b) : b;
  },
  destroy() {},
});

type Reply = { status: number; json?: unknown; image?: Buffer };
let restore: (() => void) | undefined;
let seen: { url: string; headers: Record<string, string> }[] = [];
function route(fn: (url: URL) => Reply | Promise<Reply>) {
  seen = [];
  const hop: Hop = async (url, _s, headers) => {
    seen.push({ url: url.toString(), headers });
    const r = await fn(url);
    if (r.json !== undefined) return { status: r.status, headers: { 'content-type': 'application/json' }, body: stream(JSON.stringify(r.json)) };
    if (r.image) return { status: r.status, headers: { 'content-type': 'image/png' }, body: stream(r.image) };
    return { status: r.status, headers: {}, body: stream('') };
  };
  restore = __setHopForTests(hop);
}

beforeEach(() => {
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.KV_REST_API_URL;
  _resetMemoryLimits();
  _resetOpenverseCache();
});
afterEach(() => restore?.());

describe('credit formatting (pure)', () => {
  it('TASL credit with the licence label, plus how the image was fitted to the square', () => {
    const base = { title: 'Bridge', creator: 'A. Person', license: 'by-sa' as const, version: '2.0' };
    expect(formatOpenverseCredit(base)).toBe('"Bridge" by A. Person · CC BY-SA 2.0');
    expect(formatOpenverseCredit({ ...base, edit: 'cropped' })).toBe('"Bridge" by A. Person · CC BY-SA 2.0 · cropped');
    expect(formatOpenverseCredit({ ...base, edit: 'padded' })).toBe('"Bridge" by A. Person · CC BY-SA 2.0 · padded to square');
    expect(formatOpenverseCredit({ title: null, creator: null, license: 'cc0', version: null })).toBe('Untitled image · CC0 1.0');
    expect(formatOpenverseCredit({ ...base, title: 'Line\nbreak‮', creator: '  ' })).toBe('"Line break" · CC BY-SA 2.0');
    expect(coverEdit({ letterboxed: false, width: 1000, height: 900 })).toBe('cropped');
    expect(coverEdit({ letterboxed: true, width: 1600, height: 900 })).toBe('padded');
    expect(coverEdit({ letterboxed: false, width: 800, height: 800 })).toBeNull();
  });

  it('licence codes, labels and deeds', () => {
    expect(licenseCode('by-sa', '2.0')).toBe('by-sa/2.0');
    expect(licenseCode('cc0', '')).toBe('cc0/1.0');
    expect(licenseLabel('by/4.0')).toBe('CC BY 4.0');
    expect(licenseLabel('cc0/1.0')).toBe('CC0 1.0');
    expect(licenseLabel('by-nc/2.0')).toBeNull();
    expect(licenseUrl('by-sa/2.0')).toBe('https://creativecommons.org/licenses/by-sa/2.0/');
    expect(licenseUrl('cc0/1.0')).toBe('https://creativecommons.org/publicdomain/zero/1.0/');
    expect(licenseUrl(null)).toBeNull();
  });

  it('reads a deed URL back to its code (the email links only real CC deeds)', () => {
    for (const code of ['by/2.0', 'by-sa/2.0', 'by/4.0', 'by-sa/3.0', 'cc0/1.0']) expect(licenseCodeOfUrl(licenseUrl(code))).toBe(code);
    for (const junk of [
      null, '', 'https://creativecommons.org/licenses/by-nc/2.0/', 'http://creativecommons.org/licenses/by/2.0/',
      'https://creativecommons.org/licenses/by/2.0', 'https://evil.example/licenses/by/2.0/', 'https://creativecommons.org.evil.example/licenses/by/2.0/',
    ]) expect(licenseCodeOfUrl(junk)).toBeNull();
  });

  it('splits a stored credit back into work, licence and edit for the detail page', () => {
    expect(openverseCreditParts('"Bridge" by A. Person · CC BY-SA 2.0 · cropped', 'by-sa/2.0')).toEqual({
      work: '"Bridge" by A. Person', licenseLabel: 'CC BY-SA 2.0', licenseHref: 'https://creativecommons.org/licenses/by-sa/2.0/', edit: 'cropped',
    });
    expect(openverseCreditParts('"A · B" by C · CC0 1.0', 'cc0/1.0')).toMatchObject({ work: '"A · B" by C', edit: null });
    expect(openverseCreditParts('free text', 'by/2.0')).toBeNull();
    expect(openverseCreditParts('"X" · CC BY 2.0 · something else', 'by/2.0')).toBeNull();
  });

  it('share cards draw only covers that need no credit line', () => {
    expect(shareCardAllowed({ kind: 'openverse', license: 'cc0/1.0' })).toBe(true);
    expect(shareCardAllowed({ kind: 'openverse', license: 'by/2.0' })).toBe(false);
    expect(shareCardAllowed({ kind: 'openverse', license: null })).toBe(false);
    expect(shareCardAllowed({ kind: 'brave', license: null })).toBe(false);
    expect(shareCardAllowed({ kind: 'ai', license: null })).toBe(true);
    expect(shareCardAllowed({ kind: 'template', license: null })).toBe(false);
  });
});

describe('searchOpenverse', () => {
  it('always asks for CC0 / BY / BY-SA, mature=false, 20 per page and JSON, from api.openverse.org only', async () => {
    route(() => ({ status: 200, json: { results: [item()] } }));
    const r = await searchOpenverse('  golden   gate ');
    const u = new URL(seen[0].url);
    expect(u.origin + u.pathname).toBe('https://api.openverse.org/v1/images/');
    expect(Object.fromEntries(u.searchParams)).toEqual({
      q: 'golden gate', license: 'cc0,by,by-sa', mature: 'false', page_size: '20', page: '1', format: 'json',
    });
    expect(seen[0].headers.accept).toBe('application/json');
    expect(openverseSearchUrl('x', 3)).toContain('page=3');
    expect(r.hits).toEqual([
      {
        id: ID, title: 'Golden Gate at dusk', creator: 'A. Person', license: 'by-sa', licenseVersion: '2.0',
        credit: '"Golden Gate at dusk" by A. Person · CC BY-SA 2.0', thumbUrl: `https://api.openverse.org/v1/images/${ID}/thumb/`,
        pageUrl: 'https://www.flickr.example/photos/a/123', width: 1600, height: 1200, usable: true,
      },
    ]);
    expect(r.remaining).toBe(LIMITS.coverOpenverse.max - 1);
  });

  it('drops other licences, mature or flagged results; marks SVGs, huge files and small images unusable', async () => {
    const id = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;
    route(() => ({
      status: 200,
      json: {
        results: [
          item({ id: id(1), license: 'by-nc' }),
          item({ id: id(2), license: 'pdm' }),
          item({ id: id(3), mature: true }),
          item({ id: id(4), unstable__sensitivity: ['sensitive_text'] }),
          item({ id: id(5), license: 'CC0', license_version: '1.0' }),
          item({ id: id(6), filetype: 'svg' }),
          item({ id: id(7), filesize: 40_000_000 }),
          item({ id: id(8), width: 300, height: 1200 }),
          item({ id: id(9), width: null, height: null }),
          { id: 'not-a-uuid', license: 'by' },
          item({ id: ID2, thumbnail: 'http://api.openverse.org/x' }),
        ],
      },
    }));
    const { hits } = await searchOpenverse('bridge');
    expect(hits.map((h) => [h.id.slice(-1), h.license, h.usable])).toEqual([
      ['5', 'cc0', true], ['6', 'by-sa', false], ['7', 'by-sa', false], ['8', 'by-sa', false], ['9', 'by-sa', true],
    ]);
  });

  it('caches results for the query: a repeat costs no request and no daily search', async () => {
    route(() => ({ status: 200, json: { results: [item()] } }));
    const first = await searchOpenverse('Bridge');
    const again = await searchOpenverse('bridge ');
    expect(seen).toHaveLength(1);
    expect(again).toMatchObject({ cached: true, remaining: null, hits: first.hits });
    await searchOpenverse('bridge', { page: 2 });
    expect(seen).toHaveLength(2);
  });

  it('429 is a bilingual "busy"; the daily cap stops before any request', async () => {
    route(() => ({ status: 429 }));
    await expect(searchOpenverse('busy')).rejects.toMatchObject({ code: 'busy', message: expect.stringContaining('繁忙') });
    for (let i = 1; i < LIMITS.coverOpenverse.max; i++) await searchOpenverse(`q${i}`).catch(() => null);
    const before = seen.length;
    await expect(searchOpenverse('one more')).rejects.toMatchObject({ code: 'cap' });
    expect(seen.length).toBe(before);
    await expect(searchOpenverse('   ')).rejects.toBeInstanceOf(CoverSourceError);
  });
});

describe('coverFromOpenverse (pick)', () => {
  let db: DB;
  let store: Store & { files: Map<string, Buffer>; deleted: string[] };
  let n = 0;
  beforeEach(async () => {
    db = (await testDb()).db as unknown as DB;
    const files = new Map<string, Buffer>();
    store = {
      files,
      deleted: [],
      async put(path, body) {
        const url = `https://store0.public.blob.vercel-storage.com/${path.replace(/\.webp$/, '')}-${n++}.webp`;
        files.set(url, body);
        return url;
      },
      async del(urls) {
        store.deleted.push(...urls);
        for (const u of urls) files.delete(u);
      },
    };
    await db.insert(events).values({ id: 'evt_1', slug: 'agent-night', status: 'draft', sourceUrl: 'https://luma.com/abcd1234', category: 'ai', titleEn: 'Agent Night' });
  });
  const cover = async () => {
    const [e] = await db.select().from(events).where(eq(events.id, 'evt_1'));
    return e.coverId ? (await db.select().from(covers).where(eq(covers.id, e.coverId)))[0] : null;
  };

  it("re-reads the licence, stores the original with its credit, licence and source page, and replaces the old cover's files", async () => {
    const detail = item({ width: 1000, height: 900 });
    route(async (u) => {
      if (u.toString() === `https://api.openverse.org/v1/images/${ID}/?format=json`) return { status: 200, json: detail };
      if (u.toString() === detail.url) return { status: 200, image: await png(1000, 900) };
      return { status: 404 };
    });
    await coverFromOpenverse('evt_1', ID, { db, store });
    const first = await cover();
    const r = await coverFromOpenverse('evt_1', ID, { db, store });
    expect(r.lowRes).toBe(false);
    expect(await cover()).toMatchObject({
      kind: 'openverse', license: 'by-sa/2.0', sourceUrl: detail.url, sourcePageUrl: 'https://www.flickr.example/photos/a/123',
      attribution: '"Golden Gate at dusk" by A. Person · CC BY-SA 2.0 · cropped', letterboxed: false,
    });
    expect(store.deleted.sort()).toEqual([first!.url1600, first!.url800, first!.url400].sort());
    expect(seen.every((s) => !s.url.includes('/thumb/'))).toBe(true);
  });

  it('refuses a licence that changed since the search; nothing is fetched or stored', async () => {
    route((u) => (u.hostname === 'api.openverse.org' ? { status: 200, json: item({ license: 'by-nc' }) } : { status: 500 }));
    await expect(coverFromOpenverse('evt_1', ID, { db, store })).rejects.toMatchObject({ code: 'license' });
    route((u) => (u.hostname === 'api.openverse.org' ? { status: 200, json: item({ unstable__sensitivity: ['user_reported_sensitive'] }) } : { status: 500 }));
    await expect(coverFromOpenverse('evt_1', ID, { db, store })).rejects.toMatchObject({ code: 'license' });
    expect(seen.map((s) => new URL(s.url).hostname)).toEqual(['api.openverse.org']);
    expect(store.files.size).toBe(0);
    expect(await cover()).toBeNull();
    await expect(coverFromOpenverse('evt_1', '../../admin', { db, store })).rejects.toMatchObject({ code: 'bad_input' });
  });

  it("falls back to Openverse's thumbnail when the original is gone, and says it is low resolution", async () => {
    const detail = item();
    route(async (u) => {
      if (u.pathname === `/v1/images/${ID}/`) return { status: 200, json: detail };
      if (u.toString() === detail.thumbnail) return { status: 200, image: await png(600, 450) };
      return { status: 404 };
    });
    const r = await coverFromOpenverse('evt_1', ID, { db, store });
    expect(r.lowRes).toBe(true);
    expect(await cover()).toMatchObject({ kind: 'openverse', attribution: '"Golden Gate at dusk" by A. Person · CC BY-SA 2.0 · padded to square' });
  });

  it('needs Blob storage', async () => {
    await expect(coverFromOpenverse('evt_1', ID, { db, store: null })).rejects.toMatchObject({ code: 'no_blob' });
  });
});
