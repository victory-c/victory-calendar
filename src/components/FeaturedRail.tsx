import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { note, titles } from '@/lib/events/display';
import type { GoingDisplay } from '@/lib/events/going';
import type { PublicEvent } from '@/lib/events/types';
import { allDayLabel, fmtDateBadge, fmtTime, isoWithOffset } from '@/lib/format/date';
import type { Locale } from '@/lib/taxonomy';
import { CoverImage } from './CoverImage';
import { CuratorNote } from './CuratorNote';

type Item = { event: PublicEvent; going: GoingDisplay };

/** Phone: horizontal rail of 260 px cards (228 px covers). Desktop: 2–3 column grid. */
export async function FeaturedRail({ items, locale }: { items: Item[]; locale: Locale }) {
  if (items.length === 0) return null;
  const t = await getTranslations({ locale, namespace: 'Home' });
  const te = await getTranslations({ locale, namespace: 'Event' });
  return (
    <section aria-labelledby="featured-h" className="mt-8">
      <h2 id="featured-h" className="font-sans text-sm font-medium tracking-wide text-muted">
        {t('featured')}
      </h2>
      <ul className="rail -mx-4 mt-3 flex snap-x snap-mandatory gap-4 overflow-x-auto px-4 pb-2 md:mx-0 md:grid md:grid-cols-3 md:overflow-visible md:px-0">
        {items.map(({ event: e, going }, i) => {
          const { primary, primaryLang, secondary, secondaryLang } = titles(e, locale);
          const n = note(e, locale);
          const badge = fmtDateBadge(e.startAt, locale);
          return (
            <li key={e.id} className="w-[260px] shrink-0 snap-start rounded-card border border-rule p-4 md:w-auto">
              <Link href={`/events/${e.slug}`} tabIndex={-1} aria-hidden className="block">
                <CoverImage
                  cover={e.cover}
                  category={e.category}
                  hostName={e.hostName}
                  alt=""
                  size={320}
                  className="!w-full"
                  seal={going.kind === 'seal' ? going.seal : null}
                  sealSize="md"
                  locale={locale}
                  priority={i < 2}
                />
              </Link>
              <div className="mt-3 flex gap-3">
                <time dateTime={isoWithOffset(e.startAt)} className="shrink-0 text-center font-mono leading-none">
                  <span className="tnum block text-h3">{badge.day}</span>
                  <span className="mt-1 block text-xs text-muted">{badge.weekday}</span>
                  <span className="tnum mt-1 block text-xs text-muted">{e.allDay ? allDayLabel(locale) : fmtTime(e.startAt, locale)}</span>
                </time>
                <div className="min-w-0">
                  <h3 className="text-[1.0625rem] font-display">
                    <Link href={`/events/${e.slug}`} lang={primaryLang} className="title-link line-clamp-2">
                      {primary}
                    </Link>
                  </h3>
                  {secondary && (
                    <p lang={secondaryLang} className="mt-0.5 line-clamp-1 text-[0.8125rem] text-muted">
                      {secondary}
                    </p>
                  )}
                </div>
              </div>
              {n && (
                <div className="mt-3">
                  <CuratorNote text={n.text} lang={n.lang} signature={te('signature')} />
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
