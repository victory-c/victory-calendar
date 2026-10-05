import { fmtDayHeader, isoWithOffset } from '@/lib/format/date';
import type { Locale } from '@/lib/taxonomy';

type Props = {
  date: Date;
  locale: Locale;
  relative?: string | null;
  id: string;
  /** Heading level: h2 on day lists; h3 where the day sits under a category heading (/weekly/[week]). */
  as?: 'h2' | 'h3';
};

export function DayHeader({ date, locale, relative, id, as: Tag = 'h2' }: Props) {
  const { date: d, weekday } = fmtDayHeader(date, locale);
  return (
    <Tag id={id} className="day-header sticky top-0 z-10 -mx-4 flex items-baseline gap-2 border-b border-rule bg-paper/95 px-4 py-2.5 font-sans backdrop-blur-sm md:mx-0 md:px-0">
      <time dateTime={isoWithOffset(date).slice(0, 10)} className="tnum font-mono text-sm tracking-tight">
        {d}
      </time>
      <span className="text-sm">{weekday}</span>
      {relative && <span className="text-sm text-muted">· {relative}</span>}
    </Tag>
  );
}
