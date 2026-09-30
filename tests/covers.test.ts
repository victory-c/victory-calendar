import { eq } from 'drizzle-orm';
import sharp from 'sharp';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Store } from '@/lib/covers/blob';
import { coverFromUpload, coverFromUrl, coverToTemplate, runCoverChain, type ChainDeps } from '@/lib/covers/chain';
import { CoverError, processCover } from '@/lib/covers/process';
import type { DB } from '@/lib/db';
import { covers, events } from '@/lib/db/schema';
import { testDb } from './helpers/pglite';

const img = (w: number, h: number, fmt: 'png' | 'jpeg' = 'png', color = { r: 200, g: 60, b: 40 }) =>
  sharp({ create: { width: w, height: h, channels: 3, background: color } })[fmt]().toBuffer();

describe('processCover', () => {
  it('centre-crops near-square images to three WebP squares with a thumbhash', async () => {
    const p = await processCover(await img(1000, 900));
    expect(p.letterboxed).toBe(false);
    for (const [buf, px] of [[p.master, 1600], [p.mid, 800], [p.small, 400]] as const) {
      const m = await sharp(buf).metadata();
      expect([m.format, m.width, m.height]).toEqual(['webp', px, px]);
    }
    expect(p.dominant).toMatch(/^rgb\(\d+ \d+ \d+\)$/);
    expect(Buffer.from(p.thumbhash, 'base64').byteLength).toBeLessThan(40);
  });

  it('letterboxes 2:1 banners on their dominant colour instead of cropping', async () => {
    const p = await processCover(await img(1600, 800, 'jpeg', { r: 20, g: 120, b: 200 }));
    expect(p.letterboxed).toBe(true);
    const { dominant } = await sharp(p.small).stats();
    expect(Math.abs(dominant.b - 200)).toBeLessThan(30);
  });

  it('reads EXIF orientation for the aspect ratio and strips metadata', async () => {
    const rotated = await sharp(await img(1200, 600, 'jpeg')).withMetadata({ orientation: 6 }).jpeg().toBuffer();
    const p = await processCover(rotated);
    expect([p.width, p.height]).toEqual([600, 1200]);
    const m = await sharp(p.master).metadata();
    expect(m.exif).toBeUndefined();
    expect(m.orientation).toBeUndefined();
  });

  it('refuses SVG, non-images and tiny images', async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="800" height="800"><rect width="800" height="800"/></svg>');
    await expect(processCover(svg)).rejects.toMatchObject({ code: 'unsupported' });
    await expect(processCover(Buffer.from('<html>nope</html>'))).rejects.toBeInstanceOf(CoverError);
    await expect(processCover(await img(120, 120))).rejects.toMatchObject({ code: 'too_small' });
  });
});

