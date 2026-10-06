import type { Metadata } from 'next';
import { getLocale, getTranslations } from 'next-intl/server';
import { PageShell } from '@/components/PageShell';
import { Link } from '@/i18n/navigation';
import { braveConfigured } from '@/lib/covers/brave';
import { pageMeta } from '@/lib/seo';
import type { Locale } from '@/lib/taxonomy';

export async function generateMetadata(): Promise<Metadata> {
  const locale = (await getLocale()) as Locale;
  const t = await getTranslations({ locale, namespace: 'About' });
  return pageMeta({ path: '/about', locale, title: t('title'), description: t('body1') });
}

export default async function AboutPage() {
  const locale = (await getLocale()) as Locale;
  const t = await getTranslations({ locale, namespace: 'About' });
  return (
    <PageShell locale={locale} path="/about">
      <article className="max-w-prose pt-6 md:pt-10">
        <h1 className="text-h1">{t('title')}</h1>
        <p className="mt-6">{t('body1')}</p>
        <p className="mt-4">{t('body2')}</p>
        <p className="mt-4 border-l-2 border-rule pl-3 text-muted">{t('body3')}</p>
        {/* Brave's API terms ask for attribution once its image search is in use (cover picker, M4). */}
        {braveConfigured() && (
          <p className="mt-4 text-sm text-muted">
            {t.rich('brave', { brave: (chunks) => <a href="https://search.brave.com/" className="underline underline-offset-2">{chunks}</a> })}
          </p>
        )}
        <ul className="mt-8 flex flex-wrap gap-3 text-sm">
          <li><Link href="/calendar" className="inline-flex h-11 items-center rounded-full border border-rule px-4">{t('nav.calendar')}</Link></li>
          <li><Link href="/going" className="inline-flex h-11 items-center rounded-full border border-rule px-4">{t('nav.going')}</Link></li>
          <li><Link href="/archive" className="inline-flex h-11 items-center rounded-full border border-rule px-4">{t('nav.archive')}</Link></li>
        </ul>
      </article>
    </PageShell>
  );
}
