import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import type { Locale } from '@/lib/taxonomy';

export type LinkProblemKind = 'invalid' | 'expired' | 'unavailable';

/**
 * What a token page (/prefs, /unsubscribe) shows when its link can't be used. The wording is the
 * same whether the row is missing or the signature is wrong, so a link never reveals who subscribed.
 * On /unsubscribe (`context="unsubscribe"`) the visitor wants out, not back in: no "Subscribe
 * again", and a hint at the other ways to stop the emails instead.
 */
export async function LinkProblem({
  locale,
  kind,
  context = 'prefs',
}: {
  locale: Locale;
  kind: LinkProblemKind;
  context?: 'prefs' | 'unsubscribe';
}) {
  const t = await getTranslations({ locale, namespace: 'Newsletter' });
  const leaving = context === 'unsubscribe';
  return (
    <div className="mt-6 rounded-card border border-rule p-5">
      <p>{t(leaving && kind === 'unavailable' ? 'link.unsubscribeUnavailable' : `link.${kind}`)}</p>
      {leaving && <p className="mt-3 text-sm text-muted">{t('link.unsubscribeHint')}</p>}
      <ul className="mt-5 flex flex-wrap gap-3 text-sm">
        {!leaving && kind !== 'unavailable' && (
          <li>
            <Link href="/subscribe" className="inline-flex h-11 items-center justify-center rounded-full bg-ink px-6 text-sm text-paper">
              {t('link.subscribeAgain')}
            </Link>
          </li>
        )}
        <li>
          <Link href="/" className="inline-flex h-11 items-center rounded-full border border-rule px-5 text-sm">
            {t('link.home')}
          </Link>
        </li>
      </ul>
    </div>
  );
}
