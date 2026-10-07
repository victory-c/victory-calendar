import { dayKey, fmtWhen, isoWithOffset } from '@/lib/format/date';
import type { Locale } from '@/lib/taxonomy';

/**
 * Event time line, always on the Pacific clock (no tz prop: see lib/format/date.ts). All-day events
 * show their day(s), with a date-only datetime. allDay is required so no caller can forget it.
 */
export function DateTime({ start, end, allDay, locale, className }: { start: Date; end: Date | null; allDay: boolean; locale: Locale; className?: string }) {
  return (
    <time dateTime={allDay ? dayKey(start) : isoWithOffset(start)} className={className}>
      {fmtWhen({ startAt: start, endAt: end, allDay }, locale)}
    </time>
  );
}
