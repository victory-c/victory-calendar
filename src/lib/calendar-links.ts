// Add-to-calendar URL formats. None of these are officially documented, so every format is
// pinned by snapshot tests (tests/calendar-links.test.ts).
import { type EvLang, facetParams } from './events/facets';
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

/** Outlook.com "subscribe from web" (undocumented deep link, pinned by tests). */
export function outlookSubscribe(httpsUrl: string, name: string) {
  const q = new URLSearchParams({ url: httpsUrl, name });
  return `https://outlook.live.com/calendar/0/addfromweb?${q}`;
}

/**
 * Feed URL for a selection: /calendar.ics?c=ai,hackathon&lang=zh&ev_lang=zh&online=1. Params in
 * a fixed order (c, lang, ev_lang, online), so one selection is one CDN cache entry. `lang` is the
 * language the feed is written in; `ev_lang` / `online` are the F19 facets. going.ics takes neither
 * categories nor facets.
 */
export function feedUrl(
  origin: string,
  opts: { cats?: readonly string[]; locale: Locale; going?: boolean; evLang?: EvLang | null; onlineOnly?: boolean },
) {
  const q = new URLSearchParams();
  if (!opts.going && opts.cats?.length) q.set('c', opts.cats.join(','));
  if (opts.locale === 'zh') q.set('lang', 'zh');
  if (!opts.going) for (const [k, v] of facetParams({ evLang: opts.evLang ?? null, onlineOnly: opts.onlineOnly === true })) q.set(k, v);
  const path = opts.going ? '/calendar/going.ics' : '/calendar.ics';
  const qs = q.toString().replace(/%2C/g, ',');
  return `${origin}${path}${qs ? `?${qs}` : ''}`;
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
