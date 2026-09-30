import type { Metadata } from 'next';
import { getLocale, getTranslations } from 'next-intl/server';
import { Suspense } from 'react';
import { CategoryChips, CategoryChipsFallback } from '@/components/CategoryChips';
import { DayList } from '@/components/DayList';
import { EmptyState } from '@/components/EmptyState';
import { FacetPanel } from '@/components/FacetPanel';
import { FeaturedRail } from '@/components/FeaturedRail';
import { GoingStrip } from '@/components/GoingStrip';
import { SampleBanner } from '@/components/SampleBanner';
import { SiteFooter } from '@/components/SiteFooter';
import { SiteHeader } from '@/components/SiteHeader';
import { SubscribeMenu } from '@/components/SubscribeMenu';
import { WeekStrip } from '@/components/WeekStrip';
import { applyFilters, parseFilters } from '@/lib/events/filters';
import { publicGoing, type SealKind } from '@/lib/events/going';
import { getUpcoming } from '@/lib/events/queries';
import { hasDatabase } from '@/lib/db';
import type { PublicEvent } from '@/lib/events/types';
import { pageMeta } from '@/lib/seo';
import type { Locale } from '@/lib/taxonomy';

export async function generateMetadata(): Promise<Metadata> {
  const locale = (await getLocale()) as Locale;
  const t = await getTranslations({ locale, namespace: 'Home' });
  const ts = await getTranslations({ locale, namespace: 'Site' });
  return pageMeta({ path: '/', locale, title: t('title'), description: ts('tagline'), absolute: true });
}

export default async function Home({ searchParams }: PageProps<'/[locale]'>) {
  const locale = (await getLocale()) as Locale;
  const t = await getTranslations({ locale, namespace: 'Home' });
  const ts = await getTranslations({ locale, namespace: 'Site' });
  return (
    <>
      {!hasDatabase() && <SampleBanner text={ts('sample')} />}
      <SiteHeader locale={locale} />
      <main id="main" className="mx-auto max-w-4xl px-4">
        <div className="pt-6 md:pt-10">
          <h1 className="text-h1 md:text-display">{t('title')}</h1>
          <p className="mt-2 max-w-prose text-muted">{ts('tagline')}</p>
        </div>
        <div className="mt-6">
          <Suspense fallback={<CategoryChipsFallback locale={locale} allLabel={t('all')} />}>
            <CategoryChips locale={locale} label={t('filter')} allLabel={t('all')} />
          </Suspense>
        </div>
        <Suspense fallback={<div className="min-h-[150vh]" aria-busy="true" />}>
          <Week locale={locale} searchParams={searchParams} />
        </Suspense>
      </main>
      <SiteFooter locale={locale} />
    </>
  );
}

async function Week({ locale, searchParams }: { locale: Locale; searchParams: PageProps<'/[locale]'>['searchParams'] }) {
  const filters = parseFilters(await searchParams);
  const data = await getUpcoming();
  const t = await getTranslations({ locale, namespace: 'Home' });
  const now = new Date(data.now);
  const going = (e: PublicEvent) => publicGoing(e, now, data.showAttendance);

  const goingItems = data.events.flatMap((e) => {
    const g = going(e);
    return g.kind === 'seal' && g.seal !== 'went' ? [{ event: e, seal: g.seal as SealKind }] : [];
  });
  const visible = applyFilters(data.events, filters);
  const featured = visible.filter((e) => e.featured && e.status !== 'cancelled').slice(0, 3);

  return (
    <>
      <FacetPanel locale={locale} filters={filters} action={locale === 'zh' ? '/zh' : '/'} />
      <SubscribeMenu locale={locale} cats={filters.cats} />
      <WeekStrip events={visible} todayKey={data.todayKey} locale={locale} />
      <GoingStrip items={goingItems} locale={locale} />
      <FeaturedRail items={featured.map((e) => ({ event: e, going: going(e) }))} locale={locale} />
      <div className="mt-10">
        {data.events.length === 0 ? (
          // Nothing picked yet this week: no filter to widen.
          <EmptyState text={t('comingSoon')} />
        ) : visible.length === 0 ? (
          <EmptyState text={t('empty')} action={{ href: '/', label: t('emptyFilter') }} />
        ) : (
          <DayList events={visible} locale={locale} now={now} todayKey={data.todayKey} showAttendance={data.showAttendance} label={t('title')} />
        )}
      </div>
    </>
  );
}
