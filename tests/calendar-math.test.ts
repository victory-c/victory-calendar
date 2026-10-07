import { describe, expect, it } from 'vitest';
import { allDayEndsAt, isoWeekBounds, isoWeekOf, monthBounds, monthGrid, monthTitle, shiftMonth, startOfKey, weekdayLabels } from '@/lib/format/calendar';

describe('month grid', () => {
  it('October 2026 starts Thursday; en weeks start Sunday, zh Monday', () => {
    const en = monthGrid('2026-10', 'en');
    const zh = monthGrid('2026-10', 'zh');
    expect(en[0][0]).toBe('2026-09-27');
    expect(zh[0][0]).toBe('2026-09-28');
    expect(en.flat()).toContain('2026-10-31');
    expect(en.every((w) => w.length === 7)).toBe(true);
  });
  it('weekday labels come from Intl', () => {
    expect(weekdayLabels('en')[0]).toBe('Sun');
    expect(weekdayLabels('zh')[0]).toBe('周一');
  });
  it('titles, bounds and shifting across years', () => {
    expect(monthTitle('2026-10', 'zh')).toBe('2026年10月');
    expect(monthTitle('2026-10', 'en')).toBe('October 2026');
    expect(monthBounds('2026-12')).toEqual({ from: '2026-12-01', to: '2027-01-01' });
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
    expect(shiftMonth('2027-01', -1)).toBe('2026-12');
  });
  it('midnight PT respects DST', () => {
    expect(startOfKey('2026-10-01').toISOString()).toBe('2026-10-01T07:00:00.000Z');
    expect(startOfKey('2026-11-02').toISOString()).toBe('2026-11-02T08:00:00.000Z');
  });
});

describe('ISO weeks', () => {
  it('round-trips and rejects impossible weeks', () => {
    expect(isoWeekOf('2026-10-07')).toBe('2026-W41');
    expect(isoWeekBounds('2026-W41')).toEqual({ from: '2026-10-05', to: '2026-10-12' });
    expect(isoWeekOf('2027-01-01')).toBe('2026-W53');
    expect(isoWeekBounds('2026-W53')).toEqual({ from: '2026-12-28', to: '2027-01-04' });
    expect(isoWeekBounds('2027-W53')).toBeNull();
    expect(isoWeekBounds('garbage')).toBeNull();
  });
});

describe('zonedInstant', () => {
  it('handles both DST transitions and day overflow', async () => {
    const { zonedInstant } = await import('@/lib/format/calendar');
    expect(zonedInstant(2026, 3, 8, 3, 0).toISOString()).toBe('2026-03-08T10:00:00.000Z');
    expect(zonedInstant(2026, 11, 1, 0, 0).toISOString()).toBe('2026-11-01T07:00:00.000Z');
    expect(zonedInstant(2026, 11, 1, 12, 0).toISOString()).toBe('2026-11-01T20:00:00.000Z');
    expect(zonedInstant(2026, 9, 28 + 13, 12, 0).toISOString()).toBe('2026-10-11T19:00:00.000Z');
  });
});

describe('allDayEndsAt', () => {
  it('is the midnight PT after the last day, across a DST change too', () => {
    // Sun Nov 1 2026 is 25 h long (PDT → PST): the next midnight is 08:00Z, not 07:00Z.
    expect(allDayEndsAt(new Date('2026-11-01T07:00:00Z'), null).toISOString()).toBe('2026-11-02T08:00:00.000Z');
    // Wed Oct 14 through Fri Oct 16 (exclusive end Oct 17): over at Sat Oct 17 00:00 PDT.
    expect(allDayEndsAt(new Date('2026-10-14T07:00:00Z'), new Date('2026-10-17T07:00:00Z')).toISOString()).toBe('2026-10-17T07:00:00.000Z');
  });
});
