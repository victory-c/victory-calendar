import { describe, expect, it } from 'vitest';
import {
  dayKey,
  fmtBeijing,
  fmtDateBadge,
  fmtDayHeader,
  fmtDuration,
  fmtLongDate,
  fmtRange,
  fmtTime,
  isoWithOffset,
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
  it('does not render a cross-day range as a same-day time range', () => {
    const multi = new Date('2026-10-10T03:00:00Z');
    expect(fmtRange(start, multi, 'en')).toBe('Wed, Oct 7 · 6:30\u00a0PM PT');
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
