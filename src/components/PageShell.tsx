import { getTranslations } from 'next-intl/server';
import { hasDatabase } from '@/lib/db';
import type { Locale } from '@/lib/taxonomy';
import { SampleBanner } from './SampleBanner';
import { SiteFooter } from './SiteFooter';
import { SiteHeader } from './SiteHeader';

/** Banner (only in seed mode) + header + main + footer, shared by every public page. */
export async function PageShell({ locale, children, wide }: { locale: Locale; children: React.ReactNode; wide?: boolean }) {
  const t = await getTranslations({ locale, namespace: 'Site' });
  return (
    <>
      {!hasDatabase() && <SampleBanner text={t('sample')} />}
      <SiteHeader locale={locale} />
      <main id="main" className={`mx-auto px-4 ${wide ? 'max-w-5xl' : 'max-w-4xl'}`}>
        {children}
      </main>
      <SiteFooter locale={locale} />
    </>
  );
}
