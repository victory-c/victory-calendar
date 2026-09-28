import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';
import { Link } from '@/i18n/navigation';
import type { Locale } from '@/lib/taxonomy';
import { LangSwitch, LangSwitchFallback } from './LangSwitch';
import { Wordmark } from './Wordmark';

/** `path` is the locale-less path of this page, so the prerendered language pill links to the same page. */
export async function SiteHeader({ locale, path = '/' }: { locale: Locale; path?: string }) {
  const t = await getTranslations({ locale, namespace: 'Site' });
  return (
    <header className="mx-auto flex h-14 max-w-4xl items-center justify-between gap-3 px-4">
      <Link href="/" className="rounded-sm">
        <Wordmark locale={locale} name={t('name')} />
      </Link>
      <div className="flex items-center gap-2">
        <nav aria-label={t('nav')} className="mr-2 hidden items-center gap-4 text-sm text-muted md:flex">
          <Link href="/calendar">{t('calendar')}</Link>
          <Link href="/going">{t('going')}</Link>
        </nav>
        <Suspense fallback={<LangSwitchFallback label={t('langSwitch')} pathname={path} />}>
          <LangSwitch label={t('langSwitch')} />
        </Suspense>
        {/* Newsletter "Subscribe" returns in M3 with /subscribe; calendar subscriptions live on each list page. */}
      </div>
    </header>
  );
}
