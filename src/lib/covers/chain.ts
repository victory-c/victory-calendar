import 'server-only';
import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import sharp from 'sharp';
import { db as defaultDb, type DB } from '../db';
import { covers, events } from '../db/schema';
import { platformName } from '../events/platform';
import { newId } from '../ids';
import { publicSafeUrl } from '../ingest/normalize';
import { safeFetchBytes } from '../ingest/safe-fetch';
import { readSetting } from '../settings';
import type { Category } from '../taxonomy';
import { type AiDeps, aiCredit, type AiTier, isAiCandidate, isAiTier, sweepAiCandidates } from './ai';
import { blobConfigured, blobStore, isBlobUrl, type Store } from './blob';
import { BRAVE_THUMB_HOST } from './brave';
import { coverEdit, formatOpenverseCredit, licenseCode, viaHost } from './credit';
import { CoverSourceError, noBlob } from './errors';
import { type OpenverseImage, openverseImage } from './openverse';
import { type ProcessedCover, processCover } from './process';
import { templateCoverRow } from './template';

// Cover chain (guide「封面图获取」): 1 official → 2 host composite → 3 typographic template.
// Runs in after() within ~15 s; automatic runs never go past step 3. Manual picks (upload,
// pasted URL, and the selector's steps 4–6: Openverse, AI, Brave) go through the same processing
// and storage, and replace whatever cover was there (attachCover deletes the old files).

export type CoverKind = (typeof covers.$inferInsert)['kind'];

export type ChainDeps = {
  db?: DB;
  store?: Store | null;
  fetchBytes?: (url: string, maxBytes: number) => Promise<Buffer>;
  renderTemplate?: (o: { category: Category; hostName: string | null; avatars?: string[] }) => Promise<Buffer>;
  /** Overrides the settings kill switch lookup (tests). */
  officialToTemplate?: boolean;
};

export type ChainInput = {
  eventId: string;
  /** Step 1 source from the adapter (already the largest useful size). */
  officialUrl: string | null;
  /** Step 2 sources: host / calendar avatars. */
  hostImages: string[];
  sourcePageUrl: string;
};

export type ChainResult = { kind: 'official' | 'host_composite' | 'template' | 'none'; coverId: string | null; tried: string[] };

const fetchDefault = (url: string, maxBytes: number) => safeFetchBytes(url, { maxBytes });

const renderDefault: NonNullable<ChainDeps['renderTemplate']> = async (o) =>
  (await import('../og/render')).renderTemplatePng(o);

async function upload(store: Store, eventId: string, p: ProcessedCover) {
  const hash = createHash('sha256').update(p.master).digest('hex').slice(0, 16);
  const [u1600, u800, u400] = await Promise.all([
    store.put(`covers/${eventId}/${hash}-1600.webp`, p.master, 'image/webp'),
    store.put(`covers/${eventId}/${hash}-800.webp`, p.mid, 'image/webp'),
    store.put(`covers/${eventId}/${hash}-400.webp`, p.small, 'image/webp'),
  ]);
  return { url1600: u1600, url800: u800, url400: u400 };
}

type NewCover = Omit<typeof covers.$inferInsert, 'id'>;

/**
 * Point the event at a new cover row and drop the old one (and its Blob files).
 * `onlyOverTemplate`: automatic runs never replace a cover Victor picked.
 */
export async function attachCover(db: DB, store: Store | null, eventId: string, cover: NewCover, onlyOverTemplate: boolean) {
  const [ev] = await db
    .select({ coverId: events.coverId, kind: covers.kind })
    .from(events)
    .leftJoin(covers, eq(covers.id, events.coverId))
    .where(eq(events.id, eventId));
  if (!ev) return null;
  if (onlyOverTemplate && ev.coverId && ev.kind !== 'template') return null;
  const id = newId('cov');
  await db.insert(covers).values({ id, ...cover });
  await db.update(events).set({ coverId: id, updatedAt: new Date() }).where(eq(events.id, eventId));
  if (ev.coverId) {
    const [old] = await db.select().from(covers).where(eq(covers.id, ev.coverId));
    await db.delete(covers).where(eq(covers.id, ev.coverId));
    const files = old ? [old.url1600, old.url800, old.url400].filter(isBlobUrl) : [];
    if (store && files.length) await store.del([...new Set(files)]).catch((e) => console.warn('[covers] delete failed', e));
  }
  return id;
}

