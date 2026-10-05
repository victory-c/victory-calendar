import type { Metadata } from 'next';
import { getLocale, getTranslations } from 'next-intl/server';
import { connection } from 'next/server';
import { Suspense } from 'react';
import { LinkProblem } from '@/components/LinkProblem';
import { PageShell } from '@/components/PageShell';
import { PrefsForm } from '@/components/PrefsForm';
import { effectiveStatus, longDate, welcomeBanner } from '@/lib/newsletter/prefs-view';
import { linksWork } from '@/lib/newsletter/status';
import { type Subscriber, subscriberFromToken, viewOf } from '@/lib/subscribers/service';
import type { Locale } from '@/lib/taxonomy';
import { changePause, changeSubscription, type PrefsKey, savePreferences } from '../actions';

// Preference center, opened from a link in an email. No login: the HMAC token is the credential.
// Request-time only (no generateStaticParams, uncached reads after connection()); nothing changes
// on load, only on a button press, because mail scanners fetch every link.

type Props = {
  params: Promise<{ token: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata(): Promise<Metadata> {
  const locale = (await getLocale()) as Locale;
  const t = await getTranslations({ locale, namespace: 'Newsletter' });
  return { title: t('prefs.title'), robots: { index: false, follow: false }, referrer: 'no-referrer' };
}

export default async function PrefsPage({ params, searchParams }: Props) {
  const locale = (await getLocale()) as Locale;
  const t = await getTranslations({ locale, namespace: 'Newsletter' });
  return (
    // The shell is prerendered and shared: give it a token-free path.
    <PageShell locale={locale} path="/subscribe">
      <div className="max-w-prose pt-6 md:pt-10">
        <h1 className="text-h1">{t('prefs.title')}</h1>
        {/* Without JS the streamed content is never swapped in, so the fallback is all there is. */}
        <Suspense
          fallback={
            <>
              <noscript>
                <p className="mt-6">{t('noscript.links')}</p>
              </noscript>
              <div className="min-h-[60vh]" aria-busy="true" />
            </>
          }
        >
          <Prefs locale={locale} params={params} searchParams={searchParams} />
        </Suspense>
      </div>
    </PageShell>
  );
}

async function Prefs({ locale, params, searchParams }: Props & { locale: Locale }) {
  await connection();
  if (!linksWork()) return <LinkProblem locale={locale} kind="unavailable" />;
  const [{ token }, sp] = await Promise.all([params, searchParams]);
  let sub: Subscriber | null;
  try {
    sub = await subscriberFromToken(token);
  } catch (err) {
    console.error('[prefs] lookup failed', err instanceof Error ? err.name : 'error');
    return <LinkProblem locale={locale} kind="unavailable" />;
  }
  if (!sub) return <LinkProblem locale={locale} kind="invalid" />;

  const t = await getTranslations({ locale, namespace: 'Newsletter' });
  const view = viewOf(sub);
  // An expired pause shows as active (it already counts as active for the digest).
  const { status, pausedUntil } = effectiveStatus(view);
  const banner = welcomeBanner(sp.welcome, status);

  const line = {
    active: t('prefs.statusActive'),
    pending: t('prefs.statusPending'),
    paused: pausedUntil ? t('prefs.statusPaused', { date: longDate(pausedUntil, locale) }) : '',
    unsubscribed: t('prefs.statusUnsubscribed'),
    suppressed: t('prefs.statusSuppressed'),
  }[status];

  const messages: Record<PrefsKey, string> = {
    'prefs.saved': t('prefs.saved'),
    'prefs.unsubscribed': t('prefs.unsubscribed'),
    'prefs.paused': t('prefs.paused'),
    'prefs.resumed': t('prefs.resumed'),
    'prefs.resubscribed': t('prefs.resubscribed'),
    'prefs.resubscribePending': t('prefs.resubscribePending'),
    'prefs.linkExpired': t('prefs.linkExpired'),
    'prefs.statusSuppressed': t('prefs.statusSuppressed'),
    'link.unavailable': t('link.unavailable'),
    'state.error': t('state.error'),
  };

  return (
    <>
      {banner && (
        <p role="status" className="mt-6 rounded-card border border-rule px-4 py-3">
          {t(banner)}
        </p>
      )}
      {/* A live region: after any change the new status (e.g. the pause end date) is announced too. */}
      <p role="status" aria-live="polite" className="mt-4 text-muted">
        {line}
      </p>
      {status !== 'suppressed' && (
        <PrefsForm
          locale={locale}
          status={status}
          emailLocale={view.locale}
          categories={view.categories}
          actions={{
            save: savePreferences.bind(null, token),
            pause: changePause.bind(null, token),
            leave: changeSubscription.bind(null, token),
          }}
          text={{
            language: t('form.language'),
            en: t('form.en'),
            zh: t('form.zh'),
            categories: t('form.categories'),
            save: t('prefs.save'),
            saving: t('prefs.saving'),
            pauseTitle: t('prefs.pauseTitle'),
            pause: t('prefs.pause'),
            resume: t('prefs.resume'),
            leaveTitle: t('prefs.leaveTitle'),
            unsubscribeAll: t('prefs.unsubscribeAll'),
            resubscribe: t('prefs.resubscribe'),
          }}
          messages={messages}
        />
      )}
    </>
  );
}
