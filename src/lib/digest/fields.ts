import { dayKey, fmtDayHeader, fmtRange, PT } from '../format/date';
import type { Locale } from '../taxonomy';
import { COPY } from '@/emails/copy';
import type { DigestEvent, DigestSnapshot } from './types';

// Text pieces of one digest event, shared by the email template (src/emails/digest.tsx) and the
// WeChat text export (wechat.ts), so both say the same time, place, price and access the same way.

/**
 * Victor's note is meant to be 1–2 lines (the site clamps it to two). In the email a longer one is
 * cut at about three lines' worth and read in full on the event page; this also bounds the size.
 * The grey other-language title is supplementary and gets the same treatment.
 */
export const NOTE_MAX = { en: 180, 'zh-Hans': 80 } as const;
export const ALT_TITLE_MAX = { en: 120, 'zh-Hans': 60 } as const;

export function clip(text: string, max: number) {
  const t = text.trim().replace(/\s+/g, ' ');
  const chars = [...t];
  if (chars.length <= max) return t;
  const cut = chars.slice(0, max).join('');
  const space = cut.lastIndexOf(' ');
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s\p{P}]+$/u, '')}…`;
}

/** "10月14日周三" / "Wed, Oct 14": the going list's day, never a clock time. */
export const dayLabel = (d: Date, l: Locale) => {
  const { date, weekday } = fmtDayHeader(d, l);
  return l === 'zh' ? `${date}${weekday}` : `${weekday}, ${date}`;
};
/**
 * fmtRange in PT; all-day events say so, with the day span when they run over several days. A
 * single all-day day says only 全天 / All day under a day header (Item); `dated` adds the day for
 * rows without one (the next-week preview).
 */
export function when(e: DigestEvent, l: Locale, dated = false) {
  const start = new Date(e.startAt);
  if (e.allDay) {
    // An all-day end is exclusive (next midnight), so the last day is the instant before it.
    const last = e.endAt ? new Date(Date.parse(e.endAt) - 1) : null;
    if (!last || last <= start || dayKey(last, PT) === dayKey(start, PT)) {
      return dated ? `${dayLabel(start, l)} · ${COPY[l].allDay}` : COPY[l].allDay;
    }
    return `${COPY[l].allDay} · ${dayLabel(start, l)}${l === 'zh' ? '–' : '\u2009–\u2009'}${dayLabel(last, l)}`;
  }
  return fmtRange(start, e.endAt ? new Date(e.endAt) : null, l);
}

/** Neighbourhood or city (never an address), or 线上 / Online; hybrid adds the hybrid label. */
export function where(e: DigestEvent, l: Locale) {
  if (e.format === 'online') return [COPY[l].online];
  const out = e.place ? [e.place] : [];
  if (e.format === 'hybrid') out.push(COPY[l].hybrid);
  return out;
}

/** Price ("Free" → 免费 / Free, anything else verbatim) and access (apply / waitlist / sold out). */
export function chips(e: DigestEvent, l: Locale) {
  const out: { text: string; lang?: string }[] = [];
  const price = e.priceText?.trim();
  if (price) out.push(/^free$/i.test(price) ? { text: COPY[l].free } : { text: price, lang: l === 'zh' ? 'en' : undefined });
  if (e.access === 'apply' || e.access === 'waitlist' || e.access === 'sold_out') out.push({ text: COPY[l].access[e.access] });
  return out;
}

/** The intro in one language as trimmed, non-empty lines (email, /weekly archive, WeChat text). */
export function introLines(snap: Pick<DigestSnapshot, 'introEn' | 'introZh'>, locale: Locale) {
  const raw = (locale === 'zh' ? snap.introZh : snap.introEn) ?? '';
  return raw
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
}
