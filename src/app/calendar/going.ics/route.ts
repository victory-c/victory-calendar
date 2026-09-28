import { publicGoing } from '@/lib/events/going';
import { getWindow } from '@/lib/events/queries';
import { buildIcs, calendarName, ICS_HEADERS } from '@/lib/ics';

// going / hosting / speaking that pass the public rules; after_event rows join once ended.
// Master switch off → an empty (but valid) calendar.
export async function GET(req: Request) {
  const locale = new URL(req.url).searchParams.get('lang') === 'zh' ? 'zh' : 'en';
  const { events, now, showAttendance } = await getWindow(-30, 90);
  const at = new Date(now);
  const list = events.filter((e) => publicGoing(e, at, showAttendance).kind === 'seal');
  const body = buildIcs({ events: list, locale, name: calendarName(locale, [], true), now: at, showAttendance });
  return new Response(body, { headers: ICS_HEADERS });
}
