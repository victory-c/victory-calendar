// Store UTC + IANA tz, render with Intl (guide「日期时间」). Never numeric-only dates.
// Text a person reads is always on the Pacific clock (PRD「日期格式」), so the display helpers
// take no zone: passing an event's own tz would show its local time next to the "PT" label.
// Only dayKey and isoWithOffset accept one (JSON-LD offsets, the editor's wall-time inputs).
import type { Locale } from '../taxonomy';

export const PT = 'America/Los_Angeles';
const tag = (locale: Locale) => (locale === 'zh' ? 'zh-CN' : 'en-US');
const hourCycle = (locale: Locale) => (locale === 'zh' ? 'h23' : 'h12');

// Note: the guide's snippet uses month:'numeric' for zh, but current ICU renders that as
// "10/7周三". month:'short' yields the PRD F08 acceptance string "10月7日周三".
function dayFmt(locale: Locale) {
  return new Intl.DateTimeFormat(tag(locale), { timeZone: PT, month: 'short', day: 'numeric', weekday: 'short' });
}
function timeFmt(locale: Locale) {
  return new Intl.DateTimeFormat(tag(locale), {
    timeZone: PT,
    hour: 'numeric',
    minute: '2-digit',
    hourCycle: hourCycle(locale),
  });
}

export const zoneLabel = (locale: Locale) => (locale === 'zh' ? '北美太平洋时间' : 'PT');

/**
 * ICU versions disagree on spacing (Node 22: "8:00\u202fPM", Node 26: "8:00 PM"; range dash
 * with or without thin spaces). Pin one form so server, email and ICS output never drift:
 * en: thin spaces around the range dash and a no-break space before AM/PM.
 * zh: a bare dash (18:30–20:00), as PRD F08 specifies.
 */
export function normalizeSpaces(s: string, locale: Locale = 'en') {
  if (locale === 'zh') return s.replace(/\s*[–-]\s*(?=\d)/g, '–');
  return s.replace(/\s*[–-]\s*(?=\d)/g, '\u2009–\u2009').replace(/[\s\u202f\u00a0]+(AM|PM)/g, '\u00a0$1');
}

/**
 * zh → 10月7日周三 18:30–20:00 北美太平洋时间 · en → Wed, Oct 7 · 6:30 – 8:00 PM PT
 * Multi-day: zh → 10月2日周五 9:00 – 10月3日周六 19:00 北美太平洋时间
 *            en → Fri, Oct 2 · 9:00 AM – Sat, Oct 3 · 7:00 PM PT
 */
export function fmtRange(start: Date, end: Date | null, locale: Locale) {
  const day = dayFmt(locale);
  const time = timeFmt(locale);
  const sep = locale === 'zh' ? ' ' : ' · ';
  const zone = zoneLabel(locale);
  if (end && dayKey(start) !== dayKey(end) && end > start) {
    const a = `${day.format(start)}${sep}${normalizeSpaces(time.format(start), locale)}`;
    const b = `${day.format(end)}${sep}${normalizeSpaces(time.format(end), locale)}`;
    return `${a}\u2009–\u2009${b} ${zone}`;
  }
  const range = normalizeSpaces(end ? time.formatRange(start, end) : time.format(start), locale);
  return `${day.format(start)}${sep}${range} ${zone}`;
}

/** Full date for headings: 2026年10月7日星期三 / Wednesday, October 7, 2026 */
export function fmtLongDate(d: Date, locale: Locale) {
  return new Intl.DateTimeFormat(tag(locale), {
    timeZone: PT,
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'long',
  }).format(d);
}

/** Day header parts: { date: "10月7日" | "Oct 7", weekday: "周三" | "Wed" } */
export function fmtDayHeader(d: Date, locale: Locale) {
  const date = new Intl.DateTimeFormat(tag(locale), { timeZone: PT, month: 'short', day: 'numeric' }).format(d);
  const weekday = new Intl.DateTimeFormat(tag(locale), { timeZone: PT, weekday: 'short' }).format(d);
  return { date, weekday };
}

/** TimeBadge: "18:30" (zh) / "6:30 PM" (en) */
export function fmtTime(d: Date, locale: Locale) {
  return normalizeSpaces(timeFmt(locale).format(d), locale);
}

/** DateBadge for ungrouped contexts: { day: "07", weekday: "周三" | "Wed" } */
export function fmtDateBadge(d: Date, locale: Locale) {
  const day = new Intl.DateTimeFormat('en-US', { timeZone: PT, day: '2-digit' }).format(d);
  const weekday = new Intl.DateTimeFormat(tag(locale), { timeZone: PT, weekday: 'short' }).format(d);
  return { day, weekday };
}

/** Duration under the TimeBadge: "1.5h", "3h", "2d"; null when unknown. */
export function fmtDuration(start: Date, end: Date | null, locale: Locale) {
  if (!end) return null;
  const mins = Math.round((end.getTime() - start.getTime()) / 60000);
  if (mins <= 0) return null;
  if (mins >= 24 * 60) {
    const days = Math.round(mins / (24 * 60));
    return locale === 'zh' ? `${days} 天` : `${days}d`;
  }
  const h = mins / 60;
  const hs = Number.isInteger(h) ? String(h) : h.toFixed(1).replace(/\.0$/, '');
  return locale === 'zh' ? `${hs} 小时` : `${hs}h`;
}

/** Beijing time line for online events on zh pages: 10月8日周四 9:30 北京时间 */
export function fmtBeijing(d: Date) {
  const s = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    month: 'short',
    day: 'numeric',
    weekday: 'short',
    hour: 'numeric',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(d);
  return `${s} 北京时间`;
}

/** YYYY-MM-DD of the instant in tz — used for day grouping. */
export function dayKey(d: Date, tz = PT) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

/** ISO 8601 with the tz offset for <time datetime>: 2026-10-07T18:30-07:00 */
export function isoWithOffset(d: Date, tz = PT) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
      timeZoneName: 'longOffset',
    })
      .formatToParts(d)
      .map((p) => [p.type, p.value]),
  );
  const off = parts.timeZoneName === 'GMT' ? '+00:00' : parts.timeZoneName.replace('GMT', '');
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}${off}`;
}

/** TimeBadge parts: zh { time: "18:30" }, en { time: "6:30", period: "PM" } */
export function fmtTimeParts(d: Date, locale: Locale) {
  const parts = timeFmt(locale).formatToParts(d);
  const period = parts.find((p) => p.type === 'dayPeriod')?.value ?? null;
  const time = parts
    .filter((p) => p.type === 'hour' || p.type === 'minute' || (p.type === 'literal' && p.value.includes(':')))
    .map((p) => p.value)
    .join('');
  return { time, period };
}
