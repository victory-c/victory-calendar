import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';
import { Link } from '@/i18n/navigation';
import type { Locale } from '@/lib/taxonomy';
import { LangSwitch, LangSwitchFallback } from './LangSwitch';
import { Wordmark } from './Wordmark';

export async function SiteHeader({ locale }: { locale: Locale }) {
  const t = await getTranslations({ locale, namespace: 'Site' });
  return (
    <header className="mx-auto flex h-14 max-w-4xl items-center justify-between gap-3 px-4">
      <Link href="/" aria-label={t('name')} className="rounded-sm">
        <Wordmark locale={locale} name={t('name')} />
      </Link>
      <div className="flex items-center gap-2">
        <Suspense fallback={<LangSwitchFallback label={t('langSwitch')} />}>
          <LangSwitch label={t('langSwitch')} />
        </Suspense>
        <Link href="/subscribe" className="hidden h-9 items-center rounded-full border border-rule px-3.5 text-sm sm:inline-flex">
          {t('subscribe')}
        </Link>
      </div>
    </header>
  );
}
