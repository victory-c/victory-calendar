import { Fragment } from 'react';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { titles, note, place } from '@/lib/events/display';
import type { GoingDisplay } from '@/lib/events/going';
import type { PublicEvent } from '@/lib/events/types';
import { fmtDuration, fmtTimeParts, isoWithOffset } from '@/lib/format/date';
import type { Locale } from '@/lib/taxonomy';
import { CategoryLabel } from './CategoryLabel';
import { CoverImage } from './CoverImage';
import { CuratorNote } from './CuratorNote';

type Props = {
  event: PublicEvent;
  locale: Locale;
  going: GoingDisplay;
  priority?: boolean;
  /** Title heading level, one below the day header above it: h3 on day lists, h4 on /weekly/[week]. */
  titleAs?: 'h3' | 'h4';
};

// globals.css gives h1–h3 the heading face (weight, leading, wrapping, zh tracking); an h4 title
// borrows the same so the card looks identical at either level.
const H4_LOOK = 'font-semibold leading-heading wrap-anywhere [font-synthesis-weight:none] [&:lang(zh-Hans)]:tracking-[0.02em]';

/** Ledger row: TimeBadge | 1:1 cover | title, meta, chip — note spans under cover + text. */
export async function EventCard({ event: e, locale, going, priority, titleAs: Title = 'h3' }: Props) {
  const t = await getTranslations({ locale, namespace: 'Event' });
  const { primary, primaryLang, secondary, secondaryLang } = titles(e, locale);
  const n = note(e, locale);
  const { time, period } = fmtTimeParts(e.startAt, locale, e.tz);
  const duration = e.allDay ? t('allDay') : fmtDuration(e.startAt, e.endAt, locale);
  const cancelled = e.status === 'cancelled';
  const seal = going.kind === 'seal' ? going.seal : null;
  const meta = metaItems(e, locale, t);

  return (
    <article data-cat={e.category} className="event-card grid grid-cols-[3.5rem_7rem_minmax(0,1fr)] gap-x-3 gap-y-3 py-5 md:grid-cols-[4.5rem_9rem_minmax(0,1fr)] md:gap-x-5">
      <div className="pt-0.5 font-mono">
        <time dateTime={isoWithOffset(e.startAt, e.tz)} className="tnum block text-[1.125rem] leading-none md:text-h3">
          {e.allDay ? '—' : time}
        </time>
        {/* en: AM/PM rides on the second line so "12:00" fits the 56 px column. */}
        {period && !e.allDay && <span className="mt-1 block text-xs text-muted">{period}</span>}
        {duration && <span className="mt-1 block text-xs text-muted">{duration}</span>}
      </div>

      <Link href={`/events/${e.slug}`} className="block self-start" tabIndex={-1} aria-hidden>
        <CoverImage
          cover={e.cover}
          category={e.category}
          hostName={e.hostName}
          alt=""
          size={112}
          className="md:hidden"
          seal={seal}
          sealSize="sm"
          locale={locale}
          priority={priority}
        />
        <CoverImage
          cover={e.cover}
          category={e.category}
          hostName={e.hostName}
          alt=""
          size={144}
          className="hidden md:block"
          seal={seal}
          sealSize="md"
          locale={locale}
          priority={priority}
        />
      </Link>

      <div className="min-w-0">
        <Title className={Title === 'h4' ? `text-h3 font-display ${H4_LOOK}` : 'text-h3 font-display'}>
          <Link
            href={`/events/${e.slug}`}
            lang={primaryLang}
            className={`title-link line-clamp-2 ${cancelled ? 'line-through decoration-1 text-muted' : ''}`}
          >
            {primary}
          </Link>
        </Title>
        {secondary && (
          <p lang={secondaryLang} className="mt-0.5 line-clamp-1 text-[0.8125rem] text-muted">
            {secondary}
          </p>
        )}
        <p className="mt-1.5 font-mono text-xs leading-relaxed text-muted">
          {meta.map((m, i) => (
            <Fragment key={i}>
              {i > 0 && <>{' '}<span aria-hidden>·</span>{' '}</>}
              <span lang={m.lang}>{m.text}</span>
            </Fragment>
          ))}
          {going.kind === 'interested' && (
            <span>
              {meta.length > 0 && <>{' '}<span aria-hidden>·</span>{' '}</>}
              {t('interested')}
            </span>
          )}
        </p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <CategoryLabel category={e.category} locale={locale} />
          {cancelled && (
            <span className="inline-flex h-6 items-center rounded-full border border-rule px-2.5 text-xs">{t('cancelled')}</span>
          )}
        </div>
      </div>

      {n && (
        <div className="col-start-2 col-end-4 md:col-start-3">
          <CuratorNote text={n.text} lang={n.lang} signature={t('signature')} />
        </div>
      )}
    </article>
  );
}

type T = Awaited<ReturnType<typeof getTranslations<'Event'>>>;

function metaItems(e: PublicEvent, locale: Locale, t: T) {
  const items: { text: string; lang?: string }[] = [];
  const p = place(e);
  if (e.format === 'online') items.push({ text: t('online') });
  else if (p) items.push({ text: p, lang: 'en' });
  if (e.format === 'hybrid') items.push({ text: t('hybrid') });
  if (e.priceText) items.push(/^free$/i.test(e.priceText.trim()) ? { text: t('free') } : { text: e.priceText, lang: 'en' });
  if (e.eventLanguage === 'zh') items.push({ text: t('langZh'), lang: 'zh-Hans' });
  if (e.eventLanguage === 'bilingual') items.push({ text: t('langBilingual') });
  if (e.access === 'apply' || e.access === 'waitlist' || e.access === 'sold_out') items.push({ text: t(e.access) });
  void locale;
  return items;
}
