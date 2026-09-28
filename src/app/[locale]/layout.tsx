import type { Metadata } from 'next';
import { NextIntlClientProvider } from 'next-intl';
import { getLocale, getTranslations } from 'next-intl/server';
import { htmlLang, routing, type AppLocale } from '@/i18n/routing';
import { fontVars } from '../fonts';
import '../globals.css';

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('Site');
  return {
    title: { default: t('name'), template: `%s · ${t('name')}` },
    description: t('tagline'),
  };
}

export default async function LocaleLayout({ children }: LayoutProps<'/[locale]'>) {
  const locale = (await getLocale()) as AppLocale;
  const skip = (await getTranslations({ locale, namespace: 'Site' }))('skip');
  return (
    <html lang={htmlLang(locale)} className={fontVars}>
      <body className="min-h-dvh">
        <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-full focus:bg-ink focus:px-4 focus:py-2 focus:text-paper">
          {skip}
        </a>
        {/* CJK slices only where Chinese is the page language; en pages fall back to system CJK. */}
        {locale === 'zh' && (
          // eslint-disable-next-line @next/next/no-css-tags -- static CJK slice index, see scripts/fonts-cjk.ts
          <link rel="stylesheet" href="/fonts/cjk.css" precedence="default" />
        )}
        <NextIntlClientProvider>{children}</NextIntlClientProvider>
        {/* Note font (LXGW WenKai): its 20 KB index CSS is hoisted after cjk.css; the woff2 slices use font-display: swap. */}
        {locale === 'zh' && (
          // eslint-disable-next-line @next/next/no-css-tags -- static CJK slice index, see scripts/fonts-cjk.ts
          <link rel="stylesheet" href="/fonts/cjk-note.css" precedence="low" />
        )}
      </body>
    </html>
  );
}
