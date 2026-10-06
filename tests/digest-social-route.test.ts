import { eq } from 'drizzle-orm';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { testDb } from './helpers/pglite';

// GET /admin/digest/image/[week]/[name] (F17, decision L6) on PGlite with the real export source
// (issue, assembly, live state) and the real Satori render. Mocked: the admin session, the Google
// Fonts loader (offline: no fonts → next/og's bundled Geist, or a failed chunk), the cover fetch
// (safe-fetch has its own DNS-pinned agent) and global fetch (Satori asks Google for glyphs it
// lacks; here that fails quietly, so the test never goes online).
const h = vi.hoisted(() => ({
  db: null as unknown,
  session: true,
  fontsComplete: true,
  fetchBytes: null as null | ((url: string) => Promise<Buffer>),
  fetched: [] as string[],
}));
vi.mock('@/lib/db', async (orig) => ({ ...(await orig()), db: new Proxy({}, { get: (_t, p) => Reflect.get(h.db as object, p) }), hasDatabase: () => true }));
vi.mock('@/lib/admin-session', () => ({
  requireAdmin: async () => ({ user: { email: 'v@example.org' } }),
  adminSessionFrom: async (req: Request) => {
    if (req.headers.get('cookie') === 'broken') throw new Error('bad cookie');
    return h.session ? { user: { email: 'v@example.org' } } : null;
  },
}));
vi.mock('@/lib/ingest/safe-fetch', async (orig) => ({
  ...(await orig()),
  safeFetchBytes: async (url: string) => {
    h.fetched.push(url);
    return h.fetchBytes!(url);
  },
}));
vi.mock('@/lib/og/fonts', async (orig) => ({
  ...(await orig()),
  textFonts: async () => ({ fonts: [], complete: h.fontsComplete, family: { serif: 'serif', sans: 'sans', mono: 'mono' } }),
}));

const route = await import('@/app/admin/(app)/digest/image/[week]/[name]/route');
const { exportPanels, liveFor, loadExport } = await import('@/lib/digest/export-source');
const { createToken, tokenFrom } = await import('@/lib/api/tokens');
const { coverToTemplate } = await import('@/lib/covers/chain');
const { longPlan } = await import('@/lib/digest/social');
const { buildSnapshot } = await import('@/lib/digest/assemble');
const { ensureIssue, getIssueByWeek } = await import('@/lib/digest/issues');
const { templateCoverRow } = await import('@/lib/covers/template');
const { newId } = await import('@/lib/ids');
const { covers, digestIssues, events } = await import('@/lib/db/schema');
type DB = import('@/lib/db').DB;
type NewEvent = import('@/lib/db/schema').NewEvent;

const W = '2026-W42';
const NOW = new Date('2026-10-05T18:00:00Z');
const db = () => h.db as DB;
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

async function addEvent(over: Partial<NewEvent> = {}) {
  const id = over.id ?? newId('evt');
  const category = over.category ?? 'ai';
  const coverId = newId('cov');
  await db().insert(covers).values({ id: coverId, ...templateCoverRow(category, null) });
  await db().insert(events).values({
    slug: `event-${id}`, status: 'published', sourceUrl: `https://luma.com/${id.slice(4)}`, titleEn: `Agent Night ${id.slice(-4)}`,
    titleZh: `Agent 之夜 ${id.slice(-4)}`, noteZh: '值得去看 demo', startAt: new Date('2026-10-14T01:30:00Z'), tz: 'America/Los_Angeles',
    city: 'San Francisco', format: 'in_person', going: 'none', publishedAt: NOW, ...over, id, category, coverId,
  });
  return id;
}

/** W42 with three events (one going, one hackathon on Saturday), as a draft issue. */
async function seedWeek() {
  const a = await addEvent({ going: 'going', goingVisibility: 'public' });
  const b = await addEvent({ category: 'hackathon', startAt: new Date('2026-10-17T17:00:00Z') });
  const c = await addEvent({ category: 'vc', startAt: new Date('2026-10-15T02:00:00Z'), format: 'online', city: null });
  return { issue: await ensureIssue(W, { db: db() }), ids: [a, b, c] };
}

const get = (week: string, name: string, headers: Record<string, string> = {}, v?: string) =>
  route.GET(new Request(`http://localhost/admin/digest/image/${week}/${name}${v ? `?v=${v}` : ''}`, { headers }), { params: Promise.resolve({ week, name }) });

