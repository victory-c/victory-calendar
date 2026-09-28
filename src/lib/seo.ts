import type { Metadata } from 'next';
import { publicOrigin } from './host';

/** hreflang en / zh-Hans / x-default for a locale-less path like "/events/x" (PRD §9). */
export function alternates(path: string, locale: 'en' | 'zh'): Metadata['alternates'] {
  const origin = publicOrigin();
  const p = path === '/' ? '' : path;
  const en = `${origin}${p || '/'}`;
  const zh = `${origin}/zh${p}`;
  return {
    canonical: locale === 'zh' ? zh : en,
    languages: { en, 'zh-Hans': zh, 'x-default': en },
    types: { 'application/rss+xml': `${origin}${locale === 'zh' ? '/zh' : ''}/feed.xml` },
  };
}
