import { getWindow } from '@/lib/events/queries';
import { publicOrigin } from '@/lib/host';
import { buildRss } from '@/lib/rss';

// Served as /feed.xml and /zh/feed.xml via rewrites in next.config.ts.
export async function GET(_req: Request, ctx: RouteContext<'/rss/[lang]'>) {
  const { lang } = await ctx.params;
  const locale = lang === 'zh' ? 'zh' : 'en';
  const { events, now } = await getWindow(-1, 30);
  const body = buildRss({ events, locale, origin: publicOrigin(), now: new Date(now) });
  return new Response(body, {
    headers: { 'Content-Type': 'application/rss+xml; charset=utf-8', 'Cache-Control': 'public, s-maxage=900, stale-while-revalidate=300' },
  });
}
