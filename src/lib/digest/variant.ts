import { CATEGORY_SLUGS, type Category, isCategory, type Locale } from '../taxonomy';

// One digest variant per language × category set (guide: at most 2 × 127). The key is stored in
// digest_sends.variant_key; the claim SQL builds the same string (claim.ts), and a test checks
// that both agree for every subset. Slugs sorted alphabetically ("collate C" in SQL).

export type Variant = { key: string; locale: Locale; categories: Category[] };

export function variantKey(locale: Locale, categories: readonly string[]): string {
  return `${locale}:${[...new Set(categories.filter(isCategory))].sort().join(',')}`;
}

export function parseVariantKey(key: string): Variant | null {
  const m = /^(en|zh):([a-z,]*)$/.exec(key);
  if (!m) return null;
  const set = new Set(m[2].split(',').filter(isCategory));
  // Sections follow the taxonomy order, whatever order the key lists them in.
  const categories = CATEGORY_SLUGS.filter((c) => set.has(c));
  if (categories.length === 0) return null;
  return { key: variantKey(m[1] as Locale, categories), locale: m[1] as Locale, categories };
}
