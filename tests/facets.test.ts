import { describe, expect, it } from 'vitest';
import {
  evLangOf, facetColumns, facetParams, facetsFromParams, facetsOf, hasFacets, isOnlineish, langMatches, langOf, matchesFacets, NO_FACETS,
} from '@/lib/events/facets';

// F19 facets (events/facets.ts): the one rule the site filters, the ICS feed and the digest share.

describe('langMatches', () => {
  // Preference → which event languages pass (undefined = a pre-F19 digest event, read as 'en').
  const MATRIX: [pref: 'en' | 'zh' | 'bilingual' | null, en: boolean, zh: boolean, bilingual: boolean, missing: boolean][] = [
    [null, true, true, true, true],
    ['zh', false, true, true, false],
    ['en', true, false, true, true],
    ['bilingual', false, false, true, false],
  ];
  it.each(MATRIX)('pref %s', (pref, en, zh, bilingual, missing) => {
    expect([langMatches('en', pref), langMatches('zh', pref), langMatches('bilingual', pref), langMatches(undefined, pref)]).toEqual([
      en, zh, bilingual, missing,
    ]);
  });

  it('an unknown event language counts as English', () => {
    expect(langOf('fr')).toBe('en');
    expect(langOf(undefined)).toBe('en');
    expect(langMatches('fr', 'en')).toBe(true);
    expect(langMatches('fr', 'zh')).toBe(false);
  });
});

describe('online and the combined rule', () => {
  it('online keeps online and hybrid', () => {
    expect([isOnlineish('online'), isOnlineish('hybrid'), isOnlineish('in_person')]).toEqual([true, true, false]);
  });

  it('language AND online', () => {
    const f = { evLang: 'zh' as const, onlineOnly: true };
    expect(matchesFacets({ eventLanguage: 'zh', format: 'hybrid' }, f)).toBe(true);
    expect(matchesFacets({ eventLanguage: 'zh', format: 'in_person' }, f)).toBe(false);
    expect(matchesFacets({ eventLanguage: 'en', format: 'online' }, f)).toBe(false);
    expect(matchesFacets({ format: 'in_person' }, NO_FACETS)).toBe(true);
    expect([hasFacets(NO_FACETS), hasFacets(f), hasFacets({ evLang: null, onlineOnly: true })]).toEqual([false, true, true]);
  });
});

describe('stored shape', () => {
  it('ev_lang_pref: exactly one known value, anything else is no preference', () => {
    expect(evLangOf(['zh'])).toBe('zh');
    expect(evLangOf(['bilingual'])).toBe('bilingual');
    for (const odd of [null, undefined, [], ['xx'], ['en', 'zh'], [null], [1], ['ZH']]) expect(evLangOf(odd as never), String(odd)).toBeNull();
  });

  it('round trip through the columns: NULL when off', () => {
    expect(facetColumns(NO_FACETS)).toEqual({ evLangPref: null, onlineOnly: null });
    expect(facetColumns({ evLang: 'en', onlineOnly: true })).toEqual({ evLangPref: ['en'], onlineOnly: true });
    expect(facetsOf({ evLangPref: ['en'], onlineOnly: true })).toEqual({ evLang: 'en', onlineOnly: true });
    expect(facetsOf({ evLangPref: ['en', 'zh'], onlineOnly: false })).toEqual(NO_FACETS);
    expect(facetsOf({ evLangPref: null, onlineOnly: null })).toEqual(NO_FACETS);
  });
});

describe('URL params', () => {
  it('ev_lang and online=1; unknown values are ignored', () => {
    expect(facetsFromParams(new URLSearchParams('ev_lang=zh&online=1'))).toEqual({ evLang: 'zh', onlineOnly: true });
    expect(facetsFromParams(new URLSearchParams('ev_lang=bilingual'))).toEqual({ evLang: 'bilingual', onlineOnly: false });
    expect(facetsFromParams(new URLSearchParams('ev_lang=fr&online=yes'))).toEqual(NO_FACETS);
    expect(facetsFromParams(new URLSearchParams('lang=zh'))).toEqual(NO_FACETS); // the feed's own language, not a facet
    expect(facetsFromParams({ ev_lang: ['en', 'zh'], online: '1' })).toEqual({ evLang: 'en', onlineOnly: true });
    expect(facetsFromParams({})).toEqual(NO_FACETS);
  });

  it('written in a fixed order, nothing for no facets', () => {
    expect(facetParams({ evLang: 'zh', onlineOnly: true })).toEqual([['ev_lang', 'zh'], ['online', '1']]);
    expect(facetParams({ evLang: null, onlineOnly: true })).toEqual([['online', '1']]);
    expect(facetParams(NO_FACETS)).toEqual([]);
  });
});
