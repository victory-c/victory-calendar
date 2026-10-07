import type { Metadata } from 'next';
import { getLocale, getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { AddToCalendarMenu } from '@/components/AddToCalendarMenu';
import { CategoryLabel } from '@/components/CategoryLabel';
import { CoverImage } from '@/components/CoverImage';
import { CoverSourceCredit } from '@/components/CoverSourceCredit';
import { CuratorNote } from '@/components/CuratorNote';
import { DateTime } from '@/components/DateTime';
import { LocalTime } from '@/components/LocalTime';
import { SampleBanner } from '@/components/SampleBanner';
import { SiteFooter } from '@/components/SiteFooter';
import { SiteHeader } from '@/components/SiteHeader';
import { Link } from '@/i18n/navigation';
import { note, place, titles } from '@/lib/events/display';
import { publicGoing } from '@/lib/events/going';
import { eventJsonLd, serializeJsonLd } from '@/lib/events/jsonld';
import { platformName } from '@/lib/events/platform';
import { getEventBySlug, upcomingSlugs } from '@/lib/events/queries';
import { fmtBeijing } from '@/lib/format/date';
import { ogImageUrl, pageMeta } from '@/lib/seo';
import type { Locale } from '@/lib/taxonomy';

// Cache Components needs at least one param at build time. With an empty database (a fresh
// deploy) a placeholder keeps the build valid; the page answers it with notFound().
export async function generateStaticParams() {
  const slugs = await upcomingSlugs();
  return slugs.length ? slugs.map((slug) => ({ slug })) : [{ slug: '__placeholder__' }];
}

export async function generateMetadata({ params }: PageProps<'/[locale]/events/[slug]'>): Promise<Metadata> {
  const { slug } = await params;
  const locale = (await getLocale()) as Locale;
  const { event } = await getEventBySlug(slug);
  if (!event) return {};
  const { primary } = titles(event, locale);
  const n = note(event, locale);
  const t = await getTranslations({ locale, namespace: 'Event' });
  const title = event.status === 'cancelled' ? `[${t('cancelled')}] ${primary}` : primary;
  return pageMeta({ path: `/events/${slug}`, locale, title, description: n?.text ?? undefined, images: [ogImageUrl(event, locale)] });
}

// Lookup happens outside any Suspense boundary so an unknown slug can still answer 404.
export default async function EventPage({ params }: PageProps<'/[locale]/events/[slug]'>) {
  const locale = (await getLocale()) as Locale;
  const { slug } = await params;
  const data = await getEventBySlug(slug);
  if (!data.event) notFound();
  return (
    <>
      <Detail locale={locale} data={data as Found} />
      <SiteFooter locale={locale} />
    </>
  );
}

type Found = Awaited<ReturnType<typeof getEventBySlug>> & { event: NonNullable<Awaited<ReturnType<typeof getEventBySlug>>['event']> };

async function Detail({ locale, data }: { locale: Locale; data: Found }) {
  const { event: e, now, showAttendance, sample } = data;
  const t = await getTranslations({ locale, namespace: 'Event' });
  const ts = await getTranslations({ locale, namespace: 'Site' });
  const { primary, primaryLang, secondary, secondaryLang } = titles(e, locale);
  const n = note(e, locale);
  const going = publicGoing(e, new Date(now), showAttendance);
  const platform = platformName(e.sourceUrl);
  const cancelled = e.status === 'cancelled';
  const summary = locale === 'zh' ? e.summaryZh ?? e.summaryEn : e.summaryEn ?? e.summaryZh;
  const where = [e.venueName, e.address, place(e)].filter(Boolean).join(' · ');

  return (
    <>
      {sample && <SampleBanner text={ts('sample')} />}
      <SiteHeader locale={locale} path={`/events/${e.slug}`} />
      <main id="main" className="mx-auto max-w-2xl px-4 pb-8">
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(eventJsonLd(e, primary)) }} />
        <Link href="/" className="mt-4 inline-flex h-11 items-center text-sm text-muted">
          ← {t('back')}
        </Link>

        <CoverImage
          cover={e.cover}
          category={e.category}
          hostName={e.hostName}
          alt={primary}
          size={640}
          className="!w-full"
          seal={going.kind === 'seal' ? going.seal : null}
          sealSize="lg"
          locale={locale}
          priority
        />
        {e.cover && e.cover.kind === 'official' && (
          <p className="mt-2 text-xs text-muted">
            <a href={e.sourceUrl} rel="noopener noreferrer" target="_blank">
              {t('coverCredit', { host: e.hostName ?? platform ?? '', platform: platform ?? '' })}
            </a>
          </p>
        )}
        {e.cover && <CoverSourceCredit cover={e.cover} t={t} />}

        <h1 lang={primaryLang} className={`mt-6 min-h-[1.3em] text-h2 md:text-h1 ${cancelled ? 'line-through decoration-2 text-muted' : ''}`}>
          {primary}
        </h1>
        {secondary && (
          <p lang={secondaryLang} className="mt-1 text-muted">
            {secondary}
          </p>
        )}

        <div className="mt-4 space-y-1">
          <DateTime start={e.startAt} end={e.endAt} locale={locale} className="tnum block font-mono text-sm" />
          {e.format !== 'in_person' && (
            <>
              <LocalTime iso={e.startAt.toISOString()} locale={locale} label={t('yourTime')} />
              {locale === 'zh' && <p className="tnum font-mono text-sm text-muted">{fmtBeijing(e.startAt)}</p>}
            </>
          )}
          <p className="text-sm">{e.format === 'online' ? t('online') : where}</p>
          {e.hostName && <p className="text-sm text-muted">{t('hostedBy', { host: e.hostName })}</p>}
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-1.5 text-xs">
          <CategoryLabel category={e.category} locale={locale} />
          {e.priceText && (
            <span className="inline-flex min-h-6 items-center rounded-full border border-rule px-2.5">
              {/^free$/i.test(e.priceText.trim()) ? t('free') : e.priceText}
            </span>
          )}
          {(e.access === 'apply' || e.access === 'waitlist' || e.access === 'sold_out') && (
            <span className="inline-flex min-h-6 items-center rounded-full border border-rule px-2.5">{t(e.access)}</span>
          )}
          {e.eventLanguage !== 'en' && (
            <span className="inline-flex min-h-6 items-center rounded-full border border-rule px-2.5">
              {e.eventLanguage === 'zh' ? t('langZh') : t('langBilingual')}
            </span>
          )}
          {cancelled && <span className="inline-flex min-h-6 items-center rounded-full border border-ink px-2.5">{t('cancelled')}</span>}
          {going.kind === 'interested' && <span className="text-muted">{t('interested')}</span>}
        </div>

        {n && (
          <div className="mt-6">
            <CuratorNote text={n.text} lang={n.lang} signature={t('signature')} clamp={false} />
          </div>
        )}
        {summary && <p className="mt-4 max-w-prose text-muted">{summary}</p>}

        {!cancelled && (
          <div className="mt-8 flex flex-wrap items-start gap-3">
            <a
              href={e.sourceUrl}
              rel="noopener noreferrer"
              target="_blank"
              className="inline-flex h-11 items-center gap-2 rounded-full bg-ink px-6 text-sm text-paper"
            >
              {platform ? t('rsvpAt', { platform }) : t('rsvp')}
              <span aria-hidden>↗</span>
            </a>
            <AddToCalendarMenu event={e} locale={locale} />
          </div>
        )}
        <p className="mt-6 text-xs text-muted">{t('refreshNote')}</p>
      </main>
    </>
  );
}
