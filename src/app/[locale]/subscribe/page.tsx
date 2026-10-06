import type { Metadata } from 'next';
import { getLocale, getTranslations } from 'next-intl/server';
import { connection } from 'next/server';
import { Suspense } from 'react';
import { PageShell } from '@/components/PageShell';
import { type SubscribeCopy, type SubscribeFacets, SubscribeForm } from '@/components/SubscribeForm';
import { SubscribeMenu } from '@/components/SubscribeMenu';
import { hasFacets } from '@/lib/events/facets';
import { newsletterStatus } from '@/lib/newsletter/status';
import { parseSubscribeParams } from '@/lib/newsletter/subscribe-state';
import { pageMeta } from '@/lib/seo';
import { CATEGORY_SLUGS, type Locale } from '@/lib/taxonomy';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export async function generateMetadata(): Promise<Metadata> {
  const locale = (await getLocale()) as Locale;
  const t = await getTranslations({ locale, namespace: 'Newsletter' });
  const meta = pageMeta({ path: '/subscribe', locale, title: t('title'), description: t('metaDescription') });
  // While closed the page is only a pointer to the calendar feeds: keep it out of search results.
  return newsletterStatus() === 'open' ? meta : { ...meta, robots: { index: false, follow: true } };
}

// Open or closed is read from env, so it is fixed per deployment and part of the static shell.
// Only the query (?c= prefill, ?ev_lang= / ?online= facets, ?link= notice) is read at request
// time, inside Suspense.
export default async function SubscribePage({ searchParams }: { searchParams: SearchParams }) {
  const locale = (await getLocale()) as Locale;
  const t = await getTranslations({ locale, namespace: 'Newsletter' });
  const open = newsletterStatus() === 'open';
  return (
    <PageShell locale={locale} path="/subscribe">
      <div className="max-w-prose pt-6 md:pt-10">
        <h1 className="text-h1">{t('title')}</h1>
        <p className="mt-2 text-muted">{t('lead')}</p>
      </div>
      {!open && (
        <div className="mt-8 max-w-prose">
          <h2 className="text-h2">{t('closed.title')}</h2>
          <p className="mt-2">{t('closed.body')}</p>
        </div>
      )}
      {/* Without JS the streamed form is never swapped in (and could not post anyway): say so. */}
      <Suspense
        fallback={
          <>
            {open ? (
              <noscript>
                <p className="mt-8 max-w-prose">{t('noscript.form')}</p>
              </noscript>
            ) : (
              // The zero-JS calendar menu, for visitors whose browser never swaps in the streamed one.
              // Inside <noscript> it is never parsed when scripts run, so id="subscribe" stays unique.
              <noscript>
                <SubscribeMenu locale={locale} />
              </noscript>
            )}
            <div className={open ? 'mt-8 min-h-[36rem] md:min-h-[26rem]' : 'min-h-14'} aria-busy="true" />
          </>
        }
      >
        <Body locale={locale} open={open} searchParams={searchParams} />
      </Suspense>
    </PageShell>
  );
}

async function Body({ locale, open, searchParams }: { locale: Locale; open: boolean; searchParams: SearchParams }) {
  await connection();
  const { cats, facets, link } = parseSubscribeParams(await searchParams);
  const t = await getTranslations({ locale, namespace: 'Newsletter' });
  const notice = link && (
    <p className="mt-6 max-w-prose rounded-card border border-rule px-4 py-3 text-sm text-seal-text">{t(link === 'expired' ? 'link.expired' : 'link.invalid')}</p>
  );
  if (!open) {
    return (
      <>
        {notice}
        {/* The only SubscribeMenu on this page, so id="subscribe" stays unique. Empty cats = all. */}
        <SubscribeMenu locale={locale} cats={cats} facets={facets} />
      </>
    );
  }
  const copy: SubscribeCopy = {
    email: t('form.email'),
    emailPlaceholder: t('form.emailPlaceholder'),
    categories: t('form.categories'),
    categoriesHint: t('form.categoriesHint'),
    language: t('form.language'),
    submit: t('form.submit'),
    submitting: t('form.submitting'),
    privacy: t('form.privacy'),
    privacyLink: t('form.privacyLink'),
    honeypot: t('form.honeypot'),
    pending: t('state.pending'),
    pendingHint: t('state.pendingHint'),
    again: t('link.subscribeAgain'),
    errors: {
      invalid_email: t('state.invalidEmail'),
      no_category: t('state.noCategory'),
      bot: t('state.bot'),
      server: t('state.error'),
      rate_limited: t('state.rateLimited'),
      closed: t('state.closed'),
      busy: t('state.busy'),
    },
  };
  // F19: facets from a feed menu's link; the form keeps them in hidden fields and says so in one line.
  // Both set read as one phrase ("online Chinese or bilingual events"): they AND, like the email's note.
  const lang = facets.evLang && t(`facets.${facets.evLang}`);
  const carried: SubscribeFacets | undefined = hasFacets(facets)
    ? {
        value: facets,
        summary: t('form.facets', {
          facets: !lang ? t('facets.online') : facets.onlineOnly ? t('facets.onlineOf', { events: lang }) : lang,
        }),
        remove: t('form.facetsRemove'),
        removed: t('form.facetsRemoved'),
      }
    : undefined;
  return (
    <>
      {notice}
      <SubscribeForm locale={locale} categories={cats.length ? cats : [...CATEGORY_SLUGS]} copy={copy} facets={carried} />
    </>
  );
}
