import { addDaysKey, isoWeekBounds, isoWeekOf, keyToParts, startOfKey, todayKeyPT, weekdayOf, zonedInstant } from '../format/calendar';
import { PT } from '../format/date';

// Which week an issue covers and when it goes out. An issue covers one ISO week, Monday 00:00 to
// the next Monday 00:00 Pacific time, and is sent the Sunday evening before it (17:00 PT, guide
// 「digest 组装」); digest_issues.iso_week is the covered week. Pure, Intl-based (no TZDate:
// PROGRESS 文档冲突 12), and DST-safe: a week can be 167 or 169 hours long, so never add 7 × 24 h.

export function sendAfterFor(isoWeek: string): Date {
  const b = isoWeekBounds(isoWeek);
  if (!b) throw new Error(`bad iso week: ${isoWeek}`);
  const { y, m, d } = keyToParts(addDaysKey(b.from, -1)); // the Sunday before the covered Monday
  return zonedInstant(y, m, d, 17, 0, PT);
}

/** [from, to) of the covered week, and the following week for the featured preview. */
export function coverage(isoWeek: string) {
  const b = isoWeekBounds(isoWeek);
  if (!b) throw new Error(`bad iso week: ${isoWeek}`);
  return {
    from: startOfKey(b.from),
    to: startOfKey(b.to),
    previewTo: startOfKey(b.to, 7),
    previewWeek: isoWeekOf(b.to),
  };
}

/** The next issue as of `now`: Monday–Saturday → the coming Monday's week; Sunday → tomorrow's. */
export function upcomingIssueWeek(now: Date): string {
  const t = todayKeyPT(now);
  return isoWeekOf(addDaysKey(t, (8 - weekdayOf(t)) % 7 || 7));
}

/** First instant of the Pacific calendar month containing `at` (the empty notice's "once a month"). */
export function monthStartPT(at: Date): Date {
  const { y, m } = keyToParts(todayKeyPT(at));
  return zonedInstant(y, m, 1, 0, 0, PT);
}

/**
 * How late a scheduled issue may still start: Monday evening PT runs (01:00/02:00 UTC Tuesday)
 * still send; after that the week has begun and the issue is skipped rather than mailed late.
 */
export const LATE_LIMIT_MS = 27 * 3600_000;
