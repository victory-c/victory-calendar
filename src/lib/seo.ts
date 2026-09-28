import type { Metadata } from 'next';
import { publicOrigin } from './host';

type Locale = 'en' | 'zh';
const SITE = { en: "Victor's Picks", zh: 'Victor 精选' } as const;

function urls(path: string, query?: Record<string, string | undefined>) {
  const origin = publicOrigin();
  const p = path === '/' ? '' : path;
  const q = new URLSearchParams(Object.entries(query ?? {}).filter((e): e is [string, string] => Boolean(e[1])));
  const qs = q.size ? `?${q}` : '';
  return { origin, en: `${origin}${p || '/'}${qs}`, zh: `${origin}/zh${p}${qs}` };
}

/** hreflang en / zh-Hans / x-default for a locale-less path like "/events/x" (PRD §9). */
export function alternates(path: string, locale: Locale, query?: Record<string, string | undefined>): Metadata['alternates'] {
  const { origin, en, zh } = urls(path, query);
  return {
    canonical: locale === 'zh' ? zh : en,
    languages: { en, 'zh-Hans': zh, 'x-default': en },
    types: { 'application/rss+xml': `${origin}${locale === 'zh' ? '/zh' : ''}/feed.xml` },
  };
}

/**
 * Title, description, canonical + hreflang and share tags for one page. `query` keeps params
 * that change the content (e.g. ?m=2026-10 on month views) in the canonical URL.
 */
export function pageMeta(opts: {
  path: string;
  locale: Locale;
  title: string;
  description?: string;
  query?: Record<string, string | undefined>;
  /** Home: "Victor 精选 · 本周精选" instead of the "%s · site" template. */
  absolute?: boolean;
  images?: string[];
}): Metadata {
  const { path, locale, title, description, query, absolute, images } = opts;
  const { en, zh } = urls(path, query);
  const full = absolute ? `${SITE[locale]} · ${title}` : `${title} · ${SITE[locale]}`;
  return {
    title: absolute ? { absolute: full } : title,
    description,
    alternates: alternates(path, locale, query),
    openGraph: {
      title: full,
      description,
      url: locale === 'zh' ? zh : en,
      siteName: SITE[locale],
      locale: locale === 'zh' ? 'zh_CN' : 'en_US',
      alternateLocale: locale === 'zh' ? ['en_US'] : ['zh_CN'],
      type: 'website',
      ...(images?.length ? { images } : {}),
    },
    twitter: { card: images?.length ? 'summary_large_image' : 'summary', title: full, description },
  };
}

export const validMonth = (m: unknown) => (typeof m === 'string' && /^(20\d\d)-(0[1-9]|1[0-2])$/.test(m) ? m : undefined);
