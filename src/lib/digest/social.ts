import { createHash } from 'node:crypto';
import { COPY, sealAlt } from '@/emails/copy';
import { note, titles } from '../events/display';
import { dayKey, fmtBeijing, fmtDayHeader, fmtTime, PT, zoneLabel } from '../format/date';
import { CATEGORIES, CATEGORY_SLUGS, type Category } from '../taxonomy';
import { ALT_TITLE_MAX, chips, clip, dayLabel, introLines, NOTE_MAX, when, where } from './fields';
import { byStart, isDigestSeal, selectForVariant } from './select';
import type { DigestEvent, DigestSeal, DigestSnapshot } from './types';

// The issue as one Chinese export model (F17, M4): the WeChat text (wechat.ts), the 1080 px WeChat
// long image and the Xiaohongshu pages (og/social.tsx) are all drawn from it, so an event has the
// same number everywhere ("3 号有人去吗" works whichever one a reader saw). Pure: the same snapshot
// and options always give the same model, the same pagination and the same hash.
//
// - The model keeps the text exactly as the WeChat text prints it. Images use imageModel(), which
//   drops emoji (Satori would fetch them from a CDN) and nothing else.
// - Image pagination needs no text measuring: every block has a fixed height from its line count,
//   and line counts come from lineCount(), a deliberate over-estimate from the fonts' advance
//   widths; the images clamp each block to that many lines, so planned and drawn heights agree.
// - Xiaohongshu output carries no URL-like text of our own (no scheme, www., host or "vercel"):
//   its meta line (xhsMeta) names the platform only when it is a named one (Luma, Partiful…), never
//   the bare host platformName() gives for other sites; urlLike() finds any URL-like text that
//   Victor's own words bring in, and the editor names it.

export type ExportOptions = {
  /** publicOrigin() when the export is generated, not snap.origin: a domain added after the freeze shows up. */
  origin: string;
  /** newsletterStatus() === 'open': the WeChat text adds the subscribe link. */
  subscribe: boolean;
  /** Events cancelled since the freeze (liveState()): kept in place, unnumbered, not counted. */
  cancelled?: ReadonlySet<string>;
};

export type ExportItem = {
  /** 1..n in start order across every category; null for an event cancelled since the freeze. */
  n: number | null;
  eventId: string;
  category: Category;
  /** Pacific day of the start: YYYY-MM-DD and "10月14日周三". */
  day: string;
  dayLabel: string;
  title: string;
  /** The official title in the other language, clipped; null when it adds nothing. */
  alt: string | null;
  /** Clock times under the day header (18:30–21:00). */
  time: string;
  /** time · place or 线上 · Beijing time · price/access · platform (the WeChat text and long image). */
  meta: string;
  /** `meta` as the Xiaohongshu pages print it: the platform only when it is a named one, never a host. */
  xhsMeta: string;
  /** Victor's note, clipped like the email; never on a cancelled event. */
  note: string | null;
  /** Public seal, only while attendance is on; never on a cancelled event. */
  seal: DigestSeal | null;
  /** covers.id of the real cover the email shows (its /og/email-cover/{id} URL); null = the template. */
  coverId: string | null;
  /** The email's credit for that cover; null with the template. */
  credit: string | null;
};

export type ExportDay = { key: string; label: string; items: ExportItem[] };

export type ExportModel = {
  isoWeek: string;
  site: string;
  /** The covered week's Monday ("10月12日") and the masthead line ("10月12日 这一周"). */
  monday: string;
  weekOf: string;
  subject: string;
  intro: string[];
  zone: string;
  days: ExportDay[];
  preview: { title: string; day: string; cancelled: boolean }[];
  /** The public week page, the one link the WeChat text and image carry. */
  weekUrl: string;
  subscribeUrl: string | null;
  footer: string;
  picks: number;
  going: number;
};

const oneLine = (s: string) => s.trim().replace(/\s+/g, ' ');

