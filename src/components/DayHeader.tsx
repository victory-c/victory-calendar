import { fmtDayHeader, isoWithOffset } from '@/lib/format/date';
import type { Locale } from '@/lib/taxonomy';

export function DayHeader({ date, locale, relative, id }: { date: Date; locale: Locale; relative?: string | null; id: string }) {
  const { date: d, weekday } = fmtDayHeader(date, locale);
  return (
    <h2 id={id} className="day-header sticky top-0 z-10 -mx-4 flex items-baseline gap-2 border-b border-rule bg-paper/95 px-4 py-2.5 font-sans backdrop-blur-sm md:mx-0 md:px-0">
      <time dateTime={isoWithOffset(date).slice(0, 10)} className="tnum font-mono text-sm tracking-tight">
        {d}
      </time>
      <span className="text-sm">{weekday}</span>
      {relative && <span className="text-sm text-muted">· {relative}</span>}
    </h2>
  );
}