describe('cover chain', () => {
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
    await db.insert(events).values({
      id: 'evt_1', slug: 'agent-night', status: 'draft', sourceUrl: 'https://luma.com/abcd1234',
      category: 'hackathon', hostName: 'Example Labs', titleEn: 'Agent Night',
    });
  });

  const official = 'https://images.lumacdn.com/uploads/op/cover.png';
  const avatar = 'https://images.lumacdn.com/uploads/kd/host.jpg';
  const deps = (over: Partial<ChainDeps> = {}): ChainDeps => ({
    db, store, officialToTemplate: false,
    fetchBytes: async (url) => {
      if (url === official) return img(1920, 1920);
      if (url === avatar) return img(400, 400, 'jpeg');
      throw new Error(`404 ${url}`);
    },
    renderTemplate: async () => img(1600, 1600),
    ...over,
  });
  const input = { eventId: 'evt_1', officialUrl: official, hostImages: [avatar], sourcePageUrl: 'https://luma.com/abcd1234' };
  const cover = async () => {
    const [e] = await db.select().from(events).where(eq(events.id, 'evt_1'));
    return e.coverId ? (await db.select().from(covers).where(eq(covers.id, e.coverId)))[0] : null;
  };

  it('step 1: stores the official cover with attribution', async () => {
    const r = await runCoverChain(input, deps());
    expect(r).toMatchObject({ kind: 'official', tried: ['official'] });
    const c = await cover();
    expect(c).toMatchObject({ kind: 'official', sourceUrl: official, attribution: 'Cover: Example Labs via Luma', letterboxed: false });
    expect(c!.url400).toMatch(/^https:\/\/store0\.public\.blob\.vercel-storage\.com\/covers\/evt_1\/[0-9a-f]{16}-400/);
    expect(store.files.size).toBe(3);
  });

  it('step 2: host composite when the official cover fails', async () => {
    const r = await runCoverChain({ ...input, officialUrl: 'https://images.lumacdn.com/broken.png' }, deps());
    expect(r).toMatchObject({ kind: 'host_composite', tried: ['official', 'host_composite'] });
    expect((await cover())!.attribution).toBe('Host photos via Luma');
  });

  it('step 3: template when nothing else works, and without a Blob store', async () => {
    const r = await runCoverChain({ ...input, officialUrl: null, hostImages: [] }, deps());
    expect(r.kind).toBe('template');
    expect((await cover())!.url1600).toMatch(/\/og\/template\/hackathon\?s=1600&h=Example\+Labs$/);
    const noStore = await runCoverChain(input, deps({ store: null }));
    expect(noStore).toMatchObject({ kind: 'template', tried: ['template'] });
  });

  it('respects cover_policy=template and the official→template kill switch', async () => {
    expect((await runCoverChain(input, deps({ officialToTemplate: true }))).kind).toBe('template');
    await db.update(events).set({ coverPolicy: 'template' }).where(eq(events.id, 'evt_1'));
    expect((await runCoverChain(input, deps())).kind).toBe('template');
  });

  it('replaces a template with the official cover and cleans up; never replaces a manual pick', async () => {
    await runCoverChain({ ...input, officialUrl: null, hostImages: [] }, deps());
    const tpl = await cover();
    await runCoverChain(input, deps());
    expect((await cover())!.kind).toBe('official');
    expect(await db.select().from(covers).where(eq(covers.id, tpl!.id))).toHaveLength(0);

    await coverFromUrl('evt_1', official, deps());
    const manual = await cover();
    expect(manual!.kind).toBe('url');
    expect(store.deleted).toHaveLength(3); // the replaced official files
    expect(await runCoverChain(input, deps())).toMatchObject({ kind: 'none', tried: ['kept'] });
    expect((await cover())!.id).toBe(manual!.id);
  });

  it('pasted URL: fetched as given, stored scrubbed; logins refused', async () => {
    const signed = 'https://cdn.example.org/poster.jpg?w=1600&X-Amz-Signature=abc&token=s3cret';
    const seen: string[] = [];
    await coverFromUrl('evt_1', signed, deps({ fetchBytes: async (u) => (seen.push(u), img(1200, 1200, 'jpeg')) }));
    expect(seen).toEqual([signed]);
    const c = await cover();
    expect(c).toMatchObject({ kind: 'url', sourceUrl: 'https://cdn.example.org/poster.jpg?w=1600', sourcePageUrl: 'https://cdn.example.org/poster.jpg?w=1600' });
    await expect(coverFromUrl('evt_1', 'https://u:p@cdn.example.org/a.jpg', deps())).rejects.toThrow(/username or password/);
  });

  it('upload: processes the original, then deletes it', async () => {
    const original = 'https://store0.public.blob.vercel-storage.com/uploads/photo.jpg';
    await coverFromUpload('evt_1', original, deps({ fetchBytes: async () => img(900, 1200, 'jpeg') }));
    expect((await cover())!.kind).toBe('upload');
    expect(store.deleted).toContain(original);
    await expect(coverFromUpload('evt_1', 'https://evil.example/x.jpg', deps())).rejects.toThrow();
  });

  it('back to template on request', async () => {
    await runCoverChain(input, deps());
    await coverToTemplate('evt_1', deps());
    expect((await cover())!.kind).toBe('template');
  });
});
