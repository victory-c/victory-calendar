import 'server-only';
import { inArray } from 'drizzle-orm';
import sharp from 'sharp';
import { isBlobUrl } from '../covers/blob';
import { db as defaultDb, type DB, hasDatabase } from '../db';
import { covers } from '../db/schema';
import { safeFetchBytes } from '../ingest/safe-fetch';
import { describeError } from '../log-safe';
import { light, toHex } from '../tokens';

// Cover pictures for the WeChat long image and the Xiaohongshu pages (F17, decision L3), as JPEG
// data URLs Satori can draw. Satori can't decode the WebP files in Blob, and its own image fetch
// has no timeout or status check, so we fetch (safe-fetch, our Blob files only, at most 2 MB) and
// convert with sharp here. Rules:
// - Xiaohongshu: always the template tile. Official posters can carry QR codes and URLs, and
//   republishing there is the riskiest place for Luma's terms.
// - WeChat: whatever the email shows (the snapshot's cover choice: template unless a real cover
//   the email may use), except that official covers follow official_covers_to_template now, even
//   for an issue frozen before the switch was turned on.
// - Any failure (no row, not ours, fetch or decode error, the overall time budget) gives the
//   template tile; failures (not policy) mark the result `degraded`, so it is never cached long.

export const COVER_SOURCE_MAX = 2_000_000;
export const COVER_BUDGET_MS = 4000;
const EDGE = 400;
const OFFICIAL = new Set(['official', 'host_composite']);

export type CoverImages = {
  /** eventId → JPEG data URL, or null for the template tile. */
  images: Map<string, string | null>;
  /** Some real cover could not be fetched or converted in time (it shows the template instead). */
  degraded: boolean;
};

async function toDataUrl(url: string): Promise<string> {
  const source = await safeFetchBytes(url, { maxBytes: COVER_SOURCE_MAX });
  const jpeg = await sharp(source, { animated: false })
    .autoOrient()
    .resize(EDGE, EDGE, { fit: 'cover', position: 'centre' })
    .flatten({ background: toHex(light.paper) })
    .jpeg({ quality: 85, mozjpeg: true })
    .toBuffer();
  return `data:image/jpeg;base64,${jpeg.toString('base64')}`;
}

export async function coverImages(
  items: readonly { eventId: string; coverId: string | null }[],
  o: { kind: 'wechat' | 'xhs'; allToTemplate: boolean; db?: DB; budgetMs?: number },
): Promise<CoverImages> {
  const images = new Map<string, string | null>(items.map((it) => [it.eventId, null]));
  const ids = [...new Set(items.map((it) => it.coverId).filter((id): id is string => Boolean(id)))];
  if (o.kind === 'xhs' || ids.length === 0 || (!o.db && !hasDatabase())) return { images, degraded: false };

  const db = o.db ?? defaultDb;
  const rows = await db.select({ id: covers.id, kind: covers.kind, url400: covers.url400 }).from(covers).where(inArray(covers.id, ids));
  const usable = new Map(
    rows.filter((r) => r.kind !== 'template' && !(o.allToTemplate && OFFICIAL.has(r.kind)) && isBlobUrl(r.url400)).map((r) => [r.id, r.url400]),
  );

  let degraded = false;
  const done = new Map<string, string>();
  const tasks = [...usable].map(async ([id, url]) => {
    try {
      done.set(id, await toDataUrl(url));
    } catch (err) {
      degraded = true;
      console.warn('[digest/social] cover fell back to the template', id, describeError(err));
    }
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = await Promise.race([
    Promise.all(tasks).then(() => false),
    new Promise<boolean>((resolve) => {
      timer = setTimeout(() => resolve(true), o.budgetMs ?? COVER_BUDGET_MS);
    }),
  ]);
  clearTimeout(timer);
  if (timedOut) {
    degraded = true;
    console.warn(`[digest/social] cover budget spent: ${usable.size - done.size} of ${usable.size} covers fell back to the template`);
  }
  // Read what finished in time; anything still running later is ignored.
  const ready = new Map(done);
  for (const it of items) if (it.coverId && ready.has(it.coverId)) images.set(it.eventId, ready.get(it.coverId)!);
  return { images, degraded };
}
