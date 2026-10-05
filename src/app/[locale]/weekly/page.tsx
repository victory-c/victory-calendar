import type { Metadata } from 'next';
import { getLocale, getTranslations } from 'next-intl/server';
import { EmptyState } from '@/components/EmptyState';
import { PageShell } from '@/components/PageShell';
import { Link } from '@/i18n/navigation';
import { weekDate } from '@/lib/digest/archive';
import { listSentIssues } from '@/lib/digest/archive-queries';
import { clip, introLines } from '@/lib/digest/fields';
import { pageMeta } from '@/lib/seo';
import type { Locale } from '@/lib/taxonomy';

export async function generateMetadata(): Promise<Metadata> {
  const locale = (await getLocale()) as Locale;
  const t = await getTranslations({ locale, namespace: 'Weekly' });
  return pageMeta({ path: '/weekly', locale, title: t('title'), description: t('intro') });
}

// Every sent issue with events, newest first, each with the first line of its intro. Without a
// database (seed mode) or before the first send it is an empty state, never an error.
export default async function WeeklyIndexPage() {
  const locale = (await getLocale()) as Locale;
  const issues = await listSentIssues();
  const t = await getTranslations({ locale, namespace: 'Weekly' });
  const tw = await getTranslations({ locale, namespace: 'Week' });
  return (
    <PageShell locale={locale} path="/weekly">
      <h1 className="pt-6 text-h1 md:pt-10">{t('title')}</h1>
      <p className="mt-2 max-w-prose text-muted">{t('intro')}</p>
      {issues.length ? (
        <ul className="mt-8 divide-y divide-rule border-y border-rule">
          {issues.map((issue) => {
            const first = introLines(issue, locale)[0];
            return (
              <li key={issue.isoWeek} className="py-4">
                <Link href={`/weekly/${issue.isoWeek}`} className="title-link font-display text-h3">
                  {tw('title', { date: weekDate(issue.isoWeek, locale) })}
                </Link>
                {first && <p className="mt-1 line-clamp-2 max-w-prose text-sm text-muted">{clip(first, 200)}</p>}
              </li>
            );
          })}
        </ul>
      ) : (
        <EmptyState text={t('empty')} />
      )}
    </PageShell>
  );
}
