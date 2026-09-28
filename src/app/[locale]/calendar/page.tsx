import type { Metadata } from 'next';
import { getLocale, getTranslations } from 'next-intl/server';
import { Suspense } from 'react';
import { CalendarGrid } from '@/components/CalendarGrid';
import { CategoryChips, CategoryChipsFallback } from '@/components/CategoryChips';
import { DayList } from '@/components/DayList';
import { EmptyState } from '@/components/EmptyState';
import { FacetPanel } from '@/components/FacetPanel';
import { PageShell } from '@/components/PageShell';
import { Link } from '@/i18n/navigation';
import { applyFilters, parseFilters } from '@/lib/events/filters';
import { getRange, getToday } from '@/lib/events/queries';
import { monthBounds, monthTitle, parseMonth, shiftMonth } from '@/lib/format/calendar';
import { alternates } from '@/lib/seo';
import type { Locale } from '@/lib/taxonomy';

export async function generateMetadata(): Promise<Metadata> {
  const locale = (await getLocale()) as Locale;
  const t = await getTranslations({ locale, namespace: 'Calendar' });
  return { title: t('title'), alternates: alternates('/calendar', locale) };
}

export default async function CalendarPage({ searchParams }: PageProps<'/[locale]/calendar'>) {
  const locale = (await getLocale()) as Locale;
  const t = await getTranslations({ locale, namespace: 'Calendar' });
  const th = await getTranslations({ locale, namespace: 'Home' });
  return (
    <PageShell locale={locale} wide>
      <h1 className="pt-6 text-h1 md:pt-10">{t('title')}</h1>
      <div className="mt-6">
        <Suspense fallback={<CategoryChipsFallback locale={locale} allLabel={th('all')} />}>
          <CategoryChips locale={locale} label={th('filter')} allLabel={th('all')} />
        </Suspense>
      </div>
      <Suspense fallback={<div className="min-h-[150vh]" aria-busy="true" />}>
        <Month locale={locale} searchParams={searchParams} />
      </Suspense>
    </PageShell>
  );
}

async function Month({ locale, searchParams }: { locale: Locale; searchParams: PageProps<'/[locale]/calendar'>['searchParams'] }) {
  const sp = await searchParams;
  const filters = parseFilters(sp);
  const todayKey = await getToday();
  const ym = parseMonth(typeof sp.m === 'string' ? sp.m : undefined, todayKey);
  const { from, to } = monthBounds(ym);
  const data = await getRange(from, to);
  const t = await getTranslations({ locale, namespace: 'Calendar' });
  const visible = applyFilters(data.events, filters);
  const base = locale === 'zh' ? '/zh/calendar' : '/calendar';
  const keep = new URLSearchParams(Object.entries(sp).flatMap(([k, v]) => (typeof v === 'string' && k !== 'm' ? [[k, v]] : [])));
  const hrefFor = (m: string) => {
    const q = new URLSearchParams(keep);
    q.set('m', m);
    return { pathname: '/calendar', query: Object.fromEntries(q) };
  };
  return (
    <>
      <FacetPanel locale={locale} filters={filters} action={base} keep={{ m: ym }} />
      <div className="mt-8 flex items-center justify-between gap-3">
        <h2 className="text-h2">{monthTitle(ym, locale)}</h2>
        <nav className="flex items-center gap-1" aria-label={t('title')}>
          <Link href={hrefFor(shiftMonth(ym, -1))} className="grid size-11 place-items-center rounded-full border border-rule" aria-label={t('prev')}>
            ←
          </Link>
          <Link href={hrefFor(todayKey.slice(0, 7))} className="inline-flex h-11 items-center rounded-full border border-rule px-4 text-sm">
            {t('today')}
          </Link>
          <Link href={hrefFor(shiftMonth(ym, 1))} className="grid size-11 place-items-center rounded-full border border-rule" aria-label={t('next')}>
            →
          </Link>
        </nav>
      </div>
      <p className="mt-1 text-sm text-muted">{t('events', { count: visible.length })}</p>
      <CalendarGrid ym={ym} events={visible} todayKey={todayKey} locale={locale} />
      <div className="mt-8">
        {visible.length === 0 ? (
          <EmptyState text={t('empty')} />
        ) : (
          <DayList events={visible} locale={locale} now={new Date(data.now)} todayKey={todayKey} showAttendance={data.showAttendance} label={t('agenda')} />
        )}
      </div>
    </>
  );
}
