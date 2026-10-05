import { fmtRange, isoWithOffset } from '@/lib/format/date';
import type { Locale } from '@/lib/taxonomy';

/** Event time line, always on the Pacific clock (no tz prop: see lib/format/date.ts). */
export function DateTime({ start, end, locale, className }: { start: Date; end: Date | null; locale: Locale; className?: string }) {
  return (
    <time dateTime={isoWithOffset(start)} className={className}>
      {fmtRange(start, end, locale)}
    </time>
  );
}
