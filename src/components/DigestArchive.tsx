import { Fragment } from 'react';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { type ArchiveView, weekDate } from '@/lib/digest/archive';
import { dayLabel } from '@/lib/digest/fields';
import { place, titles } from '@/lib/events/display';
import type { PublicEvent } from '@/lib/events/types';
import { fmtRange, isoWithOffset } from '@/lib/format/date';
import { CATEGORIES, type Locale } from '@/lib/taxonomy';
import { CoverImage } from './CoverImage';
import { DayHeader } from './DayHeader';
import { EmptyState } from './EmptyState';
import { EventCard } from './EventCard';

/** One item of a mono meta line; place names are English, so they carry lang="en" (as on EventCard). */
type Meta = { text: string; lang?: string };

/**
 * One digest issue as a web page (/weekly/[week]), in the email's order: intro → 我会去 → one
 * section per category by day → next-week preview. Not DayList: its day anchors ("d-<day>") would
 * repeat across category sections, so each section's days get "d-<category>-<day>". Headings nest
 * one level deeper than on DayList: category h2 → day h3 → event h4.
 */
export async function DigestArchive({ view, locale }: { view: ArchiveView; locale: Locale }) {
  const t = await getTranslations({ locale, namespace: 'Weekly' });
  const te = await getTranslations({ locale, namespace: 'Event' });
  let rendered = 0;
  const where = (e: PublicEvent): Meta | null => {
    if (e.format === 'online') return { text: te('online') };
    const p = place(e);
    return p ? { text: p, lang: 'en' } : null;
  };

  return (
    <article aria-labelledby="issue-h">
      <Link href="/weekly" className="mt-4 inline-flex h-11 items-center text-sm text-muted">
        ← {t('allIssues')}
      </Link>
      <h1 id="issue-h" className="mt-2 text-h2 md:text-h1">
        {t('issueTitle', { date: weekDate(view.isoWeek, locale) })}
      </h1>
      {view.intro.length > 0 && (
        <div className="mt-4 max-w-prose space-y-3">
          {view.intro.map((line, i) => (
            <p key={i}>{line}</p>
          ))}
        </div>
      )}
      <p className="mt-4 text-sm">
        <Link href={`/week/${view.isoWeek}`} className="underline underline-offset-4">
          {t('allEvents')} →
        </Link>
      </p>

      {view.going.length > 0 && (
        <section aria-labelledby="going-h" className="mt-10">
          <h2 id="going-h" className="font-sans text-sm font-medium tracking-wide text-muted">
            {t('going')}
          </h2>
          <ul className="mt-3 space-y-4">
            {view.going.map(({ event: e, seal }) => {
              const { primary, primaryLang } = titles(e, locale);
              // The day, never an arrival time (guide「Going 状态安全规则」); after the event the seal says 去过.
              const w = where(e);
              const meta: Meta[] = [{ text: dayLabel(e.startAt, locale) }, ...(w ? [w] : [])];
              if (seal !== 'went') meta.unshift({ text: t('planToGo') });
              return (
                <li key={e.id} className="flex items-center gap-3">
                  <CoverImage cover={e.cover} category={e.category} hostName={null} alt="" size={64} seal={seal} sealSize="sm" locale={locale} className="shrink-0" />
                  <div className="min-w-0">
                    <Link href={`/events/${e.slug}`} lang={primaryLang} className="title-link line-clamp-2 font-display text-[0.9375rem] leading-snug">
                      {primary}
                    </Link>
                    <p className="mt-0.5 font-mono text-xs text-muted">
                      {meta.map((m, i) => (
                        <Fragment key={i}>
                          {i > 0 && <>{' '}<span aria-hidden>·</span>{' '}</>}
                          <span lang={m.lang}>{m.text}</span>
                        </Fragment>
                      ))}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {view.sections.map((sec) => (
        <section key={sec.category} aria-labelledby={`c-${sec.category}`} className="mt-10">
          <h2 id={`c-${sec.category}`} className="mb-2 flex items-center gap-2 text-h3 font-display">
            <span aria-hidden className="size-2.5 shrink-0 rounded-full" style={{ background: `var(--color-cat-${sec.category})` }} />
            {CATEGORIES[sec.category][locale]}
          </h2>
          {sec.days.map((d) => {
            const id = `d-${sec.category}-${d.key}`;
            return (
              <section key={d.key} aria-labelledby={id} className="mb-4 scroll-mt-4">
                <DayHeader id={id} date={d.date} locale={locale} as="h3" />
                <div className="divide-y divide-rule">
                  {d.cards.map(({ event, going }) => (
                    <EventCard key={event.id} event={event} locale={locale} going={going} priority={rendered++ < 2} titleAs="h4" />
                  ))}
                </div>
              </section>
            );
          })}
        </section>
      ))}

      {/* Emails link here, so an issue whose events were all taken down still answers 200. */}
      {view.picks === 0 && <EmptyState text={t('nothingLeft')} action={{ href: `/week/${view.isoWeek}`, label: t('allEvents') }} />}

      {view.preview.events.length > 0 && (
        <section aria-labelledby="preview-h" className="mt-12">
          <h2 id="preview-h" className="font-sans text-sm font-medium tracking-wide text-muted">
            {t('preview', { date: weekDate(view.preview.isoWeek, locale) })}
          </h2>
          <ul className="mt-3 space-y-3">
            {view.preview.events.map((e) => {
              const { primary, primaryLang } = titles(e, locale);
              const cancelled = e.status === 'cancelled';
              const w = where(e);
              return (
                <li key={e.id}>
                  <Link
                    href={`/events/${e.slug}`}
                    lang={primaryLang}
                    className={`title-link font-display ${cancelled ? 'line-through decoration-1 text-muted' : ''}`}
                  >
                    {primary}
                  </Link>
                  <p className="mt-0.5 font-mono text-xs text-muted">
                    {e.allDay ? (
                      <>
                        {dayLabel(e.startAt, locale)}
                        {' '}<span aria-hidden>·</span>{' '}
                        {te('allDay')}
                      </>
                    ) : (
                      // Pacific clock like every time on the site, whatever zone the event is in.
                      <time dateTime={isoWithOffset(e.startAt)}>{fmtRange(e.startAt, e.endAt, locale)}</time>
                    )}
                    {w && (
                      <>
                        {' '}<span aria-hidden>·</span>{' '}
                        <span lang={w.lang}>{w.text}</span>
                      </>
                    )}
                    {cancelled && (
                      <>
                        {' '}<span aria-hidden>·</span>{' '}
                        {te('cancelled')}
                      </>
                    )}
                  </p>
                </li>
              );
            })}
          </ul>
          <p className="mt-4 text-sm">
            <Link href={view.preview.href} className="underline underline-offset-4">
              {t('previewMore')} →
            </Link>
          </p>
        </section>
      )}
    </article>
  );
}
