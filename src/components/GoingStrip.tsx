import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { titles } from '@/lib/events/display';
import type { SealKind } from '@/lib/events/going';
import type { PublicEvent } from '@/lib/events/types';
import { fmtDayHeader, fmtTime } from '@/lib/format/date';
import type { Locale } from '@/lib/taxonomy';
import { CoverImage } from './CoverImage';

type Item = { event: PublicEvent; seal: SealKind };

/** "Victor 会去" strip. Not rendered at all when the master switch is off or nothing qualifies. */
export async function GoingStrip({ items, locale }: { items: Item[]; locale: Locale }) {
  if (items.length === 0) return null;
  const t = await getTranslations({ locale, namespace: 'Home' });
  return (
    <section aria-labelledby="going-h" className="mt-8">
      <h2 id="going-h" className="font-sans text-sm font-medium tracking-wide text-muted">
        {t('going')}
      </h2>
      <ul className="rail -mx-4 mt-3 flex gap-5 overflow-x-auto px-4 pt-2 pb-2 md:mx-0 md:px-0">
        {items.map(({ event: e, seal }) => {
          const { primary, primaryLang } = titles(e, locale);
          const day = fmtDayHeader(e.startAt, locale, e.tz);
          return (
            <li key={e.id} className="flex w-[232px] shrink-0 items-center gap-3">
              <CoverImage cover={e.cover} category={e.category} hostName={null} alt="" size={64} seal={seal} sealSize="sm" locale={locale} className="going-strip-cover shrink-0" />
              <div className="min-w-0">
                <Link href={`/events/${e.slug}`} lang={primaryLang} className="title-link line-clamp-2 font-display text-[0.9375rem] leading-snug">
                  {primary}
                </Link>
                <p className="tnum mt-0.5 font-mono text-xs text-muted">
                  {day.weekday} {fmtTime(e.startAt, locale, e.tz)}
                </p>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