/** Clock times under a day header: 18:30–21:00, or 9:00 – 10月18日周日 17:00 across days; all-day as when(). */
function clock(e: DigestEvent) {
  if (e.allDay) return when(e, 'zh');
  const start = new Date(e.startAt);
  const end = e.endAt ? new Date(e.endAt) : null;
  if (!end || end <= start) return fmtTime(start, 'zh');
  if (dayKey(end, PT) !== dayKey(start, PT)) return `${fmtTime(start, 'zh')} – ${dayLabel(end, 'zh')} ${fmtTime(end, 'zh')}`;
  return `${fmtTime(start, 'zh')}–${fmtTime(end, 'zh')}`;
}

/** The cover id in a frozen /og/email-cover/{id} URL (as run.ts reads it); null for the template. */
export function coverIdOf(e: Pick<DigestEvent, 'coverUrl'>, origin: string): string | null {
  const prefix = `${origin.replace(/\/+$/, '')}/og/email-cover/`;
  if (typeof e.coverUrl !== 'string' || !e.coverUrl.startsWith(prefix)) return null;
  try {
    return decodeURIComponent(e.coverUrl.slice(prefix.length)) || null;
  } catch {
    return null;
  }
}

/** A platform platformName() knows by name; anything else it gives is a host (events.stanford.edu). */
const NAMED_PLATFORM = /^[A-Z][A-Za-z]*$/;

function item(e: DigestEvent, n: number | null, snap: DigestSnapshot): ExportItem {
  const t = titles(e, 'zh');
  const start = new Date(e.startAt);
  const time = clock(e);
  const meta = [time, ...where(e, 'zh')];
  // Online and hybrid events can be joined from China: the start in Beijing time, as on the zh
  // event page. Not for all-day events, whose start is just Pacific midnight.
  if (e.format !== 'in_person' && !e.allDay) meta.push(fmtBeijing(start));
  meta.push(...chips(e, 'zh').map((c) => c.text));
  // platformName() gives a capitalised name for the platforms it knows (Luma, Partiful, Eventbrite,
  // Meetup) and the bare host for anything else: the WeChat text keeps either, Xiaohongshu only a name.
  const xhsMeta = e.platform && NAMED_PLATFORM.test(e.platform) ? [...meta, e.platform] : [...meta];
  if (e.platform) meta.push(e.platform);
  const v = n === null ? null : note(e, 'zh');
  const coverId = coverIdOf(e, snap.origin);
  return {
    n,
    eventId: e.id,
    category: e.category,
    day: dayKey(start, PT),
    dayLabel: dayLabel(start, 'zh'),
    title: oneLine(t.primary),
    alt: t.secondary ? clip(t.secondary, ALT_TITLE_MAX[t.secondaryLang]) : null,
    time,
    meta: oneLine(meta.join(' · ')),
    xhsMeta: oneLine(xhsMeta.join(' · ')),
    note: v ? clip(v.text, NOTE_MAX[v.lang]) : null,
    seal: n !== null && snap.showAttendance && isDigestSeal(e.seal) ? e.seal : null,
    coverId,
    credit: coverId ? e.coverCredit?.trim() || null : null,
  };
}

/**
 * The export of one snapshot: Chinese, every category, numbered 1..n in start order, grouped by
 * Pacific day; null when the week has no picks (nothing to post). A frozen snapshot goes through
 * liveState() first (export-source.ts), so takedowns, cancellations and the kill switch apply.
 */
