import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { feedUrl, googleSubscribe, outlookSubscribe, targetOrder, webcal } from '@/lib/calendar-links';
import { publicOrigin } from '@/lib/host';
import { calendarName } from '@/lib/ics';
import { newsletterStatus } from '@/lib/newsletter/status';
import type { Category, Locale } from '@/lib/taxonomy';

/**
 * PRD F05: one-click calendar subscriptions for the current chip selection (or going.ics).
 * A <details> menu — zero JS. zh puts Google last (unreachable from mainland China).
 * While the newsletter is open, the same selection also links to /subscribe?c= (guide: one chip
 * selection feeds both the ICS link and the email form). Not for going.ics: no going emails yet.
 */
export async function SubscribeMenu({ locale, cats = [], going = false }: { locale: Locale; cats?: Category[]; going?: boolean }) {
  const t = await getTranslations({ locale, namespace: 'Subscribe' });
  const https = feedUrl(publicOrigin(), { cats, locale, going });
  const name = calendarName(locale, cats, going);
  const links = {
    apple: { href: webcal(https), label: t('apple') },
    google: { href: googleSubscribe(https), label: t('google') },
    outlook: { href: outlookSubscribe(https, name), label: t('outlook') },
  } as const;
  const order = targetOrder(locale).filter((k): k is keyof typeof links => k in links);
  const label = going ? t('going') : cats.length ? t('these') : t('all');
  const email = !going && newsletterStatus() === 'open' ? await getTranslations({ locale, namespace: 'Newsletter' }) : null;
  return (
    <details id="subscribe" className="group relative mt-3 inline-block">
      <summary className="inline-flex h-11 cursor-pointer list-none items-center gap-2 rounded-full border border-rule px-5 text-sm md:h-9 [&::-webkit-details-marker]:hidden">
        <span aria-hidden>＋</span>
        {label}
        <span aria-hidden className="text-muted transition-transform group-open:rotate-180">▾</span>
      </summary>
      <div className="absolute left-0 z-20 mt-2 w-[min(22rem,calc(100vw-2rem))] rounded-card border border-rule bg-paper p-1.5 shadow-lg">
        <ul>
          {order.map((k) => (
            <li key={k}>
              <a
                href={links[k].href}
                {...(k === 'apple' ? {} : { target: '_blank', rel: 'noopener noreferrer' })}
                className="flex h-11 items-center rounded-lg px-3 text-sm hover:bg-rule/50"
              >
                {links[k].label}
              </a>
            </li>
          ))}
        </ul>
        {/* Outside the <ul>: e2e counts exactly the calendar targets in `#subscribe ul a`. */}
        {email && (
          <div className="mt-1.5 border-t border-rule pt-1.5">
            <Link
              href={cats.length ? `/subscribe?c=${cats.join(',')}` : '/subscribe'}
              className="flex h-11 items-center rounded-lg px-3 text-sm hover:bg-rule/50"
            >
              {email('title')}
            </Link>
          </div>
        )}
        <div className="border-t border-rule px-3 py-2">
          <p className="text-xs text-muted">{t('url')}</p>
          <input
            readOnly
            value={https}
            aria-label={t('url')}
            className="mt-1 h-9 w-full rounded-lg border border-rule bg-paper px-2 font-mono text-xs"
          />
          <p className="mt-1 text-xs text-muted">{t('urlHint')}</p>
          <p className="mt-2 text-xs text-muted">{t('refresh')}</p>
        </div>
      </div>
    </details>
  );
}