beforeEach(async () => {
  h.db = (await testDb()).db;
  h.session = true;
  h.fontsComplete = true;
  h.fetched = [];
  h.fetchBytes = async () => Promise.reject(new Error('offline in tests'));
  vi.stubEnv('PUBLIC_HOST', 'picks.test');
  vi.stubEnv('SHOW_ATTENDANCE', '');
  // Satori's own glyph fallback asks Google Fonts; offline it fails and draws boxes instead.
  vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new Error('offline in tests'))));
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('access', () => {
  it('403 for a cross-site request, even with a session', async () => {
    await seedWeek();
    const res = await get(W, 'wechat-1', { 'sec-fetch-site': 'cross-site' });
    expect(res.status).toBe(403);
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('401 without a session, with a Bearer token only, or when the session check throws', async () => {
    await seedWeek();
    h.session = false;
    expect((await get(W, 'wechat-1')).status).toBe(401);
    // A real, valid API token (it would pass principalFrom) still can't fetch the images.
    const { token } = await createToken('cron', ['ingest', 'publish']);
    const bearer = { authorization: `Bearer ${token}` };
    expect(await tokenFrom(new Request('http://localhost/api/x', { headers: bearer }))).toMatchObject({ kind: 'token', name: 'cron' });
    expect((await get(W, 'wechat-1', bearer)).status).toBe(401);
    h.session = true;
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const res = await get(W, 'wechat-1', { cookie: 'broken' });
    expect(res.status).toBe(401);
    expect(await res.text()).toBe('');
  });

  it('404 for a malformed week or name, a week without an issue (never created), a week without picks, or a part past the end', async () => {
    await seedWeek();
    for (const [week, name] of [['2026-42', 'wechat-1'], [W, 'wechat-0'], [W, 'xhs-9'], [W, 'xhs-1.png'], [W, 'cover']]) {
      expect((await get(week, name)).status).toBe(404);
    }
    expect((await get('2026-W43', 'wechat-1')).status).toBe(404);
    expect(await getIssueByWeek('2026-W43', { db: db() })).toBeNull();
    await ensureIssue('2026-W44', { db: db() }); // an issue with no events in its week
    expect((await get('2026-W44', 'xhs-0')).status).toBe(404);
    expect((await get(W, 'wechat-2')).status).toBe(404); // one part only
    expect((await get(W, 'xhs-2')).status).toBe(404); // a cover and one page of three
  });

  it('500 (no-store) when the export cannot be read', async () => {
    h.db = { select: () => { throw new Error('db down'); } };
    const res = await get(W, 'wechat-1');
    expect(res.status).toBe(500);
    expect(res.headers.get('cache-control')).toBe('no-store');
  });
});

describe('images', () => {
  it('the WeChat long image: a 1080 px PNG as tall as planned, inline, private, never stored without ?v=', async () => {
    await seedWeek();
    const res = await get(W, 'wechat-1');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(res.headers.get('content-disposition')).toBe(`inline; filename="victor-picks-${W}-wechat-1.png"`);
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    expect(res.headers.get('x-robots-tag')).toBe('noindex');
    const body = Buffer.from(await res.arrayBuffer());
    expect(res.headers.get('content-length')).toBe(String(body.byteLength));
    expect([...body.subarray(0, 8)]).toEqual(PNG);
    const meta = await sharp(body).metadata();
    const planned = longPlan((await loadExport(W, new Date()))!.model!)[0].height;
    expect([meta.format, meta.width, meta.height]).toEqual(['png', 1080, planned]);
  });

  it('Xiaohongshu cover and page: 1080×1440 PNGs', async () => {
    await seedWeek();
    for (const name of ['xhs-0', 'xhs-1']) {
      const res = await get(W, name);
      expect(res.status).toBe(200);
      const meta = await sharp(Buffer.from(await res.arrayBuffer())).metadata();
      expect([meta.format, meta.width, meta.height]).toEqual(['png', 1080, 1440]);
    }
  });

  it('the page\'s fingerprint makes the image immutable in the private cache; any other ?v= does not', async () => {
    const { issue } = await seedWeek();
    // As /admin/digest computes it: the draft's live assembly, no live rows, the covers switch off.
    const snap = await buildSnapshot(issue, { db: db() });
    const panels = exportPanels(snap, issue, null, new Date(), false);
    const v = panels.social.wechat!.v;
    const xv = panels.social.xhs!.v;
    const ok = await get(W, 'wechat-1', {}, v);
    expect(ok.headers.get('cache-control')).toBe('private, max-age=31536000, immutable');
    expect(ok.headers.get('x-export-v')).toBe(v);
    expect((await get(W, 'xhs-1', {}, xv)).headers.get('cache-control')).toBe('private, max-age=31536000, immutable');
    // A page older than the issue: still drawn (no-store), and the image says which version it is,
    // so the panel asks for a reload instead of saving images numbered differently from its text.
    const old = await get(W, 'wechat-1', {}, 'stale0000000000');
    expect(old.headers.get('cache-control')).toBe('private, no-store');
    expect(old.headers.get('x-export-v')).toBe(v);
    const other = await get(W, 'xhs-1', {}, v);
    expect(other.headers.get('cache-control')).toBe('private, no-store'); // the WeChat hash is not the XHS one
    expect(other.headers.get('x-export-v')).toBe(xv);
  });

  it('503 (no-store) when a font chunk is missing: never an image with blank Chinese', async () => {
    await seedWeek();
    h.fontsComplete = false;
    const res = await get(W, 'xhs-0');
    expect(res.status).toBe(503);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('content-type')).not.toBe('image/png');
  });
});

describe('loadExport: the same rules as the WeChat text', () => {
  it('a draft is assembled live; a frozen issue follows cancellations and takedowns since the freeze', async () => {
    const { issue, ids } = await seedWeek();
    const draft = (await loadExport(W, NOW))!;
    expect(draft.issue.id).toBe(issue.id);
    expect(draft.model!.picks).toBe(3);
    expect(draft.allToTemplate).toBe(false);

    const snapshot = await buildSnapshot(issue, { db: db() });
    await db().update(digestIssues).set({ status: 'sent', snapshot, sentAt: NOW }).where(eq(digestIssues.id, issue.id));
    await db().update(events).set({ status: 'cancelled' }).where(eq(events.id, ids[1]));
    await db().update(events).set({ status: 'archived' }).where(eq(events.id, ids[2]));
    const frozen = (await loadExport(W, NOW))!.model!;
    expect(frozen.days.flatMap((d) => d.items).map((it) => [it.eventId, it.n])).toEqual([[ids[0], 1], [ids[1], null]]);
    expect(frozen).toMatchObject({ picks: 1, going: 1 });

    vi.stubEnv('SHOW_ATTENDANCE', 'false'); // the kill switch now
    expect((await loadExport(W, NOW))!.model!).toMatchObject({ going: 0 });
    expect((await get(W, 'wechat-1')).status).toBe(200);
  });
});

describe('real covers in the WeChat long image', () => {
  const BLOB = 'https://abc123.public.blob.vercel-storage.com/covers/';
  const webp = () => sharp({ create: { width: 640, height: 480, channels: 3, background: '#336699' } }).webp().toBuffer();

  /** An event with an uploaded (non-template) cover in Blob, which the email uses with its credit. */
  async function withCover(over: Partial<NewEvent> = {}) {
    const id = await addEvent(over);
    const coverId = newId('cov');
    const url = `${BLOB}${id}/abc-400.webp`;
    await db().insert(covers).values({
      id: coverId, kind: 'upload', url1600: url, url800: url, url400: url, urlOgEn: '', urlOgZh: '', thumbhash: '', dominant: '', bytes: 1,
      attribution: 'Photo: Example Host',
    });
    await db().update(events).set({ coverId }).where(eq(events.id, id));
    return { id, coverId, url };
  }

  it('a cover that fails to load is drawn as the template and never cached, even under the current ?v=', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const cover = await withCover();
    const issue = await ensureIssue(W, { db: db() });
    const v = exportPanels(await buildSnapshot(issue, { db: db() }), issue, null, new Date(), false).social.wechat!.v;
    expect((await loadExport(W, NOW))!.model!.days[0].items[0]).toMatchObject({ coverId: cover.coverId, credit: 'Photo: Example Host' });

    const failed = await get(W, 'wechat-1', {}, v);
    expect(failed.status).toBe(200);
    expect(h.fetched).toEqual([cover.url]);
    expect(failed.headers.get('cache-control')).toBe('private, no-store');

    h.fetchBytes = () => webp();
    const drawn = await get(W, 'wechat-1', {}, v);
    expect(drawn.headers.get('cache-control')).toBe('private, max-age=31536000, immutable');
    expect(h.fetched).toEqual([cover.url, cover.url]);
  });

  it('a frozen issue whose cover was taken down since: a new ?v=, the template and no credit', async () => {
    h.fetchBytes = () => webp();
    const cover = await withCover();
    const issue = await ensureIssue(W, { db: db() });
    const snapshot = await buildSnapshot(issue, { db: db() });
    await db().update(digestIssues).set({ status: 'sent', snapshot, sentAt: NOW }).where(eq(digestIssues.id, issue.id));
    const sent = (await getIssueByWeek(W, { db: db() }))!;
    const panel = async () => exportPanels(snapshot, sent, await liveFor(snapshot), new Date(), false).social;

    const before = await panel();
    const cached = await get(W, 'wechat-1', {}, before.wechat!.v);
    expect(cached.headers.get('cache-control')).toBe('private, max-age=31536000, immutable');
    expect(h.fetched).toEqual([cover.url]);

    // "Back to the template" (a takedown): a new covers row; the old row and its files are gone.
    await coverToTemplate(cover.id, { db: db(), store: null });
    const after = await panel();
    expect(after.wechat!.v).not.toBe(before.wechat!.v); // the year-long cached image is never asked for again
    expect(after.xhs!.v).not.toBe(before.xhs!.v);
    expect((await loadExport(W, NOW))!.model!.days[0].items[0]).toMatchObject({ coverId: null, credit: null });

    const old = await get(W, 'wechat-1', {}, before.wechat!.v);
    expect(old.headers.get('cache-control')).toBe('private, no-store');
    expect(old.headers.get('x-export-v')).toBe(after.wechat!.v);
    expect((await get(W, 'wechat-1', {}, after.wechat!.v)).headers.get('cache-control')).toBe('private, max-age=31536000, immutable');
    expect(h.fetched).toEqual([cover.url]); // the removed cover is never fetched again
  });
});
