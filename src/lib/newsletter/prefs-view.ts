import { PT } from '../format/date';
import type { SubscriberView } from '../subscribers/service';
import type { Category, Locale } from '../taxonomy';

// What the token pages (/prefs/[token], /unsubscribe) derive from a subscriber before rendering.
// Pure, so it is tested without a request, a database or translations (tests/newsletter-pages).

type Status = SubscriberView['status'];

/**
 * The status the preference center shows. An expired pause (or one without an end date) already
 * counts as active for the digest (week 14), so it is shown as active. `pausedUntil` is the pause
 * end as a Date, whatever the status.
 */
export function effectiveStatus(
  view: Pick<SubscriberView, 'status' | 'pausedUntil'>,
  now = new Date(),
): { status: Status; pausedUntil: Date | null } {
  const pausedUntil = view.pausedUntil ? new Date(view.pausedUntil) : null;
  const status = view.status === 'paused' && (!pausedUntil || pausedUntil <= now) ? 'active' : view.status;
  return { status, pausedUntil };
}

/**
 * The banner for the confirm route's `?welcome=1` / `?welcome=already`, as a `Newsletter.*` key.
 * Only while it is still true of the row: a later visit to the same URL after a pause or an
 * unsubscribe shows no stale "You're in".
 */
export function welcomeBanner(welcome: string | string[] | undefined, status: Status): 'prefs.welcome' | 'prefs.already' | null {
  if (welcome === '1' && status === 'active') return 'prefs.welcome';
  if (welcome === 'already' && (status === 'active' || status === 'paused')) return 'prefs.already';
  return null;
}

/** `/unsubscribe?list=going`: opened from a going alert (its footer link or one-click header). */
export function isGoingList(list: string | string[] | undefined): boolean {
  return list === 'going';
}

/**
 * The categories /unsubscribe offers a "Stop …" button for. None once the row is unsubscribed or
 * suppressed, and none with a single category: "Stop X" and "everything" are then the same press.
 * None either when the page came from a going alert (`going`): the choice there is alerts or
 * everything; the categories are one link away on the preference center.
 */
export function unsubscribeChoices(view: Pick<SubscriberView, 'status' | 'categories'>, going = false): Category[] {
  if (going || view.status === 'unsubscribed' || view.status === 'suppressed') return [];
  return view.categories.length > 1 ? [...view.categories] : [];
}

/**
 * F20, /unsubscribe?list=going: 'offer' the "Turn off going alerts" button while they are on, or
 * say they are already 'off'. Null when the page wasn't opened from an alert, or the row gets no
 * email at all (unsubscribed, suppressed), where the page's own status says enough. Shown whatever
 * the deployment's alert mode: turning something off always works.
 */
export function goingChoice(view: Pick<SubscriberView, 'status' | 'goingAlerts'>, going: boolean): 'offer' | 'off' | null {
  if (!going || view.status === 'unsubscribed' || view.status === 'suppressed') return null;
  return view.goingAlerts ? 'offer' : 'off';
}

/** October 31, 2026 / 2026年10月31日, in Pacific time like every other date on the site. */
export function longDate(d: Date, locale: Locale) {
  return new Intl.DateTimeFormat(locale === 'zh' ? 'zh-CN' : 'en-US', { dateStyle: 'long', timeZone: PT }).format(d);
}
