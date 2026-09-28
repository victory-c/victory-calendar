import { parseCategories, type Category } from '../taxonomy';
import type { PublicEvent } from './types';

// Facets (PRD §7): site-only filters in P0; subscriptions stay category-only until P1.
export type Filters = {
  cats: Category[];
  lang: 'zh' | 'bilingual' | null; // event language
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
    lang: lang === 'zh' || lang === 'bilingual' ? lang : null,
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
      (!f.lang || e.eventLanguage === f.lang || (f.lang === 'zh' && e.eventLanguage === 'bilingual')) &&
      (!f.fmt || (f.fmt === 'online' ? e.format !== 'in_person' : e.format !== 'online')) &&
      (!f.region || e.region === f.region) &&
      (!f.free || isFree(e)),
  );
}

export const hasFacet = (f: Filters) => Boolean(f.lang || f.fmt || f.region || f.free);
