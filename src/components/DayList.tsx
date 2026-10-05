import { getTranslations } from 'next-intl/server';
import { publicGoing } from '@/lib/events/going';
import type { PublicEvent } from '@/lib/events/types';
import { addDaysKey } from '@/lib/format/calendar';
import { dayKey } from '@/lib/format/date';
import type { Locale } from '@/lib/taxonomy';
import { DayHeader } from './DayHeader';
import { EventCard } from './EventCard';

type Props = {
  events: PublicEvent[];
  locale: Locale;
  now: Date;
  todayKey: string;
  showAttendance: boolean;
  /** Accessible name of the list. Day sections get anchor ids "d-YYYY-MM-DD". */
  label: string;
};

/** Events grouped by Pacific day with sticky day headers — home, calendar agenda, week, going. */
export async function DayList({ events, locale, now, todayKey, showAttendance, label }: Props) {
  const t = await getTranslations({ locale, namespace: 'Home' });
  const days = new Map<string, PublicEvent[]>();
  for (const e of events) {
    const k = dayKey(e.startAt); // Pacific day, the same day DayHeader prints
    days.set(k, [...(days.get(k) ?? []), e]);
  }
  const tomorrowKey = addDaysKey(todayKey, 1);
  let rendered = 0;
  return (
    <section aria-label={label}>
      {[...days.entries()].map(([k, list]) => {
        const rel = k === todayKey ? t('today') : k === tomorrowKey ? t('tomorrow') : null;
        return (
          <section key={k} aria-labelledby={`d-${k}`} className="mb-4 scroll-mt-4">
            <DayHeader id={`d-${k}`} date={list[0].startAt} locale={locale} relative={rel} />
            <div className="divide-y divide-rule">
              {list.map((e) => (
                <EventCard key={e.id} event={e} locale={locale} going={publicGoing(e, now, showAttendance)} priority={rendered++ < 2} />
              ))}
            </div>
          </section>
        );
      })}
    </section>
  );
}
