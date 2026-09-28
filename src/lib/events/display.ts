// Locale-aware field picking shared by cards, detail pages, emails and ICS.
import type { Locale } from '../taxonomy';
import type { PublicEvent } from './types';

/** Normalise for the "same title in both languages" check: drop spaces/punctuation, lowercase. */
export function normTitle(s: string) {
  return s.toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');
}

export function titles(e: Pick<PublicEvent, 'titleEn' | 'titleZh'>, locale: Locale) {
  const primary = locale === 'zh' ? e.titleZh || e.titleEn : e.titleEn || e.titleZh;
  const secondary = locale === 'zh' ? e.titleEn : e.titleZh;
  const showSecondary = Boolean(secondary) && normTitle(secondary) !== normTitle(primary);
  return {
    primary,
    primaryLang: (locale === 'zh' && e.titleZh ? 'zh-Hans' : 'en') as 'en' | 'zh-Hans',
    secondary: showSecondary ? secondary : null,
    secondaryLang: (locale === 'zh' ? 'en' : 'zh-Hans') as 'en' | 'zh-Hans',
  };
}

/** Victor's note in the page language, falling back to the other one (tagged with its lang). */
export function note(e: Pick<PublicEvent, 'noteEn' | 'noteZh'>, locale: Locale) {
  const want = locale === 'zh' ? e.noteZh : e.noteEn;
  if (want) return { text: want, lang: locale === 'zh' ? 'zh-Hans' : 'en' } as const;
  const other = locale === 'zh' ? e.noteEn : e.noteZh;
  return other ? ({ text: other, lang: locale === 'zh' ? 'en' : 'zh-Hans' } as const) : null;
}

export function place(e: Pick<PublicEvent, 'format' | 'city' | 'neighborhood'>) {
  if (e.format === 'online') return null; // rendered as the "Online" label instead
  return e.neighborhood || e.city;
}
