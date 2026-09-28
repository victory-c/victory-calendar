import type { Metadata } from 'next';
import { getLocale, getTranslations } from 'next-intl/server';
import { Suspense } from 'react';
import { DayList } from '@/components/DayList';
import { EmptyState } from '@/components/EmptyState';
import { PageShell } from '@/components/PageShell';
import { Link } from '@/i18n/navigation';
import { getRange, getToday } from '@/lib/events/queries';
import { monthBounds, monthTitle, parseMonth, shiftMonth } from '@/lib/format/calendar';
import { alternates } from '@/lib/seo';
import type { Locale } from '@/lib/taxonomy';

export async function generateMetadata(): Promise<Metadata> {
  const locale = (await getLocale()) as Locale;
  const t = await getTranslations({ locale, namespace: 'Archive' });
  return { title: t('title'), alternates: alternates('/archive', locale) };
}

export default async function ArchivePage({ searchParams }: PageProps<'/[locale]/archive'>) {
  const locale = (await getLocale()) as Locale;
  const t = await getTranslations({ locale, namespace: 'Archive' });
  return (
    <PageShell locale={locale}>
      <h1 className="pt-6 text-h1 md:pt-10">{t('title')}</h1>
      <p className="mt-2 text-muted">{t('intro')}</p>
      <Suspense fallback={<div className="h-96" />}>
        <Past locale={locale} searchParams={searchParams} />
      </Suspense>
    </PageShell>
  );
}

async function Past({ locale, searchParams }: { locale: Locale; searchParams: PageProps<'/[locale]/archive'>['searchParams'] }) {
  const sp = await searchParams;
  const todayKey = await getToday();
  const ym = parseMonth(typeof sp.m === 'string' ? sp.m : undefined, todayKey);
  const { from, to } = monthBounds(ym);
  const data = await getRange(from, to < todayKey ? to : todayKey);
  const t = await getTranslations({ locale, namespace: 'Archive' });
  const tc = await getTranslations({ locale, namespace: 'Calendar' });
  const past = [...data.events].reverse();
  return (
    <>
      <div className="mt-8 flex items-center justify-between">
        <h2 className="text-h2">{monthTitle(ym, locale)}</h2>
        <nav className="flex gap-1" aria-label={t('title')}>
          <Link href={{ pathname: '/archive', query: { m: shiftMonth(ym, -1) } }} className="grid size-11 place-items-center rounded-full border border-rule" aria-label={tc('prev')}>
            ←
          </Link>
          {ym < todayKey.slice(0, 7) && (
            <Link href={{ pathname: '/archive', query: { m: shiftMonth(ym, 1) } }} className="grid size-11 place-items-center rounded-full border border-rule" aria-label={tc('next')}>
              →
            </Link>
          )}
        </nav>
      </div>
      <div className="mt-6">
        {past.length ? (
          <DayList events={past} locale={locale} now={new Date(data.now)} todayKey={todayKey} showAttendance={data.showAttendance} label={monthTitle(ym, locale)} />
        ) : (
          <EmptyState text={t('empty')} />
        )}
      </div>
    </>
  );
}