export function exportModel(snap: DigestSnapshot, o: ExportOptions): ExportModel | null {
  if (snap?.version !== 1) throw new Error(`digest snapshot version ${String(snap?.version)} is not supported`);
  const sel = selectForVariant(snap, CATEGORY_SLUGS);
  const cancelled = o.cancelled ?? new Set<string>();
  const events = sel.sections.flatMap((s) => s.days.flatMap((d) => d.events)).sort(byStart);
  const picks = events.filter((e) => !cancelled.has(e.id)).length;
  if (picks === 0) return null;
  const c = COPY.zh;
  const going = snap.showAttendance ? sel.going.filter((e) => !cancelled.has(e.id)).length : 0;
  const origin = o.origin.replace(/\/+$/, '');
  // The covered week's Monday at noon PT, always the right calendar day (as the email masthead).
  const monday = fmtDayHeader(new Date(Date.parse(snap.from) + 12 * 3600_000), 'zh').date;

  const days: ExportDay[] = [];
  let n = 0;
  for (const e of events) {
    const it = item(e, cancelled.has(e.id) ? null : ++n, snap);
    const last = days.at(-1);
    if (last && last.key === it.day) last.items.push(it);
    else days.push({ key: it.day, label: it.dayLabel, items: [it] });
  }

  return {
    isoWeek: snap.isoWeek,
    site: c.site,
    monday,
    weekOf: c.weekOf(monday),
    subject: c.subject(picks, going),
    intro: introLines(snap, 'zh'),
    zone: `时间均为${zoneLabel('zh')}`,
    days,
    preview: sel.preview.map((e) => ({
      title: oneLine(titles(e, 'zh').primary),
      day: dayLabel(new Date(e.startAt), 'zh'),
      cancelled: cancelled.has(e.id),
    })),
    weekUrl: `${origin}/zh/week/${snap.isoWeek}`,
    subscribeUrl: o.subscribe ? `${origin}/zh/subscribe` : null,
    footer: c.noPaid,
    picks,
    going,
  };
}

/** Every item in order. */
export const itemsOf = (m: ExportModel) => m.days.flatMap((d) => d.items);

// ---- images ---------------------------------------------------------------------------------

const EMOJI_TEST = /[\p{Extended_Pictographic}\p{Emoji_Modifier}\p{Regional_Indicator}\u200d\ufe0f\u20e3]/u;
const EMOJI = new RegExp(EMOJI_TEST.source, 'gu');

/** Emoji dropped (Satori draws them from a CDN); text without any is returned unchanged. */
export function plain(s: string): string {
  if (!EMOJI_TEST.test(s)) return s;
  return s.replace(EMOJI, '').replace(/[ \t]{2,}/g, ' ').trim();
}

/** The model as the images print it: emoji dropped from every string, nothing else changed. */
export function imageModel(m: ExportModel): ExportModel {
  const p = (s: string | null) => (s === null ? null : plain(s));
  return {
    ...m,
    intro: m.intro.map(plain).filter(Boolean),
    days: m.days.map((d) => ({
      ...d,
      items: d.items.map((it) => ({
        ...it, title: plain(it.title), alt: p(it.alt) || null, meta: plain(it.meta), xhsMeta: plain(it.xhsMeta), note: p(it.note) || null,
        credit: p(it.credit) || null,
      })),
    })),
    preview: m.preview.map((x) => ({ ...x, title: plain(x.title) })),
  };
}

// Advance widths (em, rounded up) of ASCII U+0020–U+007E: the larger of Noto Sans SC 400 and Noto
// Serif SC 600 (measured from the Google Fonts files). Anything else counts as a full em.
const ASCII_EM = [
  26, 34, 48, 60, 58, 95, 80, 28, 39, 39, 49, 60, 34, 36, 34, 40, 58, 56, 58, 58, 58, 58, 58, 58, 58, 59, 34, 34, 60, 60, 60, 48,
  95, 74, 70, 70, 79, 66, 64, 75, 86, 42, 54, 76, 64, 99, 81, 78, 66, 78, 74, 60, 68, 81, 73, 108, 72, 70, 62, 36, 40, 36, 60, 58,
  61, 58, 66, 56, 65, 57, 40, 59, 68, 35, 33, 64, 35, 100, 68, 62, 66, 63, 49, 49, 39, 67, 57, 86, 59, 57, 51, 38, 33, 38, 60,
].map((n) => n / 100);

/** Marks that may not start a line (UAX #14), so they travel with the character before them. */
const NO_START = /[，。、：；！？）」』】》〉…—’”·]/;
/** Marks that may not end a line, so they travel with the character after them. */
const NO_END = /[（「『【《〈‘“]/;

/** Advance width (em) of one character: Noto Sans SC / Noto Serif SC, upper bounds. */
export type EmOf = (c: string) => number;

