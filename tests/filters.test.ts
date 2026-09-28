import { describe, expect, it } from 'vitest';
import { applyFilters, parseFilters } from '@/lib/events/filters';
import { seedEvents } from '@/lib/events/seed';

const events = seedEvents(new Date('2026-09-28T12:00:00Z'));

describe('facet filters', () => {
  it('parses and ignores junk', () => {
    expect(parseFilters({ c: 'ai,bogus', lang: 'fr', fmt: 'online', r: 'mars', free: '1' })).toEqual({
      cats: ['ai'], lang: null, fmt: 'online', region: null, free: true,
    });
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
