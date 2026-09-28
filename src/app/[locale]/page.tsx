import type { Metadata } from 'next';
import { getLocale, getTranslations } from 'next-intl/server';
import { Suspense } from 'react';
import { CategoryChips, CategoryChipsFallback } from '@/components/CategoryChips';
import { DayHeader } from '@/components/DayHeader';
import { EmptyState } from '@/components/EmptyState';
import { EventCard } from '@/components/EventCard';
import { FeaturedRail } from '@/components/FeaturedRail';
import { GoingStrip } from '@/components/GoingStrip';
import { SampleBanner } from '@/components/SampleBanner';
import { SiteFooter } from '@/components/SiteFooter';
import { SiteHeader } from '@/components/SiteHeader';
import { publicGoing, type SealKind } from '@/lib/events/going';
import { getUpcoming } from '@/lib/events/queries';
import type { PublicEvent } from '@/lib/events/types';
import { dayKey, fmtDayHeader } from '@/lib/format/date';
import { alternates } from '@/lib/seo';
import { parseCategories, type Locale } from '@/lib/taxonomy';

export async function generateMetadata(): Promise<Metadata> {
  const locale = (await getLocale()) as Locale;
  const t = await getTranslations({ locale, namespace: 'Home' });
  return { title: t('title'), alternates: alternates('/', locale) };
}

export default async function Home({ searchParams }: PageProps<'/[locale]'>) {
  const locale = (await getLocale()) as Locale;
  const t = await getTranslations({ locale, namespace: 'Home' });
  const ts = await getTranslations({ locale, namespace: 'Site' });
  return (
    <>
      <Suspense>
        <Banner locale={locale} text={ts('sample')} />
      </Suspense>
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
        <Suspense fallback={<div className="h-96" />}>
          <Week locale={locale} searchParams={searchParams} />
        </Suspense>
      </main>
      <SiteFooter locale={locale} />
    </>
  );
}

async function Banner({ locale, text }: { locale: Locale; text: string }) {
  const { sample } = await getUpcoming();
  void locale;
  return sample ? <SampleBanner text={text} /> : null;
}

async function Week({ locale, searchParams }: { locale: Locale; searchParams: PageProps<'/[locale]'>['searchParams'] }) {
  const sp = await searchParams;
  const cats = parseCategories(typeof sp.c === 'string' ? sp.c : undefined);
  const data = await getUpcoming();
  const t = await getTranslations({ locale, namespace: 'Home' });
  const now = new Date(data.now);
  const going = (e: PublicEvent) => publicGoing(e, now, data.showAttendance);

  const goingItems = data.events.flatMap((e) => {
    const g = going(e);
    return g.kind === 'seal' && g.seal !== 'went' ? [{ event: e, seal: g.seal as SealKind }] : [];
  });
  const visible = cats.length ? data.events.filter((e) => cats.includes(e.category)) : data.events;
  const featured = visible.filter((e) => e.featured && e.status !== 'cancelled').slice(0, 3);

  const days = new Map<string, PublicEvent[]>();
  for (const e of visible) {
    const k = dayKey(e.startAt, e.tz);
    days.set(k, [...(days.get(k) ?? []), e]);
  }
  const tomorrowKey = dayKey(new Date(now.getTime() + 864e5));
  let rendered = 0;

  return (
    <>
      <GoingStrip items={goingItems} locale={locale} />
      <FeaturedRail items={featured.map((e) => ({ event: e, going: going(e) }))} locale={locale} />
      <section aria-label={t('title')} className="mt-10">
        {visible.length === 0 && (
          <EmptyState text={t('empty')} action={{ href: '/', label: t('emptyFilter') }} />
        )}
        {[...days.entries()].map(([k, list]) => {
          const rel = k === data.todayKey ? t('today') : k === tomorrowKey ? t('tomorrow') : null;
          const { date } = fmtDayHeader(list[0].startAt, locale);
          return (
            <section key={k} aria-labelledby={`d-${k}`} className="mb-4">
              <DayHeader id={`d-${k}`} date={list[0].startAt} locale={locale} relative={rel} />
              <span className="sr-only">{date}</span>
              <div className="divide-y divide-rule">
                {list.map((e) => (
                  <EventCard key={e.id} event={e} locale={locale} going={going(e)} priority={rendered++ < 2} />
                ))}
              </div>
            </section>
          );
        })}
      </section>
    </>
  );
}
