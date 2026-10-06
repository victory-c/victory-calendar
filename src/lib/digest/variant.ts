import { type EvLang, type Facets, isEvLang, NO_FACETS } from '../events/facets';
import { CATEGORY_SLUGS, type Category, isCategory, type Locale } from '../taxonomy';

// One digest variant per language × category set × F19 facets. The key is stored in
// digest_sends.variant_key; the claim SQL builds the same string (claim.ts), and a test checks
// that both agree for every subset and facet combination. Slugs sorted alphabetically ("collate C"
// in SQL). Facets are suffixes that only appear when set:
//
//   zh:ai,vc            no facets (every key written before F19 looks like this and still parses)
//   zh:ai,vc;l=zh;o     Chinese-or-bilingual events, online or hybrid only

export type Variant = { key: string; locale: Locale; categories: Category[] } & Facets;

export function variantKey(locale: Locale, categories: readonly string[], facets: Facets = NO_FACETS): string {
  const lang = isEvLang(facets.evLang) ? `;l=${facets.evLang}` : '';
  return `${locale}:${[...new Set(categories.filter(isCategory))].sort().join(',')}${lang}${facets.onlineOnly === true ? ';o' : ''}`;
}

export function parseVariantKey(key: string): Variant | null {
  const m = /^(en|zh):([a-z,]*)(?:;l=(en|zh|bilingual))?(;o)?$/.exec(key);
  if (!m) return null;
  const set = new Set(m[2].split(',').filter(isCategory));
  // Sections follow the taxonomy order, whatever order the key lists them in.
  const categories = CATEGORY_SLUGS.filter((c) => set.has(c));
  if (categories.length === 0) return null;
  const locale = m[1] as Locale;
  const facets: Facets = { evLang: (m[3] as EvLang | undefined) ?? null, onlineOnly: m[4] !== undefined };
  return { key: variantKey(locale, categories, facets), locale, categories, ...facets };
}
