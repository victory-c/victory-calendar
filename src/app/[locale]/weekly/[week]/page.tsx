import type { Metadata } from 'next';
import { getLocale, getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { DigestArchive } from '@/components/DigestArchive';
import { PageShell } from '@/components/PageShell';
import { archiveView, weekDate } from '@/lib/digest/archive';
import { getArchiveIssue, listSentIssues } from '@/lib/digest/archive-queries';
import { clip, introLines } from '@/lib/digest/fields';
import { isoWeekBounds } from '@/lib/format/calendar';
import { pageMeta } from '@/lib/seo';
import type { Locale } from '@/lib/taxonomy';

// One digest issue's public archive (/weekly/2026-W42; the emails' "view in browser" link). Public
// from the moment the issue starts sending (DESIGN D7); drafts, scheduled or missed issues and
// malformed weeks are 404. Cache Components needs at least one param at build time: with no sent
// issue yet the placeholder fails the ISO-week check and answers 404 without a query.
export async function generateStaticParams() {
  const weeks = (await listSentIssues()).slice(0, 12).map((i) => i.isoWeek);
  return weeks.length ? weeks.map((week) => ({ week })) : [{ week: '__placeholder__' }];
}

const issueFor = (week: string) => (isoWeekBounds(week) ? getArchiveIssue(week) : null);

export async function generateMetadata({ params }: PageProps<'/[locale]/weekly/[week]'>): Promise<Metadata> {
  const { week } = await params;
  const locale = (await getLocale()) as Locale;
  const issue = await issueFor(week);
  if (!issue) return {};
  const t = await getTranslations({ locale, namespace: 'Weekly' });
  const date = weekDate(week, locale);
  const first = introLines(issue.snap, locale)[0];
  return pageMeta({
    path: `/weekly/${week}`,
    locale,
    title: t('issueTitle', { date }),
    description: first ? clip(first, 155) : t('description', { date }),
  });
}

// Lookup happens outside any Suspense boundary so an unknown or unsent week can still answer 404.
export default async function WeeklyIssuePage({ params }: PageProps<'/[locale]/weekly/[week]'>) {
  const { week } = await params;
  const locale = (await getLocale()) as Locale;
  const issue = await issueFor(week);
  if (!issue) notFound();
  return (
    <PageShell locale={locale} path={`/weekly/${week}`}>
      <DigestArchive view={archiveView(issue, locale)} locale={locale} />
    </PageShell>
  );
}
