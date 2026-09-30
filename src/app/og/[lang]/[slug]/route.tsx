import { ImageResponse } from 'next/og';
import { titles } from '@/lib/events/display';
import { getEventBySlug } from '@/lib/events/queries';
import { fmtRange } from '@/lib/format/date';
import { OgCard } from '@/lib/og/cards';
import { ogFonts } from '@/lib/og/fonts';
import { CATEGORIES } from '@/lib/taxonomy';

// 1200×630 share card per language, rendered on demand and cached at the edge. The page links
// it with ?v=<fingerprint>, so an edit to the title, time or cover gets a fresh URL.
export async function GET(_req: Request, { params }: { params: Promise<{ lang: string; slug: string }> }) {
  const { lang, slug } = await params;
  if (lang !== 'en' && lang !== 'zh') return new Response('not found', { status: 404 });
  const { event } = await getEventBySlug(slug);
  if (!event) return new Response('not found', { status: 404 });
  const { primary } = titles(event, lang);
  const dateLine = fmtRange(event.startAt, event.endAt, lang);
  const cover = event.cover && event.cover.kind !== 'template' ? event.cover.url800 : null;
  return new ImageResponse(
    <OgCard
      locale={lang}
      title={primary}
      dateLine={dateLine}
      category={event.category}
      hostName={event.hostName}
      coverSrc={cover}
      cancelled={event.status === 'cancelled'}
    />,
    {
      width: 1200,
      height: 630,
      fonts: await ogFonts({
        display: `${primary}Victor 精选's PicksAI`,
        mono: `${dateLine}${event.hostName ?? ''}${CATEGORIES[event.category][lang]}${CATEGORIES[event.category][lang].toUpperCase()}已取消CANCELLEDV`,
      }),
      headers: { 'cache-control': 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800' },
    },
  );
}