async function avatarDataUrl(bytes: Buffer) {
  const png = await sharp(bytes, { animated: false }).autoOrient().resize(256, 256, { fit: 'cover' }).png().toBuffer();
  return `data:image/png;base64,${png.toString('base64')}`;
}

export async function runCoverChain(input: ChainInput, deps: ChainDeps = {}): Promise<ChainResult> {
  const db = deps.db ?? defaultDb;
  const store = deps.store === undefined ? (blobConfigured() ? blobStore : null) : deps.store;
  const fetchBytes = deps.fetchBytes ?? fetchDefault;
  const render = deps.renderTemplate ?? renderDefault;
  const tried: string[] = [];

  const [ev] = await db
    .select({ category: events.category, hostName: events.hostName, policy: events.coverPolicy, coverId: events.coverId, kind: covers.kind })
    .from(events)
    .leftJoin(covers, eq(covers.id, events.coverId))
    .where(eq(events.id, input.eventId));
  if (!ev) return { kind: 'none', coverId: null, tried };
  if (ev.coverId && ev.kind !== 'template') return { kind: 'none', coverId: ev.coverId, tried: ['kept'] };

  const killSwitch = deps.officialToTemplate ?? (await readSetting('official_covers_to_template')).on;
  const platform = platformName(input.sourcePageUrl) ?? 'the web';
  const host = ev.hostName ?? platform;

  if (store && ev.policy === 'official' && !killSwitch) {
    // Step 1: official cover.
    if (input.officialUrl) {
      tried.push('official');
      try {
        const p = await processCover(await fetchBytes(input.officialUrl, 15_000_000));
        const urls = await upload(store, input.eventId, p);
        const id = await attachCover(db, store, input.eventId, {
          kind: 'official', ...urls, urlOgEn: '', urlOgZh: '', thumbhash: p.thumbhash, dominant: p.dominant,
          bytes: p.master.byteLength, letterboxed: p.letterboxed, sourceUrl: publicSafeUrl(input.officialUrl),
          sourcePageUrl: input.sourcePageUrl, attribution: `Cover: ${host} via ${platform}`,
        }, true);
        if (id) return { kind: 'official', coverId: id, tried };
      } catch (e) {
        console.warn('[covers] official failed:', e instanceof Error ? e.message : e);
      }
    }
    // Step 2: host avatars on the category template.
    if (input.hostImages.length && ev.category) {
      tried.push('host_composite');
      try {
        const avatars = (
          await Promise.all(
            input.hostImages.slice(0, 3).map((u) => fetchBytes(u, 5_000_000).then(avatarDataUrl).catch(() => null)),
          )
        ).filter((x): x is string => Boolean(x));
        if (avatars.length) {
          const p = await processCover(await render({ category: ev.category, hostName: ev.hostName, avatars }));
          const urls = await upload(store, input.eventId, p);
          const id = await attachCover(db, store, input.eventId, {
            kind: 'host_composite', ...urls, urlOgEn: '', urlOgZh: '', thumbhash: p.thumbhash, dominant: p.dominant,
            bytes: p.master.byteLength, letterboxed: false, sourcePageUrl: input.sourcePageUrl,
            attribution: `Host photos via ${platform}`,
          }, true);
          if (id) return { kind: 'host_composite', coverId: id, tried };
        }
      } catch (e) {
        console.warn('[covers] host composite failed:', e instanceof Error ? e.message : e);
      }
    }
  }

  // Step 3: deterministic template; never fails. Needs a category.
  if (!ev.category) return { kind: 'none', coverId: null, tried };
  tried.push('template');
  if (ev.coverId && ev.kind === 'template') return { kind: 'template', coverId: ev.coverId, tried };
  const id = await attachCover(db, store, input.eventId, templateCoverRow(ev.category, ev.hostName), true);
  return { kind: 'template', coverId: id, tried };
}

