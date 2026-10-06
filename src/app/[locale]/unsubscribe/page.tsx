import type { Metadata } from 'next';
import { getLocale, getTranslations } from 'next-intl/server';
import { connection } from 'next/server';
import { Suspense } from 'react';
import { LinkProblem } from '@/components/LinkProblem';
import { PageShell } from '@/components/PageShell';
import { UnsubscribeButtons } from '@/components/UnsubscribeButtons';
import { Link } from '@/i18n/navigation';
import { goingChoice, isGoingList, unsubscribeChoices } from '@/lib/newsletter/prefs-view';
import { linksWork } from '@/lib/newsletter/status';
import { type Subscriber, subscriberFromToken, viewOf } from '@/lib/subscribers/service';
import { CATEGORIES, type Category, CATEGORY_SLUGS, type Locale } from '@/lib/taxonomy';
import { type UnsubscribeKey, unsubscribeFrom } from '../prefs/actions';

// Manual unsubscribe page (guide「退订」), linked visibly from every email; GET /api/unsubscribe
// redirects here. Loading it changes nothing (mail scanners fetch links and run scripts); only a
// button press does. The RFC 8058 one-click POST lives at /api/unsubscribe. From a going alert
// (F20, ?list=going) it offers turning off the alerts only, and still everything.

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export async function generateMetadata(): Promise<Metadata> {
  const locale = (await getLocale()) as Locale;
  const t = await getTranslations({ locale, namespace: 'Newsletter' });
  return { title: t('unsubscribe.title'), robots: { index: false, follow: false }, referrer: 'no-referrer' };
}

export default async function UnsubscribePage({ searchParams }: Props) {
  const locale = (await getLocale()) as Locale;
  const t = await getTranslations({ locale, namespace: 'Newsletter' });
  return (
    <PageShell locale={locale} path="/subscribe">
      <div className="max-w-prose pt-6 md:pt-10">
        <h1 className="text-h1">{t('unsubscribe.title')}</h1>
        {/* Without JS the streamed content is never swapped in, so the fallback is all there is. */}
        <Suspense
          fallback={
            <>
              <noscript>
                <p className="mt-6">{t('noscript.links')}</p>
              </noscript>
              <div className="min-h-[40vh]" aria-busy="true" />
            </>
          }
        >
          <Unsubscribe locale={locale} searchParams={searchParams} />
        </Suspense>
      </div>
    </PageShell>
  );
}

async function Unsubscribe({ locale, searchParams }: Props & { locale: Locale }) {
  await connection();
  if (!linksWork()) return <LinkProblem locale={locale} kind="unavailable" context="unsubscribe" />;
  const sp = await searchParams;
  const raw = sp.t;
  const token = typeof raw === 'string' ? raw : null;
  const fromAlert = isGoingList(sp.list);
  let sub: Subscriber | null;
  try {
    sub = token ? await subscriberFromToken(token) : null;
  } catch (err) {
    console.error('[unsubscribe] lookup failed', err instanceof Error ? err.name : 'error');
    return <LinkProblem locale={locale} kind="unavailable" context="unsubscribe" />;
  }
  if (!token || !sub) return <LinkProblem locale={locale} kind="invalid" context="unsubscribe" />;

  const t = await getTranslations({ locale, namespace: 'Newsletter' });
  const view = viewOf(sub);
  if (view.status === 'suppressed') return <p className="mt-6">{t('prefs.statusSuppressed')}</p>;

  const done = view.status === 'unsubscribed';
  const label = (c: Category) => CATEGORIES[c][locale];
  // Per-category buttons only with more than one category, and not from an alert (see unsubscribeChoices).
  const categories = unsubscribeChoices(view, fromAlert).map((c) => ({ slug: c, label: t('unsubscribe.category', { category: label(c) }) }));
  const going = goingChoice(view, fromAlert);
  const stopped = Object.fromEntries(CATEGORY_SLUGS.map((c) => [c, t('unsubscribe.stopped', { category: label(c) })])) as Record<Category, string>;
  const messages: Record<Exclude<UnsubscribeKey, 'unsubscribe.stopped'>, string> = {
    'unsubscribe.done': t('unsubscribe.done'),
    'unsubscribe.alertsOff': t('unsubscribe.alertsOff'),
    'prefs.linkExpired': t('prefs.linkExpired'),
    'prefs.statusSuppressed': t('prefs.statusSuppressed'),
    'link.unavailable': t('link.unavailable'),
    'state.error': t('state.error'),
  };

  return (
    <>
      {/* "Stop one category, or everything" only when there is a category to pick; from an alert, "alerts or everything". */}
      {going === 'offer' && <p className="mt-4 text-muted">{t('unsubscribe.goingLead')}</p>}
      {categories.length > 0 && <p className="mt-4 text-muted">{t('unsubscribe.lead')}</p>}
      <UnsubscribeButtons
        action={unsubscribeFrom.bind(null, token)}
        done={done}
        categories={categories}
        going={going}
        text={{
          all: t('unsubscribe.all'),
          done: t('unsubscribe.done'),
          stopped,
          going: t('unsubscribe.going'),
          alertsOff: t('unsubscribe.alertsOff'),
        }}
        messages={messages}
      />
      {/* Pause, language, and (once unsubscribed) "Subscribe again" live in the preference center. */}
      <p className="mt-8 text-sm">
        <Link href={`/prefs/${token}`} prefetch={false} className="inline-flex min-h-11 items-center underline underline-offset-4">
          {t('unsubscribe.more')}
        </Link>
      </p>
    </>
  );
}
