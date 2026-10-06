// F19 facets (PRD F19, guide「日历订阅」「偏好中心」): event language and online-only, one rule for
// the site filters, the ICS feed and the weekly email. Pure and dependency-free, so client code,
// route handlers and the digest all import the same predicate (and the claim SQL in
// digest/claim.ts mirrors it; a test checks the two agree).
//
//   language pref  none → every event · zh → zh + bilingual · en → en + bilingual · bilingual → bilingual
//   online only    format online or hybrid (a hybrid event can be joined from home)
//
// Both AND with the category choice. Stored on subscribers as ev_lang_pref = NULL or a one-element
// array and online_only = true or NULL; any other stored shape counts as no preference.

export const EV_LANGS = ['en', 'zh', 'bilingual'] as const;
export type EvLang = (typeof EV_LANGS)[number];

export type Facets = {
  /** Event-language preference; null = any language. */
  evLang: EvLang | null;
  /** Only online and hybrid events. */
  onlineOnly: boolean;
};

export const NO_FACETS: Facets = Object.freeze({ evLang: null, onlineOnly: false });

export const isEvLang = (v: unknown): v is EvLang => typeof v === 'string' && (EV_LANGS as readonly string[]).includes(v);

/**
 * An event's language as the facets read it. Missing (a digest snapshot frozen before F19) or
 * unknown counts as 'en', the column default.
 */
export const langOf = (lang: unknown): EvLang => (isEvLang(lang) ? lang : 'en');

/** Whether an event in language `ev` passes the preference. A bilingual event passes every preference. */
export function langMatches(ev: unknown, pref: EvLang | null | undefined): boolean {
  if (!pref) return true;
  const l = langOf(ev);
  return l === pref || l === 'bilingual';
}

/** Online for the facet: anything not purely in person (so hybrid counts). */
export const isOnlineish = (format: unknown): boolean => format !== 'in_person';

export function matchesFacets(e: { eventLanguage?: unknown; format: unknown }, f: Facets): boolean {
  return langMatches(e.eventLanguage, f.evLang) && (!f.onlineOnly || isOnlineish(e.format));
}

export const hasFacets = (f: Facets): boolean => f.evLang !== null || f.onlineOnly;

/** The stored ev_lang_pref as a preference: exactly one known value, else none. */
export function evLangOf(raw: readonly unknown[] | null | undefined): EvLang | null {
  return Array.isArray(raw) && raw.length === 1 && isEvLang(raw[0]) ? raw[0] : null;
}

/** A subscriber row's facets (anything malformed reads as no preference). */
export function facetsOf(row: { evLangPref: readonly unknown[] | null; onlineOnly: boolean | null }): Facets {
  return { evLang: evLangOf(row.evLangPref), onlineOnly: row.onlineOnly === true };
}

/** The columns a facet choice is stored in: NULL when off, so "never set" and "cleared" look the same. */
export function facetColumns(f: Facets): { evLangPref: EvLang[] | null; onlineOnly: true | null } {
  return { evLangPref: f.evLang ? [f.evLang] : null, onlineOnly: f.onlineOnly ? true : null };
}

type Params = URLSearchParams | Record<string, string | string[] | undefined>;

/**
 * `?ev_lang=zh&online=1` (feed URLs, /subscribe links). Unknown values are ignored, the way unknown
 * category slugs are; a repeated param uses its first value.
 */
export function facetsFromParams(q: Params): Facets {
  const get = (k: string) => {
    if (q instanceof URLSearchParams) return q.get(k);
    const v = q[k];
    return (Array.isArray(v) ? v[0] : v) ?? null;
  };
  const lang = get('ev_lang');
  return { evLang: isEvLang(lang) ? lang : null, onlineOnly: get('online') === '1' };
}

/** The same choice as URL params, in a fixed order (ev_lang, online); nothing for no facets. */
export function facetParams(f: Facets): [string, string][] {
  const out: [string, string][] = [];
  if (f.evLang) out.push(['ev_lang', f.evLang]);
  if (f.onlineOnly) out.push(['online', '1']);
  return out;
}
