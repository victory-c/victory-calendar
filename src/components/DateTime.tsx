import { fmtRange, isoWithOffset } from '@/lib/format/date';
import type { Locale } from '@/lib/taxonomy';

export function DateTime({ start, end, locale, tz, className }: { start: Date; end: Date | null; locale: Locale; tz: string; className?: string }) {
  return (
    <time dateTime={isoWithOffset(start, tz)} className={className}>
      {fmtRange(start, end, locale, tz)}
    </time>
  );
}
