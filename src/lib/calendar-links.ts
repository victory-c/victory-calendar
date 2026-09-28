// Add-to-calendar URL formats. None of these are officially documented, so every format is
// pinned by snapshot tests (tests/calendar-links.test.ts).
import type { Locale } from './taxonomy';

const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

export type CalendarTarget = 'apple' | 'google' | 'outlook' | 'ics';

/** zh puts Google last: Google Calendar is unreachable from mainland China. */
export function targetOrder(locale: Locale): CalendarTarget[] {
  return locale === 'zh' ? ['apple', 'outlook', 'ics', 'google'] : ['apple', 'google', 'outlook', 'ics'];
}

/** webcal:// subscribe link for any https feed URL. */
export function webcal(httpsUrl: string) {
  return httpsUrl.replace(/^https?:\/\//, 'webcal://');
}

export function googleSubscribe(httpsUrl: string) {
  return `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcal(httpsUrl))}`;
}

type Single = { title: string; start: Date; end: Date; details: string; location: string; tz: string };

export function googleEvent(e: Single) {
  const q = new URLSearchParams({
    action: 'TEMPLATE',
    text: e.title,
    dates: `${stamp(e.start)}/${stamp(e.end)}`,
    ctz: e.tz,
    details: e.details,
    location: e.location,
  });
  return `https://calendar.google.com/calendar/render?${q}`;
}

export function outlookEvent(e: Single) {
  const q = new URLSearchParams({
    path: '/calendar/action/compose',
    rru: 'addevent',
    startdt: e.start.toISOString(),
    enddt: e.end.toISOString(),
    subject: e.title,
    location: e.location,
    body: e.details,
  });
  return `https://outlook.live.com/calendar/deeplink/compose?${q}`;
}