/**
 * Manual pick in the cover selector: pasted image URL (fetched through safe-fetch). The fetch
 * uses the link as given (signed image links need their parameters); what we store, and show as
 * the cover's source, is the scrubbed form. Links with a login are refused.
 */
export async function coverFromUrl(eventId: string, url: string, deps: ChainDeps = {}) {
  const clean = publicSafeUrl(url);
  if (!clean) throw new Error('only plain https image links without a username or password');
  const store = deps.store === undefined ? (blobConfigured() ? blobStore : null) : deps.store;
  if (!store) throw new Error('Blob storage is not configured');
  const p = await processCover(await (deps.fetchBytes ?? fetchDefault)(url, 15_000_000));
  return attachPicked(deps.db ?? defaultDb, store, eventId, p, { kind: 'url', sourceUrl: clean, sourcePageUrl: clean });
}

/**
 * Manual pick: a photo uploaded straight to Blob by the client; processed, then the original is
 * removed, also when it can't be used (not an image, too small) or the event is gone.
 */
export async function coverFromUpload(eventId: string, blobUrl: string, deps: ChainDeps = {}) {
  // Only the picker's own uploads (CoverPanel writes uploads/<eventId>-…): this deletes the file afterwards.
  if (!isBlobUrl(blobUrl) || !new URL(blobUrl).pathname.startsWith('/uploads/')) throw new Error('not a Blob upload');
  const store = deps.store === undefined ? (blobConfigured() ? blobStore : null) : deps.store;
  if (!store) throw new Error('Blob storage is not configured');
  try {
    const p = await processCover(await (deps.fetchBytes ?? fetchDefault)(blobUrl, 15_000_000));
    return await attachPicked(deps.db ?? defaultDb, store, eventId, p, { kind: 'upload' });
  } finally {
    await store.del([blobUrl]).catch(() => undefined);
  }
}

type PickMeta = Pick<NewCover, 'kind' | 'sourceUrl' | 'sourcePageUrl' | 'license' | 'attribution'>;

/** Store a processed manual pick in Blob and make it the cover, replacing (and deleting) the old one. */
async function attachPicked(db: DB, store: Store, eventId: string, p: ProcessedCover, meta: PickMeta) {
  const urls = await upload(store, eventId, p);
  const id = await attachCover(db, store, eventId, {
    ...meta, ...urls, urlOgEn: '', urlOgZh: '', thumbhash: p.thumbhash, dominant: p.dominant,
    bytes: p.master.byteLength, letterboxed: p.letterboxed,
  }, false);
  if (!id) {
    // The event is gone; don't leave its files behind.
    await store.del([urls.url1600, urls.url800, urls.url400]).catch(() => undefined);
    throw new CoverSourceError('bad_input', 'Event not found · 找不到这个活动');
  }
  return id;
}

/** Original first; a dead, oversize or odd original falls back to the source's own smaller copy. */
async function fetchWithFallback(fetchBytes: NonNullable<ChainDeps['fetchBytes']>, original: string, fallback: string | null) {
  try {
    return { p: await processCover(await fetchBytes(original, 15_000_000)), lowRes: false };
  } catch (e) {
    if (!fallback) throw e;
    console.warn('[covers] original unusable, using the thumbnail:', e instanceof Error ? e.name : 'error');
    return { p: await processCover(await fetchBytes(fallback, 5_000_000)), lowRes: true };
  }
}

const storeFor = (deps: ChainDeps) => {
  const store = deps.store === undefined ? (blobConfigured() ? blobStore : null) : deps.store;
  if (!store) throw noBlob();
  return store;
};

/**
 * Selector step 4: an Openverse image. The licence is read again from Openverse's own record (not
 * from the client); the credit and licence are stored with the cover. `lowRes` when only
 * Openverse's thumbnail could be used.
 */
