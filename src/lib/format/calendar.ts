// Calendar arithmetic on Pacific-time day keys ("YYYY-MM-DD"). Pure, tested.
import { dayKey, PT } from './date';
import type { Locale } from '../taxonomy';

const pad = (n: number) => String(n).padStart(2, '0');

export function keyToParts(key: string) {
  const [y, m, d] = key.split('-').map(Number);
  return { y, m, d };
}

/** Offset of `tz` from UTC in minutes at an instant (e.g. -420 for PDT). */
export function tzOffsetMinutes(instant: Date, tz = PT) {
  const name =
    new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'longOffset' })
      .formatToParts(instant)
      .find((p) => p.type === 'timeZoneName')?.value ?? 'GMT';
  const m = /GMT([+-])(\d{2}):(\d{2})/.exec(name);
  return m ? (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])) : 0;
}

/**
 * Wall-clock time in `tz` → instant. Never calls `new Date()` without arguments (Cache
 * Components rejects that during prerender), so it's safe in generateMetadata and static params.
 */
export function zonedInstant(y: number, mo: number, d: number, h = 0, mi = 0, tz = PT) {
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  const off1 = tzOffsetMinutes(new Date(guess), tz);
  const t1 = guess - off1 * 60_000;
  const off2 = tzOffsetMinutes(new Date(t1), tz);
  return new Date(off2 === off1 ? t1 : guess - off2 * 60_000);
}

/** Midnight PT of a day key (plus whole days), as an instant. */
export function startOfKey(key: string, addDays = 0) {
  const { y, m, d } = keyToParts(key);
  return zonedInstant(y, m, d + addDays);
}

export function addDaysKey(key: string, n: number) {
  const { y, m, d } = keyToParts(key);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

/** 0 = Sunday … 6 = Saturday for a day key (calendar date, tz-free). */
export const weekdayOf = (key: string) => {
  const { y, m, d } = keyToParts(key);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
};

export function parseMonth(v: string | undefined, todayKey: string) {
  if (v && /^20\d\d-(0[1-9]|1[0-2])$/.test(v)) return v; // 2000–2099 only
  return todayKey.slice(0, 7);
}

export function monthBounds(ym: string) {
  const [y, m] = ym.split('-').map(Number);
  const from = `${y}-${pad(m)}-01`;
  const next = m === 12 ? `${y + 1}-01-01` : `${y}-${pad(m + 1)}-01`;
  return { from, to: next };
}

export const shiftMonth = (ym: string, n: number) => {
  const [y, m] = ym.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}`;
};

/** First weekday by locale: en-US Sunday, zh-CN Monday (CLDR). */
export const weekStart = (locale: Locale) => (locale === 'zh' ? 1 : 0);

/** 6×7 (or 5×7) grid of day keys covering the month, starting on the locale's first weekday. */
export function monthGrid(ym: string, locale: Locale) {
  const { from, to } = monthBounds(ym);
  const lead = (weekdayOf(from) - weekStart(locale) + 7) % 7;
  let cur = addDaysKey(from, -lead);
  const weeks: string[][] = [];
  while (weeks.length < 6 && (weeks.length === 0 || cur < to)) {
    const w: string[] = [];
    for (let i = 0; i < 7; i++) {
      w.push(cur);
      cur = addDaysKey(cur, 1);
    }
    weeks.push(w);
  }
  return weeks;
}

/** Weekday column labels from Intl (PRD F04: never a hand-written table). */
export function weekdayLabels(locale: Locale) {
  const fmt = new Intl.DateTimeFormat(locale === 'zh' ? 'zh-CN' : 'en-US', { weekday: 'short', timeZone: 'UTC' });
  // 2026-09-27 is a Sunday.
  return Array.from({ length: 7 }, (_, i) => fmt.format(new Date(Date.UTC(2026, 8, 27 + ((i + weekStart(locale)) % 7)))));
}

export function monthTitle(ym: string, locale: Locale) {
  const [y, m] = ym.split('-').map(Number);
  return new Intl.DateTimeFormat(locale === 'zh' ? 'zh-CN' : 'en-US', { year: 'numeric', month: 'long', timeZone: 'UTC' }).format(
    new Date(Date.UTC(y, m - 1, 15)),
  );
}

// ---- ISO weeks (/week/2026-W41) ----
export function isoWeekOf(key: string) {
  const { y, m, d } = keyToParts(key);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const day = dt.getUTCDay() || 7;
  dt.setUTCDate(dt.getUTCDate() + 4 - day); // Thursday decides the year
  const year = dt.getUTCFullYear();
  const week = Math.ceil(((dt.getTime() - Date.UTC(year, 0, 1)) / 864e5 + 1) / 7);
  return `${year}-W${pad(week)}`;
}

export function isoWeekBounds(w: string) {
  const m = /^(\d{4})-W(\d{2})$/.exec(w);
  if (!m) return null;
  const [year, week] = [Number(m[1]), Number(m[2])];
  if (week < 1 || week > 53) return null;
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const monday = new Date(jan4.getTime() - ((jan4.getUTCDay() || 7) - 1) * 864e5 + (week - 1) * 7 * 864e5);
  const from = `${monday.getUTCFullYear()}-${pad(monday.getUTCMonth() + 1)}-${pad(monday.getUTCDate())}`;
  if (isoWeekOf(from) !== w) return null; // e.g. W53 in a 52-week year
  return { from, to: addDaysKey(from, 7) };
}

export const todayKeyPT = (now: Date) => dayKey(now, PT);
