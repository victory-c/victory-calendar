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
import { blobConfigured, blobStore, isBlobUrl, type Store } from './blob';
import { type ProcessedCover, processCover } from './process';
import { templateCoverRow } from './template';

// Cover chain (guide「封面图获取」): 1 official → 2 host composite → 3 typographic template.
// Runs in after() within ~15 s; automatic runs never go past step 3. Manual picks (upload,
// pasted URL) go through the same processing and storage.

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
  const db = deps.db ?? defaultDb;
  const p = await processCover(await (deps.fetchBytes ?? fetchDefault)(url, 15_000_000));
  const urls = await upload(store, eventId, p);
  return attachCover(db, store, eventId, {
    kind: 'url', ...urls, urlOgEn: '', urlOgZh: '', thumbhash: p.thumbhash, dominant: p.dominant,
    bytes: p.master.byteLength, letterboxed: p.letterboxed, sourceUrl: clean, sourcePageUrl: clean,
  }, false);
}

/** Manual pick: a photo uploaded straight to Blob by the client; processed, then the original is removed. */
export async function coverFromUpload(eventId: string, blobUrl: string, deps: ChainDeps = {}) {
  if (!isBlobUrl(blobUrl)) throw new Error('not a Blob upload');
  const store = deps.store === undefined ? (blobConfigured() ? blobStore : null) : deps.store;
  if (!store) throw new Error('Blob storage is not configured');
  const db = deps.db ?? defaultDb;
  const p = await processCover(await (deps.fetchBytes ?? fetchDefault)(blobUrl, 15_000_000));
  const urls = await upload(store, eventId, p);
  const id = await attachCover(db, store, eventId, {
    kind: 'upload', ...urls, urlOgEn: '', urlOgZh: '', thumbhash: p.thumbhash, dominant: p.dominant,
    bytes: p.master.byteLength, letterboxed: p.letterboxed,
  }, false);
  await store.del([blobUrl]).catch(() => undefined);
  return id;
}

/** Manual pick: back to the template (e.g. "建议换模板" on a letterboxed cover). */
export async function coverToTemplate(eventId: string, deps: ChainDeps = {}) {
  const db = deps.db ?? defaultDb;
  const [ev] = await db.select({ category: events.category, hostName: events.hostName }).from(events).where(eq(events.id, eventId));
  if (!ev?.category) throw new Error('event needs a category first');
  const store = deps.store === undefined ? (blobConfigured() ? blobStore : null) : deps.store;
  return attachCover(db, store, eventId, templateCoverRow(ev.category, ev.hostName), false);
}
