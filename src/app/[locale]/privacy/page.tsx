import type { Metadata } from 'next';
import { getLocale, getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { PageShell } from '@/components/PageShell';
import { privacyContact } from '@/lib/newsletter/status';
import { pageMeta } from '@/lib/seo';
import type { Locale } from '@/lib/taxonomy';

// Privacy (guide「隐私」, PRD F06). Every sentence describes what the code does today, so a change to
// what is collected, kept or shared changes this page and its date in the same commit. Static: the
// contact address (PRIVACY_CONTACT_EMAIL) is read at build time, so a new one takes a redeploy.

const UPDATED = '2026-10-06';

// Checked 2026-10-05. neon.com/privacy-policy redirects to the Databricks notice, which covers Neon.
const POLICIES = [
  ['vercel', 'Vercel', 'https://vercel.com/legal/privacy-policy'],
  ['neon', 'Neon', 'https://www.databricks.com/legal/privacynotice'],
  ['upstash', 'Upstash', 'https://upstash.com/trust/privacy'],
  ['resend', 'Resend', 'https://resend.com/legal/privacy-policy'],
] as const;

// Item keys per section, in reading order (messages: Privacy.<section>.items.<key>).
const ITEMS = {
  short: ['none', 'sell', 'email', 'leave'],
  browse: ['account', 'cookie', 'fonts', 'logs', 'links', 'feeds'],
  subscribe: ['email', 'consent', 'sends', 'nothing'],
  use: ['send', 'abuse', 'proof', 'nothing'],
  tracking: ['none', 'same', 'token'],
  retention: ['pending', 'active', 'unsubscribed', 'suppressed', 'limits', 'providers'],
  choices: ['prefs', 'request', 'suppressed', 'change'],
  takedown: ['keep', 'promise', 'limits', 'inbox'],
  scope: ['kids', 'where'],
} as const;

const LINK = 'underline underline-offset-2';

export async function generateMetadata(): Promise<Metadata> {
  const locale = (await getLocale()) as Locale;
  const t = await getTranslations({ locale, namespace: 'Privacy' });
  return pageMeta({ path: '/privacy', locale, title: t('title'), description: t('description') });
}

export default async function PrivacyPage() {
  const locale = (await getLocale()) as Locale;
  const t = await getTranslations({ locale, namespace: 'Privacy' });
  const contact = privacyContact();
  // Inline markup the messages may use. Later sections point back to the contact line by anchor,
  // so they read the same whether or not the address is set yet.
  const tags = {
    b: (c: ReactNode) => <strong className="font-semibold">{c}</strong>,
    code: (c: ReactNode) => <code className="font-mono text-[0.9em]">{c}</code>,
    contact: (c: ReactNode) => <a href="#who" className={LINK}>{c}</a>,
  };
  const list = (section: keyof typeof ITEMS) => (
    <ul className="mt-3 list-disc space-y-2 pl-5">
      {ITEMS[section].map((k) => (
        <li key={k}>{t.rich(`${section}.items.${k}`, tags)}</li>
      ))}
    </ul>
  );

  return (
    <PageShell locale={locale} path="/privacy">
      <article className="max-w-prose pt-6 pb-4 md:pt-10">
        <h1 className="text-h1">{t('title')}</h1>
        <p className="mt-2 text-sm text-muted">
          {t.rich('updated', { date: UPDATED, time: (c) => <time dateTime={UPDATED}>{c}</time> })}
        </p>
        <p className="mt-6">{t('lead')}</p>

        <Section id="who" title={t('who.title')}>
          <p className="mt-3">{t('who.body')}</p>
          <p className="mt-3">
            {contact
              ? t.rich('who.contact', { email: contact, mail: (c) => <a href={`mailto:${contact}`} className={`${LINK} break-all`}>{c}</a> })
              : t('who.noContact')}
          </p>
        </Section>

        <Section id="short" title={t('short.title')}>{list('short')}</Section>
        <Section id="browse" title={t('browse.title')}>{list('browse')}</Section>

        <Section id="subscribe" title={t('subscribe.title')}>
          <p className="mt-3">{t('subscribe.storeLead')}</p>
          {list('subscribe')}
          <p className="mt-4">{t('subscribe.bot')}</p>
          <p className="mt-4">{t('subscribe.limits')}</p>
        </Section>

        <Section id="use" title={t('use.title')}>
          {list('use')}
          <p className="mt-4">{t('use.ai')}</p>
        </Section>

        <Section id="tracking" title={t('tracking.title')}>{list('tracking')}</Section>

        <Section id="processors" title={t('processors.title')}>
          <p className="mt-3">{t('processors.lead')}</p>
          <ul className="mt-3 space-y-3">
            {POLICIES.map(([key, name, href]) => (
              <li key={key}>
                {t.rich(`processors.items.${key}`, tags)}{' '}
                {/* The policies are English-only pages. */}
                <a href={href} hrefLang="en" className={`${LINK} text-muted`}>
                  {t('processors.policy', { name })}
                </a>
              </li>
            ))}
          </ul>
          <p className="mt-4">{t('processors.where')}</p>
        </Section>

        <Section id="retention" title={t('retention.title')}>{list('retention')}</Section>
        <Section id="choices" title={t('choices.title')}>{list('choices')}</Section>

        <Section id="signals" title={t('signals.title')}>
          <p className="mt-3">{t('signals.body')}</p>
        </Section>

        <Section id="takedown" title={t('takedown.title')}>{list('takedown')}</Section>
        <Section id="scope" title={t('scope.title')}>{list('scope')}</Section>

        <Section id="changes" title={t('changes.title')}>
          <p className="mt-3">{t('changes.body')}</p>
        </Section>
      </article>
    </PageShell>
  );
}

/** One h2 per section; the id is the in-page anchor (#who is where the contact line lives). */
function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} className="mt-10 scroll-mt-6">
      <h2 className="text-h3">{title}</h2>
      {children}
    </section>
  );
}
