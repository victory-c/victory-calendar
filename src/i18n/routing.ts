import { defineRouting } from 'next-intl/routing';

export const routing = defineRouting({
  locales: ['en', 'zh'],
  defaultLocale: 'en',
  localePrefix: 'as-needed',
  localeCookie: { maxAge: 60 * 60 * 24 * 365 }, // manual switch remembered for a year
  // hreflang must be en / zh-Hans / x-default (PRD §9); pages emit them via metadata instead.
  alternateLinks: false,
});

export type AppLocale = (typeof routing.locales)[number];

/** BCP 47 tag for <html lang> and hreflang (PRD §9: en / zh-Hans). */
export const htmlLang = (locale: AppLocale) => (locale === 'zh' ? 'zh-Hans' : 'en');
