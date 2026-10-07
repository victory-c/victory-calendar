import { parseCategories, type Category } from '../taxonomy';
import { type EvLang, type Facets, isEvLang, isOnlineish, langMatches } from './facets';
import type { PublicEvent } from './types';

// Facets (PRD §7). Event language and online are also feed and email preferences since F19
// (facets.ts holds the one rule all three use); area, price and in-person stay site-only.
export type Filters = {
  cats: Category[];
  /** Event language: zh and en include bilingual events, bilingual is bilingual only (facets.ts). */
  lang: EvLang | null;
  fmt: 'online' | 'in_person' | null;
  region: NonNullable<PublicEvent['region']> | null;
  free: boolean;
};

const REGIONS = ['sf', 'east_bay', 'peninsula', 'south_bay', 'north_bay', 'online'] as const;

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (typeof v === 'string' ? v : undefined);

export function parseFilters(sp: SP): Filters {
  const lang = one(sp.lang);
  const fmt = one(sp.fmt);
  const region = one(sp.r);
  return {
    cats: parseCategories(one(sp.c)),
    lang: isEvLang(lang) ? lang : null,
    fmt: fmt === 'online' || fmt === 'in_person' ? fmt : null,
    region: (REGIONS as readonly string[]).includes(region ?? '') ? (region as Filters['region']) : null,
    free: one(sp.free) === '1',
  };
}

export const isFree = (e: Pick<PublicEvent, 'priceText'>) => /^(free|免费|\$0)$/i.test(e.priceText?.trim() ?? '');

export function applyFilters(events: PublicEvent[], f: Filters) {
  return events.filter(
    (e) =>
      (!f.cats.length || f.cats.includes(e.category)) &&
      langMatches(e.eventLanguage, f.lang) &&
      (!f.fmt || (f.fmt === 'online' ? isOnlineish(e.format) : e.format !== 'online')) &&
      (!f.region || e.region === f.region) &&
      (!f.free || isFree(e)),
  );
}

export const hasFacet = (f: Filters) => Boolean(f.lang || f.fmt || f.region || f.free);

/** The part of the site's filters a calendar feed or the email can carry (site `lang` → feed `ev_lang`). */
export const feedFacets = (f: Filters): Facets => ({ evLang: f.lang, onlineOnly: f.fmt === 'online' });

/** Filters a feed or email can't carry: area, free only, in person. */
export const hasSiteOnlyFilter = (f: Filters) => Boolean(f.region || f.free || f.fmt === 'in_person');
