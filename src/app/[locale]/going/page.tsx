import type { Metadata } from 'next';
import { getLocale, getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { DayList } from '@/components/DayList';
import { EmptyState } from '@/components/EmptyState';
import { PageShell } from '@/components/PageShell';
import { publicGoing } from '@/lib/events/going';
import { getWindow } from '@/lib/events/queries';
import { dayKey } from '@/lib/format/date';
import { alternates } from '@/lib/seo';
import type { Locale } from '@/lib/taxonomy';

export async function generateMetadata(): Promise<Metadata> {
  const locale = (await getLocale()) as Locale;
  const t = await getTranslations({ locale, namespace: 'Going' });
  return { title: t('title'), alternates: alternates('/going', locale) };
}

// Upcoming public going/hosting/speaking plus a "went" archive. Master switch off → 404.
export default async function GoingPage() {
  const locale = (await getLocale()) as Locale;
  const data = await getWindow(-180, 90);
  if (!data.showAttendance) notFound();
  const t = await getTranslations({ locale, namespace: 'Going' });
  const now = new Date(data.now);
  const sealOf = (e: (typeof data.events)[number]) => {
    const g = publicGoing(e, now, true);
    return g.kind === 'seal' ? g.seal : null;
  };
  const upcoming = data.events.filter((e) => { const s = sealOf(e); return s !== null && s !== 'went'; });
  const went = data.events.filter((e) => sealOf(e) === 'went').reverse();
  const todayKey = dayKey(now);
  return (
    <PageShell locale={locale}>
      <h1 className="pt-6 text-h1 md:pt-10">{t('title')}</h1>
      <p className="mt-2 max-w-prose text-muted">{t('intro')}</p>
      <h2 className="mt-10 font-sans text-sm font-medium tracking-wide text-muted">{t('upcoming')}</h2>
      {upcoming.length ? (
        <DayList events={upcoming} locale={locale} now={now} todayKey={todayKey} showAttendance label={t('upcoming')} />
      ) : (
        <EmptyState text={t('empty')} />
      )}
      {went.length > 0 && (
        <>
          <h2 className="mt-12 font-sans text-sm font-medium tracking-wide text-muted">{t('went')}</h2>
          <DayList events={went} locale={locale} now={now} todayKey={todayKey} showAttendance label={t('went')} />
        </>
      )}
    </PageShell>
  );
}
