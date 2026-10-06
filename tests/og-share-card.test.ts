import type { ReactElement } from 'react';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PublicCover, PublicEvent } from '@/lib/events/types';

// /og/[lang]/[slug]: the share card's cover reaches Satori as a JPEG data URL (Satori can't decode
// the stored WebP), and covers whose credit can't be shown on the card use the template. A cover
// that fails to load also gives the template, cached for a minute rather than a day.

const h = vi.hoisted(() => ({ event: null as unknown, rendered: [] as { el: ReactElement; opts: unknown }[] }));
vi.mock('@/lib/events/queries', () => ({ getEventBySlug: async () => ({ event: h.event, now: '', events: [], showAttendance: true, sample: false }) }));
vi.mock('@/lib/og/fonts', () => ({ ogFonts: async () => [] }));
vi.mock('next/og', () => ({
  ImageResponse: class extends Response {
    constructor(el: ReactElement, opts: { headers?: Record<string, string> }) {
      super('png', { headers: opts.headers });
      h.rendered.push({ el, opts });
    }
  },
}));

const { GET } = await import('@/app/og/[lang]/[slug]/route');
const { shareCardCover } = await import('@/lib/covers/share-card');
const { __setHopForTests } = await import('@/lib/ingest/safe-fetch');

const URL800 = 'https://store0.public.blob.vercel-storage.com/covers/evt_1/abc-800.webp';
const coverOf = (kind: PublicCover['kind'], over: Partial<PublicCover> = {}): PublicCover => ({
  kind, url400: URL800.replace('800', '400'), url800: URL800, url1600: URL800.replace('800', '1600'), thumbhash: '', dominant: '',
  letterboxed: false, attribution: null, license: null, sourcePageUrl: null, ...over,
});
const eventWith = (cover: PublicCover | null) =>
  ({
    id: 'evt_1', slug: 'agent-night', status: 'published', titleEn: 'Agent Night', titleZh: '智能体之夜', category: 'ai', hostName: 'Example Labs',
    startAt: new Date('2026-10-08T01:00:00Z'), endAt: null, tz: 'America/Los_Angeles', cover,
  }) as unknown as PublicEvent;

let fetched: string[] = [];
let restore: () => void;
beforeEach(async () => {
  h.rendered = [];
  fetched = [];
  const webp = await sharp({ create: { width: 800, height: 800, channels: 3, background: { r: 10, g: 150, b: 90 } } }).webp().toBuffer();
  restore = __setHopForTests(async (url) => {
    fetched.push(url.toString());
    const ok = url.toString() === URL800;
    return {
      status: ok ? 200 : 404,
      headers: ok ? { 'content-type': 'image/webp' } : {},
      body: { async *[Symbol.asyncIterator]() { if (ok) yield webp; }, destroy() {} },
    };
  });
});
afterEach(() => restore());

const LONG = 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800';
const SHORT = 'public, max-age=60, s-maxage=60';
/** cache-control of the last render. */
let cache: string | null = null;
const render = async (cover: PublicCover | null) => {
  h.event = eventWith(cover);
  const res = await GET(new Request('https://picks.example.org/og/en/agent-night'), { params: Promise.resolve({ lang: 'en', slug: 'agent-night' }) });
  expect(res.status).toBe(200);
  cache = res.headers.get('cache-control');
  return (h.rendered.at(-1)!.el.props as { coverSrc: string | null }).coverSrc;
};

describe('share card cover', () => {
  it('converts the stored WebP to a 630² JPEG data URL before Satori sees it', async () => {
    const src = await render(coverOf('official', { attribution: 'Cover: Example Labs via Partiful' }));
    expect(src).toMatch(/^data:image\/jpeg;base64,/);
    const meta = await sharp(Buffer.from(src!.split(',')[1], 'base64')).metadata();
    expect([meta.format, meta.width, meta.height]).toEqual(['jpeg', 630, 630]);
    expect(fetched).toEqual([URL800]);
  });

  it('AI, uploads and CC0 Openverse covers are drawn; Brave and other Openverse licences use the template', async () => {
    expect(await render(coverOf('ai'))).toMatch(/^data:image\/jpeg/);
    expect(await render(coverOf('upload'))).toMatch(/^data:image\/jpeg/);
    expect(await render(coverOf('openverse', { license: 'cc0/1.0' }))).toMatch(/^data:image\/jpeg/);
    fetched = [];
    expect(await render(coverOf('brave', { attribution: 'Image via host.example' }))).toBeNull();
    expect(await render(coverOf('openverse', { license: 'by/2.0' }))).toBeNull();
    expect(await render(coverOf('openverse', { license: 'by-sa/4.0' }))).toBeNull();
    expect(await render(coverOf('template'))).toBeNull();
    expect(await render(null)).toBeNull();
    expect(fetched).toEqual([]);
  });

  it('a missing file or a non-Blob URL falls back to the template instead of failing the card', async () => {
    expect(await render(coverOf('upload', { url800: URL800.replace('abc', 'gone') }))).toBeNull();
    fetched = [];
    expect(await shareCardCover(coverOf('url', { url800: 'https://evil.example/x.webp' }))).toEqual({ src: null, degraded: false });
    expect(await shareCardCover(coverOf('url', { url800: 'https://store0.public.blob.vercel-storage.com/covers/x-800.webp' }), {
      fetchBytes: async () => Buffer.from('not an image'),
    })).toEqual({ src: null, degraded: true });
    expect(fetched).toEqual([]);
  });

  it('a cover that failed to load is cached for a minute; real covers and policy fallbacks for a day', async () => {
    expect(await render(coverOf('upload'))).toMatch(/^data:image\/jpeg/);
    expect(cache).toBe(LONG);
    for (const settled of [coverOf('openverse', { license: 'by-sa/2.0' }), coverOf('brave'), coverOf('template'), null]) {
      expect(await render(settled)).toBeNull();
      expect(cache).toBe(LONG);
    }
    // Same card URL (?v= doesn't change on a blip): a 404 from Blob, then a timeout.
    expect(await render(coverOf('upload', { url800: URL800.replace('abc', 'gone') }))).toBeNull();
    expect(cache).toBe(SHORT);
    const timeout = Object.assign(new Error('slow'), { name: 'TimeoutError' });
    expect(await shareCardCover(coverOf('ai'), { fetchBytes: async () => { throw timeout; } })).toEqual({ src: null, degraded: true });
    restore();
    restore = __setHopForTests(async () => { throw timeout; });
    expect(await render(coverOf('ai'))).toBeNull();
    expect(cache).toBe(SHORT);
  });
});
