// iCalendar output shared by /calendar.ics, /calendar/going.ics and /ics/[slug]
// (guide「日历订阅」). VTIMEZONE blocks are vendored in ./vtimezones.ts (pnpm tz:vendor).
import { TZDate } from '@date-fns/tz';
import ical, { ICalCalendarMethod, ICalEventStatus } from 'ical-generator';
import { note, titles } from './events/display';
import { publicGoing } from './events/going';
import type { PublicEvent } from './events/types';
import { publicHost, publicOrigin } from './host';
import { CATEGORIES, type Category, type Locale } from './taxonomy';
import { vtimezone } from './vtimezones';

export const ICS_HEADERS = {
  'Content-Type': 'text/calendar; charset=utf-8',
  'Cache-Control': 'public, s-maxage=900, stale-while-revalidate=300',
} as const;

export function eventUrl(e: Pick<PublicEvent, 'slug'>, locale: Locale) {
  return `${publicOrigin()}${locale === 'zh' ? '/zh' : ''}/events/${e.slug}`;
}

export function calendarName(locale: Locale, cats: Category[], going = false) {
  const base = locale === 'zh' ? 'Victor 精选' : "Victor's Picks";
  if (going) return locale === 'zh' ? `${base} · Victor 会去` : `${base} · Victor is going`;
  if (!cats.length) return `${base} · ${locale === 'zh' ? '全部' : 'All'}`;
  return `${base} · ${cats.map((c) => CATEGORIES[c][locale]).join(locale === 'zh' ? '、' : ', ')}`;
}

type Options = {
  events: PublicEvent[];
  locale: Locale;
  name: string;
  now: Date;
  showAttendance: boolean;
  /** Single-event download: METHOD:PUBLISH, no refresh hints. */
  single?: boolean;
};

export function buildIcs({ events, locale, name, now, showAttendance, single }: Options) {
  const cal = ical({
    name,
    prodId: { company: 'victor-picks', product: 'picks', language: locale === 'zh' ? 'ZH' : 'EN' },
    timezone: { name: 'America/Los_Angeles', generator: vtimezone },
    ttl: single ? null : 3600, // REFRESH-INTERVAL and X-PUBLISHED-TTL: PT1H
  });
  cal.method(ICalCalendarMethod.PUBLISH);
  const host = publicHost();
  for (const e of events) {
    const { primary } = titles(e, locale);
    const g = publicGoing(e, now, showAttendance);
    const goingPublic = g.kind === 'seal' && g.seal !== 'went';
    const n = note(e, locale);
    const loc = [e.venueName, e.address, e.format === 'online' ? null : e.city].filter(Boolean).join(', ');
    // ical-generator formats plain Dates with the *server's* local clock when a TZID is set;
    // TZDate (withTimeZone) makes DTSTART/DTEND wall-clock correct on UTC servers.
    const end = e.endAt ?? new Date(e.startAt.getTime() + 2 * 3600_000);
    cal.createEvent({
      id: `${e.id}@${host}`,
      sequence: e.sequence,
      start: new TZDate(e.startAt.getTime(), e.tz),
      end: new TZDate(end.getTime(), e.tz),
      allDay: e.allDay,
      timezone: e.tz,
      stamp: now,
      summary: `${goingPublic ? 'V→ ' : ''}${primary}`,
      description: [n?.text, `RSVP: ${e.sourceUrl}`, eventUrl(e, locale)].filter(Boolean).join('\n\n'),
      location: loc || (e.format === 'online' ? (locale === 'zh' ? '线上' : 'Online') : undefined),
      url: eventUrl(e, locale),
      categories: [{ name: e.category }],
      status: e.status === 'cancelled' ? ICalEventStatus.CANCELLED : ICalEventStatus.CONFIRMED,
    });
  }
  return cal.toString();
}
