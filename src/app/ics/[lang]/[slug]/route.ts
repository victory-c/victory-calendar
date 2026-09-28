import { getEventBySlug } from '@/lib/events/queries';
import { buildIcs, ICS_HEADERS } from '@/lib/ics';

// Served as /events/:slug.ics and /zh/events/:slug.ics via rewrites in next.config.ts.
export async function GET(_req: Request, ctx: RouteContext<'/ics/[lang]/[slug]'>) {
  const { lang, slug } = await ctx.params;
  const locale = lang === 'zh' ? 'zh' : 'en';
  const { event, now, showAttendance } = await getEventBySlug(slug);
  if (!event) return new Response('Not found', { status: 404 });
  const name = locale === 'zh' ? event.titleZh : event.titleEn;
  const body = buildIcs({ events: [event], locale, name, now: new Date(now), showAttendance, single: true });
  return new Response(body, {
    headers: { ...ICS_HEADERS, 'Content-Disposition': `attachment; filename="${slug}.ics"` },
  });
}