export async function coverFromOpenverse(
  eventId: string,
  openverseId: string,
  deps: ChainDeps & { detail?: (id: string) => Promise<OpenverseImage> } = {},
) {
  const store = storeFor(deps);
  const img = await (deps.detail ?? openverseImage)(openverseId);
  const { p, lowRes } = await fetchWithFallback(deps.fetchBytes ?? fetchDefault, img.url, img.thumbUrl);
  const coverId = await attachPicked(deps.db ?? defaultDb, store, eventId, p, {
    kind: 'openverse',
    sourceUrl: publicSafeUrl(img.url) ?? (lowRes ? img.thumbUrl : null),
    sourcePageUrl: img.pageUrl,
    license: licenseCode(img.license, img.licenseVersion),
    attribution: formatOpenverseCredit({ title: img.title, creator: img.creator, license: img.license, version: img.licenseVersion, edit: coverEdit(p) }),
  });
  return { coverId, lowRes };
}

export type BravePick = { imageUrl: string; pageUrl: string; thumbUrl?: string | null };

/**
 * Selector step 6: a Brave search suggestion Victor tapped. The links come from the client, so they
 * get the same checks as a pasted link (plain https, safe-fetch); the image is fetched from its own
 * host (never with the Brave key), with Brave's thumbnail as the fallback. Credited to the page.
 */
export async function coverFromBrave(eventId: string, pick: BravePick, deps: ChainDeps = {}) {
  const image = publicSafeUrl(pick.imageUrl);
  const page = publicSafeUrl(pick.pageUrl);
  if (!image || !page) throw new CoverSourceError('bad_input', 'Only plain https links · 只接受普通 https 链接');
  const thumb = pick.thumbUrl && publicSafeUrl(pick.thumbUrl) && new URL(pick.thumbUrl).hostname === BRAVE_THUMB_HOST ? pick.thumbUrl : null;
  const store = storeFor(deps);
  const { p, lowRes } = await fetchWithFallback(deps.fetchBytes ?? fetchDefault, pick.imageUrl, thumb);
  const coverId = await attachPicked(deps.db ?? defaultDb, store, eventId, p, {
    kind: 'brave', sourceUrl: image, sourcePageUrl: page, license: null, attribution: `Image via ${viaHost(page)}`,
  });
  return { coverId, lowRes };
}

/**
 * Selector step 5: apply an AI preview made by generateAiCandidate for this event. Every preview
 * of the event (this one included) is deleted afterwards.
 */
export async function coverFromAiCandidate(eventId: string, blobUrl: string, tier: AiTier, deps: ChainDeps & Pick<AiDeps, 'listBlobs'> = {}) {
  if (!isAiTier(tier) || !isAiCandidate(eventId, blobUrl)) throw new CoverSourceError('bad_input', 'Not an AI preview for this event · 不是这个活动的 AI 预览图');
  const store = storeFor(deps);
  const p = await processCover(await (deps.fetchBytes ?? fetchDefault)(blobUrl, 15_000_000));
  const coverId = await attachPicked(deps.db ?? defaultDb, store, eventId, p, { kind: 'ai', attribution: aiCredit(tier) });
  await store.del([blobUrl]).catch(() => undefined);
  await sweepAiCandidates(eventId, store, deps);
  return coverId;
}

/** Manual pick: back to the template (e.g. "建议换模板" on a letterboxed cover). */
export async function coverToTemplate(eventId: string, deps: ChainDeps = {}) {
  const db = deps.db ?? defaultDb;
  const [ev] = await db.select({ category: events.category, hostName: events.hostName }).from(events).where(eq(events.id, eventId));
  if (!ev?.category) throw new Error('event needs a category first');
  const store = deps.store === undefined ? (blobConfigured() ? blobStore : null) : deps.store;
  return attachCover(db, store, eventId, templateCoverRow(ev.category, ev.hostName), false);
}