const emOf: EmOf = (c) => {
  const code = c.codePointAt(0)!;
  return code >= 0x20 && code <= 0x7e ? ASCII_EM[code - 0x20] : 1;
};

/**
 * Geist Mono (cover credits): every ASCII glyph advances 0.6 em (measured: 600 of 1000 units); it
 * carries ASCII only (og/fonts.ts), so anything else falls back to Noto Sans SC, a full em at most.
 */
export const monoEm: EmOf = (c) => {
  const code = c.codePointAt(0)!;
  return code >= 0x20 && code <= 0x7e ? 0.6 : 1;
};

/** Unbreakable runs: an ASCII word, or one CJK character with the punctuation glued to it. */
function runs(s: string, em: EmOf): { w: number; space: boolean }[] {
  const out: { w: number; space: boolean }[] = [];
  let word = 0; // the ASCII word being read
  let open = 0; // opening marks waiting for the run after them
  const push = (w: number) => {
    out.push({ w: w + open, space: false });
    open = 0;
  };
  const flush = () => {
    if (word) push(word);
    word = 0;
  };
  for (const c of s) {
    if (/\s/.test(c)) {
      flush();
      if (open) push(0);
      out.push({ w: em(' '), space: true });
    } else if (c.codePointAt(0)! <= 0x7e) {
      word += em(c);
    } else {
      flush();
      const last = out.at(-1);
      if (NO_START.test(c) && last && !last.space && !open) last.w += 1;
      else if (NO_END.test(c)) open += 1;
      else push(1);
    }
  }
  flush();
  if (open) push(0);
  return out;
}

/**
 * How many lines `s` takes in a box `widthEm` wide, never fewer than Satori draws: upper-bound
 * advance widths (`em`: the text fonts unless given), greedy breaking at word boundaries, half an
 * em of slack per line. 0 when empty.
 */
export function lineCount(s: string, widthEm: number, em: EmOf = emOf): number {
  if (!s.trim()) return 0;
  const cap = widthEm - 0.5;
  let lines = 1;
  let x = 0;
  for (const r of runs(s, em)) {
    if (r.space) {
      if (x > 0) x += r.w;
      continue;
    }
    if (x > 0 && x + r.w > cap) {
      lines++;
      x = 0;
    }
    if (r.w > cap) {
      lines += Math.ceil(r.w / cap) - 1;
      x = r.w % cap;
    } else x += r.w;
  }
  return lines;
}

/** One text block: font size, line height (px) and the lines it may take. */
type Font = { size: number; lh: number };
const lines = (s: string | null, f: Font, width: number, max: number) => (s ? Math.min(max, Math.max(1, lineCount(s, width / f.size))) : 0);

/** WeChat long image layout (px). og/social.tsx draws with these, so plan and image agree. */
export const LONG = {
  width: 1080,
  maxHeight: 9000,
  padX: 64,
  band: 12,
  top: 64,
  brand: 56,
  weekOf: { size: 80, lh: 96 },
  subject: { size: 34, lh: 50 },
  intro: { size: 32, lh: 52 },
  zone: { size: 26, lh: 40 },
  /** Gaps in the masthead: after the brand row, before the subject, the intro, between its paragraphs, before the zone line, after it. */
  gaps: { brand: 36, subject: 8, intro: 32, para: 12, zone: 32, bottom: 16 },
  compact: 120,
  day: { height: 112, size: 34 },
  item: {
    padY: 28,
    cover: 200,
    gap: 28,
    num: 64,
    /** The number (Geist Mono) and, under it after `sealGap`, the seal stamp. */
    number: { size: 34, lh: 44 },
    seal: 56,
    sealGap: 12,
    gapY: 10,
    title: { size: 38, lh: 50 },
    alt: { size: 24, lh: 34 },
    meta: { size: 26, lh: 38 },
    note: { size: 28, lh: 42 },
    credit: { size: 18, lh: 26 },
  },
  preview: { head: 96, line: { size: 28, lh: 46 }, bottom: 24 },
  footer: { top: 56, label: { size: 26, lh: 40 }, url: { size: 30, lh: 46 }, gap: 28, bottom: 72 },
} as const;

