import { getWindow } from '@/lib/events/queries';
import { buildIcs, calendarName, ICS_HEADERS } from '@/lib/ics';
import { parseCategories } from '@/lib/taxonomy';

// /calendar.ics?c=ai,hackathon&lang=zh — any subset of the 7 slugs; unknown slugs ignored.
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const locale = q.get('lang') === 'zh' ? 'zh' : 'en';
  const cats = parseCategories(q.get('c'));
  const { events, now, showAttendance } = await getWindow(-1, 90);
  const list = cats.length ? events.filter((e) => cats.includes(e.category)) : events;
  const body = buildIcs({ events: list, locale, name: calendarName(locale, cats), now: new Date(now), showAttendance });
  return new Response(body, { headers: ICS_HEADERS });
}
