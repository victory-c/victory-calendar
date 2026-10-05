import { describe, expect, it } from 'vitest';
import { coverage, LATE_LIMIT_MS, monthStartPT, sendAfterFor, upcomingIssueWeek } from '@/lib/digest/week';
import { parseVariantKey, variantKey } from '@/lib/digest/variant';
import { linksFor } from '@/lib/subscribers/links';

describe('sendAfterFor: the Sunday before the covered week, 17:00 Pacific', () => {
  it.each([
    ['2026-W42', '2026-10-12T00:00:00.000Z'], // Sun Oct 11, PDT
    ['2026-W45', '2026-11-02T01:00:00.000Z'], // Sun Nov 1, the day DST ends
    ['2026-W53', '2026-12-28T01:00:00.000Z'], // 2026 has a week 53
    ['2027-W01', '2027-01-04T01:00:00.000Z'],
    ['2027-W10', '2027-03-08T01:00:00.000Z'], // PST
    ['2027-W11', '2027-03-15T00:00:00.000Z'], // Sun Mar 14, the day DST starts
  ])('%s → %s', (week, iso) => {
    expect(sendAfterFor(week).toISOString()).toBe(iso);
  });

  it('rejects impossible weeks', () => {
    expect(() => sendAfterFor('2027-W53')).toThrow();
    expect(() => sendAfterFor('nope')).toThrow();
  });
});

describe('coverage', () => {
  it('Monday 00:00 PT to the next Monday, with the following week as preview', () => {
    expect(coverage('2026-W42')).toEqual({
      from: new Date('2026-10-12T07:00:00.000Z'),
      to: new Date('2026-10-19T07:00:00.000Z'),
      previewTo: new Date('2026-10-26T07:00:00.000Z'),
      previewWeek: '2026-W43',
    });
  });

  it('DST weeks are 169 and 167 hours long, never a fixed 7 × 24', () => {
    const fall = coverage('2026-W44'); // contains Sun Nov 1
    expect((fall.to.getTime() - fall.from.getTime()) / 3600e3).toBe(169);
    const spring = coverage('2027-W10'); // contains Sun Mar 14
    expect((spring.to.getTime() - spring.from.getTime()) / 3600e3).toBe(167);
  });

  it('every issue is sent before its week starts', () => {
    for (const w of ['2026-W42', '2026-W45', '2026-W53', '2027-W11']) {
      expect(sendAfterFor(w).getTime()).toBeLessThan(coverage(w).from.getTime());
    }
  });
});

describe('upcomingIssueWeek', () => {
  it.each([
    ['2026-10-04T19:00:00Z', '2026-W41'], // Sunday noon PT → tomorrow's week
    ['2026-10-05T06:59:00Z', '2026-W41'], // still Sunday 23:59 PT
    ['2026-10-05T07:00:00Z', '2026-W42'], // Monday 00:00 PT → the coming Monday's week
    ['2026-10-10T20:00:00Z', '2026-W42'], // Saturday
    ['2026-12-27T20:00:00Z', '2026-W53'],
  ])('%s → %s', (now, week) => {
    expect(upcomingIssueWeek(new Date(now))).toBe(week);
  });
});

describe('monthStartPT and the late limit', () => {
  it('first instant of the Pacific month', () => {
    expect(monthStartPT(new Date('2026-11-01T06:30:00Z')).toISOString()).toBe('2026-10-01T07:00:00.000Z'); // still Oct 31 in PT
    expect(monthStartPT(new Date('2026-11-15T12:00:00Z')).toISOString()).toBe('2026-11-01T07:00:00.000Z');
  });

  it('a Monday-evening PT run is still inside the window; Tuesday is not', () => {
    const sa = sendAfterFor('2026-W42').getTime();
    expect(new Date('2026-10-13T01:30:00Z').getTime() - sa).toBeLessThan(LATE_LIMIT_MS); // Mon 18:30 PDT
    expect(new Date('2026-10-14T01:30:00Z').getTime() - sa).toBeGreaterThan(LATE_LIMIT_MS);
  });
});

describe('variant keys', () => {
  it('locale plus sorted, de-duplicated, known slugs', () => {
    expect(variantKey('zh', ['social', 'ai', 'ai', 'nope'])).toBe('zh:ai,social');
    expect(variantKey('en', [])).toBe('en:');
  });

  it('parse gives taxonomy order for sections and round-trips', () => {
    const v = parseVariantKey('en:social,ai,hackathon')!;
    expect(v.categories).toEqual(['ai', 'hackathon', 'social']);
    expect(v.key).toBe('en:ai,hackathon,social');
    expect(parseVariantKey(v.key)).toEqual(v);
    expect(parseVariantKey('fr:ai')).toBeNull();
    expect(parseVariantKey('en:')).toBeNull();
  });
});

describe('linksFor', () => {
  it('builds every link from any token, with the zh prefix where pages are localised', () => {
    expect(linksFor('zh', '__VP_TOKEN__', 'https://picks.example.com')).toEqual({
      confirm: 'https://picks.example.com/zh/confirm/__VP_TOKEN__',
      prefs: 'https://picks.example.com/zh/prefs/__VP_TOKEN__',
      unsubscribe: 'https://picks.example.com/zh/unsubscribe?t=__VP_TOKEN__',
      oneClick: 'https://picks.example.com/api/unsubscribe?t=__VP_TOKEN__',
    });
  });
});
