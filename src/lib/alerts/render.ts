import 'server-only';
import { createElement } from 'react';
import { ALERT_COPY } from '@/emails/copy';
import { type AlertLinks, GoingAlertEmail } from '@/emails/going-alert';
import { ALT_TITLE_MAX, clip, dayLabel, where } from '../digest/fields';
import { finishEmail, TOKEN } from '../digest/render';
import { isDigestSeal } from '../digest/select';
import type { DigestEvent, RenderedEmail } from '../digest/types';
import { titles } from '../events/display';
import { linksFor } from '../subscribers/links';
import type { Locale } from '../taxonomy';

// F20 going alert: events → the email, rendered once per variant (locale + sorted event ids) with
// the digest's placeholder token in the per-reader links, then personalised per recipient with
// personalize(email, token, ALERT_LINKS). Pure in its inputs: the same events (in any order) give
// byte-identical output, so a retried batch sends the same payload under the same idempotency key.

/** Per-reader links in each part: turn off going alerts, preferences, unsubscribe from everything. */
export const ALERT_LINKS = 3;
/** alert_sends.event_ids holds 1–20 ids (its check constraint). */
export const MAX_ALERT_EVENTS = 20;

/**
 * The alert's links for one token. `oneClick` is the RFC 8058 List-Unsubscribe target (going
 * alerts only); it goes in a header, never in the body, so it isn't one of the ALERT_LINKS.
 */
export function alertLinks(locale: Locale, token: string, origin: string): AlertLinks & { oneClick: string } {
  const own = linksFor(locale, token, origin);
  return {
    offAlerts: `${own.unsubscribe}&list=going`,
    prefs: own.prefs,
    unsubscribe: own.unsubscribe,
    privacy: `${origin}${locale === 'zh' ? '/zh' : ''}/privacy`,
    oneClick: `${own.oneClick}&list=going`,
  };
}

/** By start, then id; one row per event. */
function ordered(events: readonly DigestEvent[]): DigestEvent[] {
  const byId = new Map(events.map((e) => [e.id, e]));
  return [...byId.values()].sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

export function alertSubject(events: readonly DigestEvent[], locale: Locale): string {
  const c = ALERT_COPY[locale];
  if (events.length !== 1) return c.subjectMany(events.length);
  const t = titles(events[0], locale);
  return c.subjectOne(clip(t.primary, ALT_TITLE_MAX[t.primaryLang]));
}

/**
 * The alert for one variant. Throws (fail closed) on no events, more than MAX_ALERT_EVENTS, an event
 * without a public seal (going / hosting / speaking: the claim and the pool already require one),
 * or the link placeholder anywhere in the input (it would hand each reader's token to whatever URL
 * carried it); DigestTooLargeError when over MAX_HTML_BYTES.
 */
export async function renderAlert(events: DigestEvent[], locale: Locale, origin: string): Promise<RenderedEmail> {
  const list = ordered(events);
  if (list.length === 0) throw new Error('alert: no events');
  if (list.length > MAX_ALERT_EVENTS) throw new Error(`alert: ${list.length} events (limit ${MAX_ALERT_EVENTS})`);
  const bare = list.find((e) => !isDigestSeal(e.seal));
  if (bare) throw new Error(`alert: ${bare.id} has no public seal`);
  if (JSON.stringify({ origin, list }).includes(TOKEN)) throw new Error('alert events contain the link placeholder');
  const subject = alertSubject(list, locale);
  // One event: its day and place (the subject has the title); several: their titles.
  const preheader =
    list.length === 1
      ? [dayLabel(new Date(list[0].startAt), locale), ...where(list[0], locale)].join(' · ')
      : list.map((e) => titles(e, locale).primary).join(' · ');
  const element = createElement(GoingAlertEmail, { locale, origin, subject, preheader, events: list, links: alertLinks(locale, TOKEN, origin) });
  // picks 0: an alert has no digest picks, so a personalize() call that forgets ALERT_LINKS fails
  // closed (it would expect the empty notice's four links) instead of passing by coincidence.
  return finishEmail(element, { subject, preheader, picks: 0, going: list.length }, ALERT_LINKS, 'alert');
}
