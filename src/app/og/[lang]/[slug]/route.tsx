import { ImageResponse } from 'next/og';
import { shareCardCover } from '@/lib/covers/share-card';
import { titles } from '@/lib/events/display';
import { getEventBySlug } from '@/lib/events/queries';
import { fmtWhen } from '@/lib/format/date';
import { OgCard } from '@/lib/og/cards';
import { ogFonts } from '@/lib/og/fonts';
import { CATEGORIES } from '@/lib/taxonomy';

// 1200×630 share card per language, rendered on demand and cached at the edge. The page links
// it with ?v=<fingerprint>, so an edit to the title, time or cover gets a fresh URL. The cover goes
// to Satori as a JPEG data URL (it can't read the stored WebP); Brave finds and non-CC0 Openverse
// covers, whose credit can't be shown here, use the template (covers/share-card.ts). A cover that
// failed to load also gives the template, but only for a minute: the ?v= stays the same, so a
// day-long cache would keep the template card after the blip has passed.
const CACHE = 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800';
const CACHE_DEGRADED = 'public, max-age=60, s-maxage=60';

export async function GET(_req: Request, { params }: { params: Promise<{ lang: string; slug: string }> }) {
  const { lang, slug } = await params;
  if (lang !== 'en' && lang !== 'zh') return new Response('not found', { status: 404 });
  const { event } = await getEventBySlug(slug);
  if (!event) return new Response('not found', { status: 404 });
  const { primary } = titles(event, lang);
  const dateLine = fmtWhen(event, lang);
  const [cover, fonts] = await Promise.all([
    shareCardCover(event.cover),
    ogFonts({
      display: `${primary}Victor 精选's PicksAI`,
      mono: `${dateLine}${event.hostName ?? ''}${CATEGORIES[event.category][lang]}${CATEGORIES[event.category][lang].toUpperCase()}已取消CANCELLEDV`,
    }),
  ]);
  return new ImageResponse(
    <OgCard
      locale={lang}
      title={primary}
      dateLine={dateLine}
      category={event.category}
      hostName={event.hostName}
      coverSrc={cover.src}
      cancelled={event.status === 'cancelled'}
    />,
    {
      width: 1200,
      height: 630,
      fonts,
      headers: { 'cache-control': cover.degraded ? CACHE_DEGRADED : CACHE },
    },
  );
}