/** Width of the text column beside a long-image cover. */
export const LONG_TEXT_W = LONG.width - 2 * LONG.padX - LONG.item.cover - LONG.item.gap - LONG.item.num;
const LONG_CONTENT_W = LONG.width - 2 * LONG.padX;

export type ItemLines = { title: number; alt: number; meta: number; note: number; credit: number };

export type LongBlock =
  | { kind: 'masthead'; height: number; intro: { text: string; lines: number }[] }
  | { kind: 'header'; height: number }
  | { kind: 'day'; height: number; label: string; cont: boolean }
  | { kind: 'item'; height: number; item: ExportItem; lines: ItemLines; rule: boolean }
  | { kind: 'preview'; height: number }
  | { kind: 'footer'; height: number };

export type LongPart = { index: number; total: number; height: number; blocks: LongBlock[] };

function mastheadBlock(m: ExportModel): Extract<LongBlock, { kind: 'masthead' }> {
  const intro = m.intro.map((text) => ({ text, lines: lines(text, LONG.intro, LONG_CONTENT_W, 12) }));
  const g = LONG.gaps;
  const introH = intro.reduce((h, p) => h + p.lines * LONG.intro.lh, 0) + Math.max(0, intro.length - 1) * g.para;
  const height =
    LONG.band + LONG.top + LONG.brand + g.brand + LONG.weekOf.lh + g.subject + LONG.subject.lh + (intro.length ? g.intro + introH : 0) + g.zone + LONG.zone.lh + g.bottom;
  return { kind: 'masthead', height, intro };
}

/** Lines a cover credit may take in the long image. */
export const CREDIT_LINES = 3;
const creditLines = (s: string) => lineCount(s, LONG_TEXT_W / LONG.item.credit.size, monoEm);

/**
 * A cover credit as the long image prints it, in at most CREDIT_LINES lines of Geist Mono. One
 * that needs more (an Openverse title can run to 120 characters) loses the end of the work's title,
 * never the creator, the licence or what was changed (" · CC BY-SA 2.0 · cropped"): CC BY needs those.
 */
export function fitCredit(credit: string): string {
  if (creditLines(credit) <= CREDIT_LINES) return credit;
  const at = credit.lastIndexOf(' · CC');
  if (at <= 0) return credit; // no licence to keep: the image clamps it
  const work = credit.slice(0, at);
  const tail = credit.slice(at);
  // `"Title" by Creator` (credit.ts): shorten inside the quotes; otherwise from the end of the work.
  const q = /^"([\s\S]*)"( by [\s\S]*)?$/.exec(work);
  const [text, after] = q ? [q[1], `"${q[2] ?? ''}`] : [work, ''];
  const chars = [...text];
  for (let k = chars.length - 1; k >= 0; k--) {
    const fit = `${q ? '"' : ''}${chars.slice(0, k).join('').trimEnd()}…${after}${tail}`;
    if (creditLines(fit) <= CREDIT_LINES) return fit;
  }
  return credit;
}

export function longItemLines(it: ExportItem): ItemLines {
  const I = LONG.item;
  return {
    title: lines(it.title, I.title, LONG_TEXT_W, 2),
    alt: lines(it.alt, I.alt, LONG_TEXT_W, 1),
    meta: lines(it.meta, I.meta, LONG_TEXT_W, 2),
    note: lines(it.note, I.note, LONG_TEXT_W, 3),
    credit: it.credit ? Math.min(CREDIT_LINES, Math.max(1, creditLines(it.credit))) : 0,
  };
}

/** Text column height: each present block's lines, with a gap between blocks. */
export function longTextHeight(l: ItemLines): number {
  const I = LONG.item;
  const blocks = [l.title * I.title.lh, l.alt * I.alt.lh, l.meta * I.meta.lh, l.note * I.note.lh, l.credit * I.credit.lh].filter((h) => h > 0);
  return blocks.reduce((a, b) => a + b, 0) + Math.max(0, blocks.length - 1) * I.gapY;
}

