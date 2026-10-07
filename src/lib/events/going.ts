// "Victor 会去" public display rules (PRD §7, guide「Going 状态安全规则」). Pure and tested:
// every public surface (cards, /going, going.ics, digest) must go through publicGoing().
import { allDayEndsAt } from '../format/calendar';
import type { PublicEvent } from './types';

export type SealKind = 'going' | 'hosting' | 'speaking' | 'went';
export type GoingDisplay =
  | { kind: 'seal'; seal: SealKind }
  | { kind: 'interested' } // grey text in the meta line, never a seal
  | { kind: 'none' };

const LISTED_PLATFORMS = [/(^|\.)luma\.com$/, /(^|\.)lu\.ma$/, /(^|\.)partiful\.com$/, /(^|\.)eventbrite\.[a-z.]+$/, /(^|\.)meetup\.com$/];

export function isListedPlatform(url: string) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return LISTED_PLATFORMS.some((re) => re.test(host));
  } catch {
    return false;
  }
}

type GoingInput = Pick<
  PublicEvent,
  'going' | 'goingVisibility' | 'category' | 'format' | 'privateVenue' | 'sourceUrl' | 'startAt' | 'endAt' | 'allDay' | 'status'
> & { recurring?: boolean };

/**
 * Why a `going` can't be shown before the event (null = it can). The admin editor shows the
 * reason when it auto-downgrades to after_event.
 */
export function goingDowngradeReason(e: GoingInput): string | null {
  if (e.category === 'cycling') return 'cycling';
  if (!isListedPlatform(e.sourceUrl)) return 'not_on_listed_platform';
  if (e.format !== 'online' && e.privateVenue) return 'private_venue';
  if (e.recurring) return 'recurring';
  return null;
}

/** All-day events run to the midnight after their last day; others to their end, or 3 h without one. */
export function hasEnded(e: Pick<PublicEvent, 'startAt' | 'endAt' | 'allDay'>, now: Date) {
  const end = e.allDay ? allDayEndsAt(e.startAt, e.endAt) : (e.endAt ?? new Date(e.startAt.getTime() + 3 * 3600_000));
  return end.getTime() <= now.getTime();
}

export function publicGoing(e: GoingInput, now: Date, showAttendance: boolean): GoingDisplay {
  if (!showAttendance) return { kind: 'none' };
  if (e.category === 'cycling') return { kind: 'none' }; // attendance never shown for cycling
  if (e.goingVisibility === 'hidden' || e.going === 'none') return { kind: 'none' };
  if (e.going === 'interested') return { kind: 'interested' };

  const ended = hasEnded(e, now);
  if (ended) {
    // Went: derived; cancelled events were never attended.
    return e.status === 'cancelled' ? { kind: 'none' } : { kind: 'seal', seal: 'went' };
  }
  if (e.goingVisibility === 'after_event') return { kind: 'none' };
  if (e.going === 'going' && goingDowngradeReason(e)) return { kind: 'none' }; // auto after_event
  return { kind: 'seal', seal: e.going };
}
