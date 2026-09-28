import { getEventBySlug } from '@/lib/events/queries';
import { buildIcs, ICS_HEADERS } from '@/lib/ics';

// Reached via the /events/:slug.ics rewrite in next.config.ts.
export async function GET(req: Request, ctx: RouteContext<'/ics/[slug]'>) {
  const { slug } = await ctx.params;
  const locale = new URL(req.url).searchParams.get('lang') === 'zh' ? 'zh' : 'en';
  const { event, now, showAttendance } = await getEventBySlug(slug);
  if (!event) return new Response('Not found', { status: 404 });
  const body = buildIcs({ events: [event], locale, name: event.titleEn, now: new Date(now), showAttendance, single: true });
  return new Response(body, {
    headers: { ...ICS_HEADERS, 'Content-Disposition': `attachment; filename="${slug}.ics"` },
  });
}