function itemBlock(item: ExportItem, rule: boolean): Extract<LongBlock, { kind: 'item' }> {
  const I = LONG.item;
  const credit = item.credit && fitCredit(item.credit);
  const it = credit === item.credit ? item : { ...item, credit };
  const l = longItemLines(it);
  const numCol = I.number.lh + (it.seal ? I.sealGap + I.seal : 0);
  return { kind: 'item', height: 2 * I.padY + Math.max(I.cover, longTextHeight(l), numCol), item: it, lines: l, rule };
}

const previewHeight = (m: ExportModel) => (m.preview.length ? LONG.preview.head + m.preview.length * LONG.preview.line.lh + LONG.preview.bottom : 0);
const FOOTER_H = (() => {
  const f = LONG.footer;
  return f.top + f.label.lh + f.url.lh + f.gap + f.label.lh + f.bottom;
})();

/**
 * The long image in parts of at most LONG.maxHeight px (WeChat compresses long images past about
 * 10 MP), split only between items: the first part opens with the masthead, later ones with a
 * compact header and the day they continue; the next-week preview and the footer close the last.
 */
export function longPlan(model: ExportModel): LongPart[] {
  const m = imageModel(model);
  const head = mastheadBlock(m);
  const compact: LongBlock = { kind: 'header', height: LONG.band + LONG.compact };
  const tail: LongBlock[] = [
    ...(m.preview.length ? [{ kind: 'preview', height: previewHeight(m) } as const] : []),
    { kind: 'footer', height: FOOTER_H },
  ];

  const parts: LongBlock[][] = [[head]];
  const used = (p: LongBlock[]) => p.reduce((h, b) => h + b.height, 0);
  for (const d of m.days) {
    d.items.forEach((it, i) => {
      // A day header always travels with the item after it.
      const day: LongBlock | null = i === 0 ? { kind: 'day', height: LONG.day.height, label: d.label, cont: false } : null;
      let unit: LongBlock[] = [...(day ? [day] : []), itemBlock(it, i > 0)];
      const cur = parts.at(-1)!;
      if (cur.some((b) => b.kind === 'item') && used(cur) + used(unit) > LONG.maxHeight) {
        if (!day) unit = [{ kind: 'day', height: LONG.day.height, label: d.label, cont: true }, itemBlock(it, false)];
        parts.push([compact, ...unit]);
      } else cur.push(...unit);
    });
  }
  const last = parts.at(-1)!;
  if (used(last) + used(tail) > LONG.maxHeight) parts.push([compact, ...tail]);
  else last.push(...tail);

  return parts.map((blocks, i) => ({ index: i + 1, total: parts.length, height: used(blocks), blocks }));
}

/** Xiaohongshu pages (3:4): a cover, then four items a page, at most nine images in all. */
export const XHS = {
  width: 1080,
  height: 1440,
  perPage: 4,
  maxPages: 8,
  padX: 64,
  head: 120,
  foot: 84,
  tile: 168,
  gap: 28,
  num: 56,
  number: { size: 32, lh: 42 },
  seal: 48,
  padY: 16,
  kicker: { size: 22, lh: 32 },
  title: { size: 34, lh: 44 },
  meta: { size: 23, lh: 32 },
  note: { size: 25, lh: 35 },
  gapY: 6,
} as const;

export const XHS_SLOT = (XHS.height - XHS.head - XHS.foot) / XHS.perPage;
export const XHS_TEXT_W = XHS.width - 2 * XHS.padX - XHS.tile - XHS.gap - XHS.num;

export type XhsPage =
  | { kind: 'cover'; index: 0; total: number; categories: { category: Category; count: number }[] }
  | { kind: 'items'; index: number; total: number; items: ExportItem[]; more: number };

