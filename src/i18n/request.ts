import { hasLocale } from 'next-intl';
import { getRequestConfig } from 'next-intl/server';
import * as rootParams from 'next/root-params';
import { routing } from './routing';

// Next 16.3: locale comes from the [locale] root param. Route Handlers and Server
// Actions cannot read root params, so they must pass `locale` explicitly
// (e.g. getTranslations({ locale, namespace })).
export default getRequestConfig(async ({ locale: explicit }) => {
  let locale = explicit;
  if (!locale) {
    const param = await rootParams.locale().catch(() => undefined);
    locale = hasLocale(routing.locales, param) ? param : routing.defaultLocale;
  }
  return {
    locale,
    messages: (await import(`../../messages/${locale}.json`)).default,
    timeZone: 'America/Los_Angeles',
  };
});
