import type { PublicEvent } from '@/lib/events/types';
import { monthGrid, startOfKey, weekdayLabels } from '@/lib/format/calendar';
import { dayKey, fmtLongDate } from '@/lib/format/date';
import type { Category, Locale } from '@/lib/taxonomy';

/** Desktop month grid (≥1024 px); phones get the agenda list only. Cells link to day anchors. */
export function CalendarGrid({ ym, events, todayKey, locale }: { ym: string; events: PublicEvent[]; todayKey: string; locale: Locale }) {
  const weeks = monthGrid(ym, locale);
  const byDay = new Map<string, Category[]>();
  for (const e of events) {
    const k = dayKey(e.startAt, e.tz);
    const list = byDay.get(k) ?? [];
    if (!list.includes(e.category)) list.push(e.category);
    byDay.set(k, list);
  }
  const labels = weekdayLabels(locale);
  return (
    <table className="mt-6 hidden w-full table-fixed border-collapse lg:table">
      <thead>
        <tr>
          {labels.map((l) => (
            <th key={l} scope="col" className="pb-2 text-left text-xs font-normal text-muted">
              {l}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {weeks.map((w) => (
          <tr key={w[0]}>
            {w.map((k) => {
              const inMonth = k.startsWith(ym);
              const cats = byDay.get(k) ?? [];
              const today = k === todayKey;
              const past = k < todayKey;
              const day = (
                <>
                  <span className={`tnum font-mono text-sm ${today ? 'rounded-full bg-ink px-1.5 text-paper' : ''}`}>{Number(k.slice(8))}</span>
                  <span className="mt-auto flex gap-1" aria-hidden>
                    {cats.slice(0, 3).map((c) => (
                      <span key={c} className="size-2 rounded-full" style={{ background: `var(--color-cat-${c})` }} />
                    ))}
                  </span>
                </>
              );
              const cls = `flex h-20 flex-col items-start gap-1 border-t border-rule p-2 ${inMonth ? '' : 'opacity-35'} ${past && !today ? 'text-muted' : ''}`;
              return (
                <td key={k} className="p-0 align-top" aria-current={today ? 'date' : undefined}>
                  {cats.length && inMonth ? (
                    <a href={`#d-${k}`} className={`${cls} hover:bg-rule/40`} aria-label={fmtLongDate(new Date(startOfKey(k).getTime() + 12 * 3600_000), locale)}>
                      {day}
                    </a>
                  ) : (
                    <div className={cls}>{day}</div>
                  )}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
