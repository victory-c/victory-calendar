import sharp, { type Metadata } from 'sharp';
import { rgbaToThumbHash } from 'thumbhash';

// guide「存储与尺寸」: sniff → refuse SVG, first frame only → strip metadata, auto-orient →
// ratio 0.8–1.25 centre-cropped to 1:1, anything wider/taller letterboxed on its dominant colour →
// 1600² WebP q80 + 800² + 400² → dominant colour → ~25-byte thumbhash.

export class CoverError extends Error {
  constructor(public code: 'unsupported' | 'too_small' | 'decode', message: string) {
    super(message);
    this.name = 'CoverError';
  }
}

export type ProcessedCover = {
  master: Buffer;
  mid: Buffer;
  small: Buffer;
  thumbhash: string;
  dominant: string;
  letterboxed: boolean;
  width: number;
  height: number;
};

const RASTER = new Set(['jpeg', 'png', 'webp', 'gif', 'avif', 'heif', 'tiff']);
const MIN_EDGE = 200;

export async function processCover(bytes: Buffer): Promise<ProcessedCover> {
  let meta: Metadata;
  try {
    meta = await sharp(bytes, { animated: false }).metadata();
  } catch {
    throw new CoverError('decode', 'not an image');
  }
  if (!meta.format || !RASTER.has(meta.format)) throw new CoverError('unsupported', `format ${meta.format ?? 'unknown'}`);
  // EXIF orientations 5–8 are rotated 90°, so the displayed edges are swapped.
  const turned = (meta.orientation ?? 1) >= 5;
  const width = turned ? meta.height : meta.width;
  const height = turned ? meta.width : meta.height;
  if (!width || !height) throw new CoverError('decode', 'no dimensions');
  if (Math.min(width, height) < MIN_EDGE) throw new CoverError('too_small', `${width}×${height}`);

  const ratio = width / height;
  const letterboxed = ratio > 1.25 || ratio < 0.8;
  const base = sharp(bytes, { animated: false }).autoOrient(); // output carries no EXIF/ICC metadata by default
  const { dominant } = await base.clone().stats();
  const bg = { r: dominant.r, g: dominant.g, b: dominant.b, alpha: 1 };
  const square = (px: number, q: number) =>
    base
      .clone()
      .resize(px, px, letterboxed ? { fit: 'contain', background: bg } : { fit: 'cover', position: 'centre' })
      .flatten({ background: bg })
      .webp({ quality: q })
      .toBuffer();
  const [master, mid, small] = await Promise.all([square(1600, 80), square(800, 80), square(400, 78)]);
  const tiny = await sharp(master).resize(100, 100, { fit: 'inside' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const thumbhash = Buffer.from(rgbaToThumbHash(tiny.info.width, tiny.info.height, tiny.data)).toString('base64');
  return {
    master, mid, small, thumbhash, letterboxed, width, height,
    dominant: `rgb(${dominant.r} ${dominant.g} ${dominant.b})`,
  };
}
