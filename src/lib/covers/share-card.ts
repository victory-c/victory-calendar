import 'server-only';
import sharp from 'sharp';
import type { PublicCover } from '../events/types';
import { safeFetchBytes } from '../ingest/safe-fetch';
import { light, toHex } from '../tokens';
import { isBlobUrl } from './blob';
import { shareCardAllowed } from './credit';

// The cover picture for a 1200×630 share card (/og/[lang]/[slug]). Satori can't decode WebP, and
// every stored cover is WebP, so the 800² file is fetched (our own Blob only, through safe-fetch)
// and handed over as a 630² JPEG data URL, like /og/email-cover does for email. Covers whose
// credit can't be shown on the card (shareCardAllowed) and any failure give no src: the template.
// A failure (timeout, network, a file that won't decode) is `degraded`, so the route caches that
// card briefly; the policy fallback is a settled answer and is cached like a real cover.

const EDGE = 630;
const MAX_SOURCE_BYTES = 5_000_000; // the 800² WebP is ~80 KB

export type ShareCardCover = { src: string | null; degraded: boolean };

export async function shareCardCover(
  cover: Pick<PublicCover, 'kind' | 'license' | 'url800'> | null,
  deps: { fetchBytes?: (url: string, maxBytes: number) => Promise<Buffer> } = {},
): Promise<ShareCardCover> {
  if (!cover || !shareCardAllowed(cover) || !isBlobUrl(cover.url800)) return { src: null, degraded: false };
  try {
    const source = await (deps.fetchBytes ?? ((u, maxBytes) => safeFetchBytes(u, { maxBytes })))(cover.url800, MAX_SOURCE_BYTES);
    const jpeg = await sharp(source, { animated: false })
      .autoOrient()
      .resize(EDGE, EDGE, { fit: 'cover', position: 'centre' })
      .flatten({ background: toHex(light.paper) })
      .jpeg({ quality: 85, mozjpeg: true })
      .toBuffer();
    return { src: `data:image/jpeg;base64,${jpeg.toString('base64')}`, degraded: false };
  } catch (err) {
    console.warn('[og] share card cover unavailable, using the template:', err instanceof Error ? err.name : 'error');
    return { src: null, degraded: true };
  }
}
