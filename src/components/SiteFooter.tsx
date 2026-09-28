import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import type { Locale } from '@/lib/taxonomy';

export async function SiteFooter({ locale }: { locale: Locale }) {
  const t = await getTranslations({ locale, namespace: 'Site' });
  const feed = locale === 'zh' ? '/zh/feed.xml' : '/feed.xml';
  const ics = locale === 'zh' ? '/calendar.ics?lang=zh' : '/calendar.ics';
  return (
    <footer className="mx-auto mt-16 max-w-4xl border-t border-rule px-4 py-8 text-sm text-muted">
      <nav aria-label={t('nav')} className="flex flex-wrap gap-x-5 gap-y-2">
        <Link href="/about">{t('about')}</Link>
        <a href={feed}>{t('rss')}</a>
        <a href={ics}>{t('ical')}</a>
      </nav>
      <p className="mt-4">{t('noPaid')}</p>
    </footer>
  );
}