export function xhsPlan(model: ExportModel): XhsPage[] {
  const m = imageModel(model);
  const all = itemsOf(m);
  const shown = all.slice(0, XHS.perPage * XHS.maxPages);
  const more = all.slice(shown.length).filter((it) => it.n !== null).length;
  const pages = Array.from({ length: Math.ceil(shown.length / XHS.perPage) }, (_, i) => shown.slice(i * XHS.perPage, (i + 1) * XHS.perPage));
  const total = pages.length + 1;
  const counts = new Map<Category, number>();
  for (const it of all) if (it.n !== null) counts.set(it.category, (counts.get(it.category) ?? 0) + 1);
  return [
    { kind: 'cover', index: 0, total, categories: CATEGORY_SLUGS.filter((c) => counts.has(c)).map((c) => ({ category: c, count: counts.get(c)! })) },
    ...pages.map((items, i) => ({ kind: 'items' as const, index: i + 1, total, items, more: i === pages.length - 1 ? more : 0 })),
  ];
}

/** Line clamps of one Xiaohongshu item (its slot has a fixed height). */
export function xhsItemLines(it: ExportItem) {
  return {
    title: lines(it.title, XHS.title, XHS_TEXT_W, 2),
    meta: lines(it.xhsMeta, XHS.meta, XHS_TEXT_W, 2),
    note: lines(it.note, XHS.note, XHS_TEXT_W, 2),
  };
}

// ---- Xiaohongshu caption ----------------------------------------------------------------------

export const XHS_TITLE_MAX = 20;
export const XHS_BODY_MAX = 1000;
export const XHS_TAGS = '#湾区 #硅谷 #科技活动 #活动推荐';
const CAPTION_INTRO_MAX = 300;

const captionLine = (it: ExportItem) =>
  `${it.n === null ? '[已取消]' : `${it.n}.`} ${it.seal ? `${sealAlt(it.seal, 'zh')} ` : ''}${it.dayLabel} ${it.time} ${it.title}`;

/**
 * The note text to paste with the pages: a title of at most 20 characters and a body of at most
 * 1,000 (the intro, the numbered list, the fixed hashtags). No link, host or QR code (XHS bans
 * off-site links); events that don't fit become "还有 N 场".
 */
export function xhsCaption(m: ExportModel): { title: string; body: string } {
  const title = [...`${m.monday}这一周｜湾区科技活动精选`].slice(0, XHS_TITLE_MAX).join('');
  const joined = [...m.intro.join('\n')];
  const intro = !joined.length ? null : joined.length <= CAPTION_INTRO_MAX ? joined.join('') : `${joined.slice(0, CAPTION_INTRO_MAX - 1).join('').trimEnd()}…`;
  const all = itemsOf(m);
  const shown = all.slice(0, XHS.perPage * XHS.maxPages).map(captionLine);
  const build = (list: string[]) => {
    const more = all.slice(list.length).filter((it) => it.n !== null).length;
    const parts = [
      ...(intro ? [intro] : []),
      `${m.subject}\n${m.zone}`,
      [...list, ...(more ? [`还有 ${more} 场`] : [])].join('\n'),
      m.footer,
      XHS_TAGS,
    ];
    return parts.join('\n\n');
  };
  let body = build(shown);
  while ([...body].length > XHS_BODY_MAX && shown.length > 0) {
    shown.pop();
    body = build(shown);
  }
  return { title, body: [...body].slice(0, XHS_BODY_MAX).join('') };
}

// ---- checks -------------------------------------------------------------------------------------

// Country codes and the generic TLDs event links use (forms.gle, posh.vip, a16z.capital, *.ventures).
// A list, not "any word after a dot": Next.js, Node.js or Dr.Li are not links.
const TLDS = [
  'com|net|org|io|ai|app|dev|co|me|cn|edu|gov|ly|gg|xyz|link|so|sh|us|tv|info|biz|page|site|tech|to|fm|im|cc|la|ma|gl|be|ws|vc|id',
  'uk|jp|hk|tw|sg|ca|de|fr|ru|in|eu|au|nz|kr|ac|cx|gd',
  'top|club|live|online|store|news|events?|gle|vip|capital|ventures|studio|fund|build|world|global|social|space|art|design',
  'community|network|works|pro|one|run|bio|ink|lol|inc|today|city|center|party|tickets|cloud|tools|systems|partners|group',
  'team|school|academy|fyi|chat|email|company|agency|digital|media|blog|health|finance|money|land|zone|nyc|xn--[a-z0-9-]+',
].join('|');
const URL_LIKE = [
  /\b[a-z][a-z0-9+.-]*:\/\/\S+/gi,
  /\bwww\.\S+/gi,
  new RegExp(`\\b(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\\.)+(?:${TLDS})\\b(?:\\/\\S*)?`, 'gi'),
  /vercel/gi,
];

