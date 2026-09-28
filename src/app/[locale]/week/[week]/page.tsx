import type { Metadata } from 'next';
import { getLocale, getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { DayList } from '@/components/DayList';
import { EmptyState } from '@/components/EmptyState';
import { PageShell } from '@/components/PageShell';
import { Link } from '@/i18n/navigation';
import { getRange, getToday } from '@/lib/events/queries';
import { addDaysKey, isoWeekBounds, isoWeekOf, startOfKey } from '@/lib/format/calendar';
import { fmtDayHeader } from '@/lib/format/date';
import { pageMeta } from '@/lib/seo';
import type { Locale } from '@/lib/taxonomy';

// Permanent link for any ISO week (digest and WeChat text point here): /week/2026-W41
export async function generateStaticParams() {
  const today = await getToday();
  return [0, 7].map((d) => ({ week: isoWeekOf(addDaysKey(today, d)) }));
}

export async function generateMetadata({ params }: PageProps<'/[locale]/week/[week]'>): Promise<Metadata> {
  const { week } = await params;
  const locale = (await getLocale()) as Locale;
  const b = isoWeekBounds(week);
  if (!b) return {};
  const t = await getTranslations({ locale, namespace: 'Week' });
  const date = fmtDayHeader(new Date(startOfKey(b.from).getTime() + 12 * 3600_000), locale).date;
  return pageMeta({ path: `/week/${week}`, locale, title: t('title', { date }), description: t('description', { date }) });
}

export default async function WeekPage({ params }: PageProps<'/[locale]/week/[week]'>) {
  const { week } = await params;
  const locale = (await getLocale()) as Locale;
  const b = isoWeekBounds(week);
  if (!b) notFound();
  const data = await getRange(b.from, b.to);
  const t = await getTranslations({ locale, namespace: 'Week' });
  const th = await getTranslations({ locale, namespace: 'Home' });
  const noon = (k: string) => new Date(startOfKey(k).getTime() + 12 * 3600_000);
  return (
    <PageShell locale={locale} path={`/week/${week}`}>
      <div className="flex items-center justify-between gap-3 pt-6 md:pt-10">
        <h1 className="text-h2 md:text-h1">{t('title', { date: fmtDayHeader(noon(b.from), locale).date })}</h1>
        <nav className="flex gap-1" aria-label={t('title', { date: '' })}>
          <Link href={`/week/${isoWeekOf(addDaysKey(b.from, -7))}`} className="grid size-11 place-items-center rounded-full border border-rule" aria-label={t('prev')}>
            ←
          </Link>
          <Link href={`/week/${isoWeekOf(addDaysKey(b.from, 7))}`} className="grid size-11 place-items-center rounded-full border border-rule" aria-label={t('next')}>
            →
          </Link>
        </nav>
      </div>
      <div className="mt-8">
        {data.events.length ? (
          <DayList events={data.events} locale={locale} now={new Date(data.now)} todayKey={data.todayKey} showAttendance={data.showAttendance} label={week} />
        ) : (
          <EmptyState text={th('empty')} />
        )}
      </div>
    </PageShell>
  );
}
