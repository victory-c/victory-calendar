import { eq } from 'drizzle-orm';
import sharp from 'sharp';
import { isBlobUrl } from '@/lib/covers/blob';
import { db, hasDatabase } from '@/lib/db';
import { covers } from '@/lib/db/schema';
import { safeFetchBytes } from '@/lib/ingest/safe-fetch';
import { describeError } from '@/lib/log-safe';
import { light, toHex } from '@/lib/tokens';

// A stored cover as a 192×192 JPEG for the weekly digest (shown at 96 px): /og/email-cover/cov_….
// Blob covers are WebP only, which classic Outlook for Windows can't show. Cover ids change on
// every replacement (covers/chain.ts attachCover), so the URL is content-addressed and the JPEG is
// cached for a year. Only our own Blob files are fetched (through safe-fetch, like every outbound
// request); template covers have no stored image and are served by /og/template instead.

const ID = /^cov_[0-9a-z]{16}$/;
const EDGE = 192;
const MAX_SOURCE_BYTES = 5_000_000; // the 400² WebP is ~30 KB; anything near this is not ours

const notFound = () => new Response('not found', { status: 404, headers: { 'cache-control': 'public, max-age=300' } });

export async function GET(_req: Request, { params }: { params: Promise<{ coverId: string }> }) {
  const { coverId } = await params;
  if (!ID.test(coverId) || !hasDatabase()) return notFound();
  const [row] = await db.select({ kind: covers.kind, url400: covers.url400 }).from(covers).where(eq(covers.id, coverId));
  if (!row || row.kind === 'template' || !isBlobUrl(row.url400)) return notFound();
  try {
    const source = await safeFetchBytes(row.url400, { maxBytes: MAX_SOURCE_BYTES });
    const jpeg = await sharp(source, { animated: false })
      .autoOrient()
      .resize(EDGE, EDGE, { fit: 'cover', position: 'centre' })
      .flatten({ background: toHex(light.paper) })
      .jpeg({ quality: 80, mozjpeg: true })
      .toBuffer();
    return new Response(new Uint8Array(jpeg), {
      headers: {
        'content-type': 'image/jpeg',
        'content-length': String(jpeg.byteLength),
        'cache-control': 'public, max-age=31536000, immutable',
      },
    });
  } catch (err) {
    console.warn('[og/email-cover] could not build the email cover', coverId, describeError(err));
    return new Response('unavailable', { status: 502, headers: { 'cache-control': 'no-store' } });
  }
}