/** URL-like pieces of `s` (a scheme, www., a domain with a common TLD, "vercel"); [] when clean. */
export function urlLike(s: string): string[] {
  const hits = new Set<string>();
  for (const re of URL_LIKE) for (const m of s.matchAll(re)) hits.add(m[0]);
  // The widest piece only: "https://x.example.com" also matches as a domain and "vercel.app" as "vercel".
  return [...hits].filter((h) => ![...hits].some((o) => o !== h && o.includes(h)));
}

/** Every string the Xiaohongshu pages print (the plan's items, the masthead, the cover's counts). */
export function xhsStrings(m: ExportModel): string[] {
  const im = imageModel(m);
  const shown = xhsPlan(m).flatMap((p) => (p.kind === 'items' ? p.items : []));
  return [
    im.site, im.weekOf, im.subject, im.zone, im.footer, ...im.intro,
    ...shown.flatMap((it) => [it.dayLabel, it.title, it.xhsMeta, it.note ?? '']),
    ...Object.values(CATEGORIES).map((c) => c.zh),
  ].filter(Boolean);
}

/** What to fix or know before posting the images (shown under the export panel). */
export function exportWarnings(m: ExportModel): string[] {
  const out: string[] = [];
  const caption = xhsCaption(m);
  const found = new Map<string, string>();
  const scan = (s: string, where: string) => {
    for (const hit of urlLike(s)) if (!found.has(hit)) found.set(hit, where);
  };
  m.intro.forEach((line) => scan(line, 'intro · 开场白'));
  for (const it of itemsOf(m)) {
    const where = `${it.n ?? '[已取消]'}. ${it.title}`;
    for (const s of [it.title, it.alt ?? '', it.xhsMeta, it.note ?? '']) scan(s, where);
  }
  scan(caption.body, 'caption · 文案');
  for (const [hit, where] of found) {
    out.push(`Looks like a link in the Xiaohongshu text: "${hit}" (${where}); XHS bans off-site links, edit it out · 小红书内容里有像链接的文字：「${hit}」（${where}），请改掉`);
  }
  const parts = longPlan(m).length;
  if (parts > 1) out.push(`A long week: the WeChat image comes in ${parts} parts · 本周较长，长图分成 ${parts} 张`);
  const items = itemsOf(m).length;
  const cap = XHS.perPage * XHS.maxPages;
  if (items > cap) out.push(`Xiaohongshu shows the first ${cap} of ${items} events; the last page says 还有 N 场 · 小红书只放前 ${cap} 场`);
  return out;
}

/** Bump when a layout change should refetch images cached under an old hash. */
export const LAYOUT_V = 1;

/**
 * Fingerprint of what one kind of image shows (?v= on the image URLs): the model, the layout
 * version and, for WeChat, the official-covers switch (its covers follow it).
 */
export function exportHash(m: ExportModel, kind: 'wechat' | 'xhs', allToTemplate = false): string {
  return createHash('sha256')
    .update(JSON.stringify([LAYOUT_V, kind, kind === 'wechat' && allToTemplate, m]))
    .digest('base64url')
    .slice(0, 16);
}

/** Image names: wechat-1…, xhs-0…xhs-8 (no dot, so proxy.ts still guards the route). */
export type ImageTarget = { kind: 'wechat'; index: number } | { kind: 'xhs'; index: number };

export function parseImageName(name: string): ImageTarget | null {
  const m = /^(?:wechat-([1-9])|xhs-([0-8]))$/.exec(name);
  if (!m) return null;
  return m[1] ? { kind: 'wechat', index: Number(m[1]) } : { kind: 'xhs', index: Number(m[2]) };
}

export const imageName = (t: ImageTarget) => `${t.kind}-${t.index}`;
