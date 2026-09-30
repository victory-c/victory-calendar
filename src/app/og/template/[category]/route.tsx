import { ImageResponse } from 'next/og';
import { TemplateCard } from '@/lib/og/cards';
import { ogFonts } from '@/lib/og/fonts';
import { isCategory } from '@/lib/taxonomy';

// Cover chain step 3 as an image: /og/template/ai?h=Host&s=1200. Deterministic from its URL,
// so it is cached for a year; the public site never requests it (it draws the same tile in CSS).
// Used by OG cards, email thumbnails and anything else that needs a real file.
const SIZES = new Set([400, 800, 1200, 1600]);

export async function GET(req: Request, { params }: { params: Promise<{ category: string }> }) {
  const { category } = await params;
  if (!isCategory(category)) return new Response('not found', { status: 404 });
  const q = new URL(req.url).searchParams;
  const size = SIZES.has(Number(q.get('s'))) ? Number(q.get('s')) : 1200;
  const host = q.get('h')?.slice(0, 80) || null;
  return new ImageResponse(<TemplateCard category={category} hostName={host} size={size} />, {
    width: size,
    height: size,
    fonts: await ogFonts({ display: 'AI', mono: host ?? '' }),
    headers: { 'cache-control': 'public, max-age=31536000, immutable' },
  });
}
