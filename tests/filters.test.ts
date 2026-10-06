import { describe, expect, it } from 'vitest';
import { applyFilters, feedFacets, hasSiteOnlyFilter, parseFilters } from '@/lib/events/filters';
import { seedEvents } from '@/lib/events/seed';

const events = seedEvents(new Date('2026-09-28T12:00:00Z'));

describe('facet filters', () => {
  it('parses and ignores junk', () => {
    expect(parseFilters({ c: 'ai,bogus', lang: 'fr', fmt: 'online', r: 'mars', free: '1' })).toEqual({
      cats: ['ai'], lang: null, fmt: 'online', region: null, free: true,
    });
  });
  it('en includes bilingual events, bilingual is bilingual only (F19, same rule as feeds and email)', () => {
    expect(parseFilters({ lang: 'en' }).lang).toBe('en');
    const en = applyFilters(events, parseFilters({ lang: 'en' }));
    expect(en.length).toBeGreaterThan(0);
    expect(en.every((e) => e.eventLanguage === 'en' || e.eventLanguage === 'bilingual')).toBe(true);
    expect(en.some((e) => e.eventLanguage === 'bilingual')).toBe(true);
    expect(applyFilters(events, parseFilters({ lang: 'bilingual' })).map((e) => e.eventLanguage)).toEqual(['bilingual']);
  });
  it('feed facets: lang and fmt=online carry over; area, price and in person are site-only', () => {
    expect(feedFacets(parseFilters({ lang: 'zh', fmt: 'online' }))).toEqual({ evLang: 'zh', onlineOnly: true });
    expect(feedFacets(parseFilters({ fmt: 'in_person' }))).toEqual({ evLang: null, onlineOnly: false });
    expect(hasSiteOnlyFilter(parseFilters({ lang: 'zh', fmt: 'online' }))).toBe(false);
    for (const sp of [{ r: 'sf' }, { free: '1' }, { fmt: 'in_person' }]) expect(hasSiteOnlyFilter(parseFilters(sp)), JSON.stringify(sp)).toBe(true);
  });
  it('zh includes bilingual events', () => {
    const got = applyFilters(events, parseFilters({ lang: 'zh' }));
    expect(got.map((e) => e.eventLanguage).sort()).toEqual(['bilingual', 'zh', 'zh']);
  });
  it('online keeps online and hybrid, in-person drops online', () => {
    expect(applyFilters(events, parseFilters({ fmt: 'online' })).every((e) => e.format !== 'in_person')).toBe(true);
    expect(applyFilters(events, parseFilters({ fmt: 'in_person' })).some((e) => e.format === 'online')).toBe(false);
  });
  it('region, free and categories combine', () => {
    const got = applyFilters(events, parseFilters({ r: 'east_bay', free: '1', c: 'campus' }));
    expect(got.map((e) => e.slug).sort()).toEqual(['berkeley-founders-breakfast', 'scet-demo-day']);
  });
});
