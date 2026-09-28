import type { Metadata } from 'next';
import { hasLocale, NextIntlClientProvider } from 'next-intl';
import { getLocale, getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { locale as localeParam } from 'next/root-params';
import { htmlLang, routing, type AppLocale } from '@/i18n/routing';
import { NoteFontLoader } from '@/components/NoteFontLoader';
import { publicOrigin } from '@/lib/host';
import { fontVars } from '../fonts';
import '../globals.css';

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('Site');
  return {
    metadataBase: new URL(publicOrigin()),
    title: { default: t('name'), template: `%s · ${t('name')}` },
    description: t('tagline'),
  };
}

export default async function LocaleLayout({ children }: LayoutProps<'/[locale]'>) {
  // Only en and zh exist. Anything else in the first segment (/api, /.env, /fr) is a 404, never
  // a silent English fallback. (dynamicParams isn't available with Cache Components.)
  if (!hasLocale(routing.locales, await localeParam())) notFound();
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
        {locale === 'zh' && <NoteFontLoader href="/fonts/cjk-note.css" />}
      </body>
    </html>
  );
}
