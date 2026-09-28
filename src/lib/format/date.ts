// Store UTC + IANA tz, render with Intl (guide「日期时间」). Never numeric-only dates.
import type { Locale } from '../taxonomy';

export const PT = 'America/Los_Angeles';
const tag = (locale: Locale) => (locale === 'zh' ? 'zh-CN' : 'en-US');
const hourCycle = (locale: Locale) => (locale === 'zh' ? 'h23' : 'h12');

// Note: the guide's snippet uses month:'numeric' for zh, but current ICU renders that as
// "10/7周三". month:'short' yields the PRD F08 acceptance string "10月7日周三".
function dayFmt(locale: Locale, tz: string) {
  return new Intl.DateTimeFormat(tag(locale), { timeZone: tz, month: 'short', day: 'numeric', weekday: 'short' });
}
function timeFmt(locale: Locale, tz: string) {
  return new Intl.DateTimeFormat(tag(locale), {
    timeZone: tz,
    hour: 'numeric',
    minute: '2-digit',
    hourCycle: hourCycle(locale),
  });
}

export const zoneLabel = (locale: Locale) => (locale === 'zh' ? '北美太平洋时间' : 'PT');

/** zh → 10月7日周三 18:30–20:00 北美太平洋时间 · en → Wed, Oct 7 · 6:30 – 8:00 PM PT */
export function fmtRange(start: Date, end: Date | null, locale: Locale, tz = PT) {
  const day = dayFmt(locale, tz).format(start);
  const time = timeFmt(locale, tz);
  const sameDay = end && dayKey(start, tz) === dayKey(end, tz);
  const range = end && sameDay ? time.formatRange(start, end) : time.format(start);
  return locale === 'zh' ? `${day} ${range} ${zoneLabel(locale)}` : `${day} · ${range} ${zoneLabel(locale)}`;
}

/** Full date for headings: 2026年10月7日星期三 / Wednesday, October 7, 2026 */
export function fmtLongDate(d: Date, locale: Locale, tz = PT) {
  return new Intl.DateTimeFormat(tag(locale), {
    timeZone: tz,
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'long',
  }).format(d);
}

/** Day header parts: { date: "10月7日" | "Oct 7", weekday: "周三" | "Wed" } */
export function fmtDayHeader(d: Date, locale: Locale, tz = PT) {
  const date = new Intl.DateTimeFormat(tag(locale), { timeZone: tz, month: 'short', day: 'numeric' }).format(d);
  const weekday = new Intl.DateTimeFormat(tag(locale), { timeZone: tz, weekday: 'short' }).format(d);
  return { date, weekday };
}

/** TimeBadge: "18:30" (zh) / "6:30 PM" (en) */
export function fmtTime(d: Date, locale: Locale, tz = PT) {
  return timeFmt(locale, tz).format(d);
}

/** DateBadge for ungrouped contexts: { day: "07", weekday: "周三" | "Wed" } */
export function fmtDateBadge(d: Date, locale: Locale, tz = PT) {
  const day = new Intl.DateTimeFormat('en-US', { timeZone: tz, day: '2-digit' }).format(d);
  const weekday = new Intl.DateTimeFormat(tag(locale), { timeZone: tz, weekday: 'short' }).format(d);
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
