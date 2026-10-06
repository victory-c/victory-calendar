import { facetsFromParams, matchesFacets } from '@/lib/events/facets';
import { getWindow } from '@/lib/events/queries';
import { buildIcs, calendarName, ICS_HEADERS } from '@/lib/ics';
import { parseCategories } from '@/lib/taxonomy';

// /calendar.ics?c=ai,hackathon&lang=zh&ev_lang=zh&online=1 — any subset of the 7 slugs, plus the
// F19 facets (event language: zh / en include bilingual events; online keeps online and hybrid).
// Unknown slugs and facet values are ignored. Filtering happens here, after the cached window, so
// the facets never split getWindow's 'use cache' entries.
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const locale = q.get('lang') === 'zh' ? 'zh' : 'en';
  const cats = parseCategories(q.get('c'));
  const facets = facetsFromParams(q);
  const { events, now, showAttendance } = await getWindow(-1, 90);
  const list = events.filter((e) => (!cats.length || cats.includes(e.category)) && matchesFacets(e, facets));
  const body = buildIcs({ events: list, locale, name: calendarName(locale, cats, false, facets), now: new Date(now), showAttendance });
  return new Response(body, { headers: ICS_HEADERS });
}
