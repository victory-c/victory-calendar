import type { PublicEvent } from '@/lib/events/types';
import { addDaysKey, startOfKey } from '@/lib/format/calendar';
import { dayKey } from '@/lib/format/date';
import type { Category, Locale } from '@/lib/taxonomy';

/** 7-day strip under the chips: weekday, date, up to 3 category dots; jumps to the day. */
export function WeekStrip({ events, todayKey, locale }: { events: PublicEvent[]; todayKey: string; locale: Locale }) {
  const tag = locale === 'zh' ? 'zh-CN' : 'en-US';
  const wd = new Intl.DateTimeFormat(tag, { weekday: 'short', timeZone: 'America/Los_Angeles' });
  const byDay = new Map<string, Category[]>();
  for (const e of events) {
    const k = dayKey(e.startAt, e.tz);
    const list = byDay.get(k) ?? [];
    if (!list.includes(e.category)) list.push(e.category);
    byDay.set(k, list);
  }
  const days = Array.from({ length: 7 }, (_, i) => addDaysKey(todayKey, i));
  return (
    <nav aria-label={locale === 'zh' ? '本周日期' : 'This week by day'} className="rail -mx-4 mt-4 overflow-x-auto px-4 md:mx-0 md:px-0">
      <ol className="grid min-w-[22rem] grid-cols-7 gap-1">
        {days.map((k) => {
          const cats = byDay.get(k) ?? [];
          const inner = (
            <>
              <span className="text-[0.6875rem] text-muted">{wd.format(new Date(startOfKey(k).getTime() + 12 * 3600_000))}</span>
              <span className={`tnum font-mono text-base ${k === todayKey ? 'font-semibold' : ''}`}>{Number(k.slice(8))}</span>
              <span className="flex h-1.5 gap-0.5" aria-hidden>
                {cats.slice(0, 3).map((c) => (
                  <span key={c} className="size-1.5 rounded-full" style={{ background: `var(--color-cat-${c})` }} />
                ))}
              </span>
            </>
          );
          const cls = `flex min-h-14 flex-col items-center justify-center gap-0.5 rounded-lg ${k === todayKey ? 'bg-rule/60' : ''}`;
          return (
            <li key={k}>
              {cats.length ? (
                <a href={`#d-${k}`} className={`${cls} hover:bg-rule/40`}>
                  {inner}
                </a>
              ) : (
                <span className={`${cls} opacity-50`}>{inner}</span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
