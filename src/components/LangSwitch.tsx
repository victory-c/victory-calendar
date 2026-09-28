'use client';
import { useLocale } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { usePathname } from '@/i18n/navigation';

/**
 * "EN 丨 中" pill. Keeps the current path and query. A plain <a> (full navigation) on purpose:
 * switching the [locale] root param must re-render <html lang>, and the proxy sets the
 * NEXT_LOCALE cookie on /en/... and /zh/... requests, so the choice is remembered for a year.
 */
export function LangSwitch({ label }: { label: string }) {
  const pathname = usePathname();
  const search = useSearchParams()?.toString();
  return <Pill label={label} pathname={pathname} search={search} />;
}

export function LangSwitchFallback({ label }: { label: string }) {
  return <Pill label={label} pathname="/" />;
}

function Pill({ label, pathname, search }: { label: string; pathname: string; search?: string }) {
  const locale = useLocale();
  const rest = pathname === '/' ? '' : pathname;
  const q = search ? `?${search}` : '';
  const item = (l: 'en' | 'zh', text: string, lang: string) =>
    l === locale ? (
      <span aria-current="true" lang={lang} className="rounded-full bg-ink px-2.5 py-1 text-paper">
        {text}
      </span>
    ) : (
      <a href={`/${l}${rest}${q}`} lang={lang} hrefLang={l === 'zh' ? 'zh-Hans' : 'en'} className="rounded-full px-2.5 py-1 hover:bg-rule/60">
        {text}
      </a>
    );
  return (
    <nav aria-label={label} className="flex h-9 items-center rounded-full border border-rule p-0.5 font-mono text-xs">
      {item('en', 'EN', 'en')}
      {item('zh', '中', 'zh-Hans')}
    </nav>
  );
}
