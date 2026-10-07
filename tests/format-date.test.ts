import { describe, expect, it } from 'vitest';
import {
  allDayLastDay,
  dayKey,
  fmtAllDay,
  fmtBeijing,
  fmtDateBadge,
  fmtDayHeader,
  fmtDuration,
  fmtLongDate,
  fmtRange,
  fmtTime,
  isoWithOffset,
  fmtWhen,
  normalizeSpaces,
} from '@/lib/format/date';

// Wed 2026-10-07 18:30–20:00 PDT
const start = new Date('2026-10-08T01:30:00Z');
const end = new Date('2026-10-08T03:00:00Z');

describe('fmtRange', () => {
  it('renders the PRD F08 zh string', () => {
    expect(fmtRange(start, end, 'zh')).toBe('10月7日周三 18:30–20:00 北美太平洋时间');
  });
  it('renders the PRD en string', () => {
    // Pinned spacing: thin spaces (U+2009) around the dash, no-break space before PM.
    expect(fmtRange(start, end, 'en')).toBe('Wed, Oct 7 · 6:30\u2009–\u20098:00\u00a0PM PT');
  });
  it('shows only the start time when there is no end', () => {
    expect(fmtRange(start, null, 'zh')).toBe('10月7日周三 18:30 北美太平洋时间');
  });
  it('shows both ends of a multi-day event', () => {
    const hackStart = new Date('2026-10-02T16:00:00Z'); // Fri 9:00 PDT
    const hackEnd = new Date('2026-10-04T02:00:00Z'); // Sat 19:00 PDT
    expect(fmtRange(hackStart, hackEnd, 'en')).toBe('Fri, Oct 2 · 9:00\u00a0AM\u2009–\u2009Sat, Oct 3 · 7:00\u00a0PM PT');
    expect(fmtRange(hackStart, hackEnd, 'zh')).toBe('10月2日周五 9:00\u2009–\u200910月3日周六 19:00 北美太平洋时间');
  });
  it('handles PST after 2026-11-01', () => {
    expect(fmtRange(new Date('2026-11-05T02:30:00Z'), null, 'zh')).toBe('11月4日周三 18:30 北美太平洋时间');
  });
});

describe('normalizeSpaces', () => {
  it('maps every ICU variant to one form', () => {
    for (const v of ['6:30 – 8:00 PM', '6:30\u2009–\u20098:00\u202fPM', '6:30–8:00 PM'])
      expect(normalizeSpaces(v)).toBe('6:30\u2009–\u20098:00\u00a0PM');
    expect(normalizeSpaces('18:30 – 20:00', 'zh')).toBe('18:30–20:00');
  });
});

describe('helpers', () => {
  it('long date', () => {
    expect(fmtLongDate(start, 'zh')).toBe('2026年10月7日星期三');
    expect(fmtLongDate(start, 'en')).toBe('Wednesday, October 7, 2026');
  });
  it('day header, time badge, date badge', () => {
    expect(fmtDayHeader(start, 'zh')).toEqual({ date: '10月7日', weekday: '周三' });
    expect(fmtDayHeader(start, 'en')).toEqual({ date: 'Oct 7', weekday: 'Wed' });
    expect(fmtTime(start, 'zh')).toBe('18:30');
    expect(fmtTime(start, 'en')).toBe('6:30\u00a0PM');
    expect(fmtDateBadge(start, 'zh')).toEqual({ day: '07', weekday: '周三' });
  });
  it('duration', () => {
    expect(fmtDuration(start, end, 'en')).toBe('1.5h');
    expect(fmtDuration(start, end, 'zh')).toBe('1.5 小时');
    expect(fmtDuration(start, null, 'en')).toBeNull();
  });
  it('Beijing time is +15h during PDT and +16h during PST', () => {
    expect(fmtBeijing(start)).toBe('10月8日周四 9:30 北京时间');
    expect(fmtBeijing(new Date('2026-11-05T02:30:00Z'))).toBe('11月5日周四 10:30 北京时间');
  });
  it('dayKey groups by Pacific date, iso carries the offset', () => {
    expect(dayKey(start)).toBe('2026-10-07');
    expect(isoWithOffset(start)).toBe('2026-10-07T18:30-07:00');
    expect(isoWithOffset(new Date('2026-11-05T02:30:00Z'))).toBe('2026-11-04T18:30-08:00');
  });
});

// All-day events (PRD, digest): the stored end is exclusive, the midnight after the last day, as
// in ICS. No clock time and no zone label: a day is shown, never "12:00 AM PT".
describe('all-day events', () => {
  const day1 = new Date('2026-10-14T07:00:00Z'); // Wed Oct 14 00:00 PDT
  const after3 = new Date('2026-10-17T07:00:00Z'); // Sat Oct 17 00:00 PDT: Oct 14–16 inclusive
  const lastAt2359 = new Date('2026-10-17T06:59:00Z'); // Fri Oct 16 23:59 PDT, typed by hand

  it('allDayLastDay: no end, or an end at the next midnight, is a single day', () => {
    expect(allDayLastDay(day1, null)).toBeNull();
    expect(allDayLastDay(day1, new Date('2026-10-15T07:00:00Z'))).toBeNull();
  });
  it('allDayLastDay: the last day is the one just before an exclusive end, or the 23:59 day', () => {
    expect(dayKey(allDayLastDay(day1, after3)!)).toBe('2026-10-16');
    expect(dayKey(allDayLastDay(day1, lastAt2359)!)).toBe('2026-10-16');
  });
  it('fmtAllDay: one day says the day and 全天 / All day, never a clock time', () => {
    expect(fmtAllDay(day1, null, 'en')).toBe('Wed, Oct 14 · All day');
    expect(fmtAllDay(day1, null, 'zh')).toBe('10月14日周三 · 全天');
  });
  it('fmtAllDay: several days give the first and the last day, the same as the digest', () => {
    expect(fmtAllDay(day1, after3, 'en')).toBe('All day · Wed, Oct 14\u2009–\u2009Fri, Oct 16');
    expect(fmtAllDay(day1, after3, 'zh')).toBe('全天 · 10月14日周三–10月16日周五');
    expect(fmtAllDay(day1, lastAt2359, 'en')).toBe('All day · Wed, Oct 14\u2009–\u2009Fri, Oct 16');
  });
  it('fmtWhen: all-day events get their day(s), timed events their Pacific range', () => {
    expect(fmtWhen({ startAt: day1, endAt: after3, allDay: true }, 'en')).toBe(fmtAllDay(day1, after3, 'en'));
    expect(fmtWhen({ startAt: start, endAt: end, allDay: false }, 'zh')).toBe('10月7日周三 18:30–20:00 北美太平洋时间');
  });
});
