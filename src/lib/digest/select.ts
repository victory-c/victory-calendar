import { dayKey, fmtDayHeader, PT } from '../format/date';
import { CATEGORY_SLUGS, type Category, isCategory, type Locale } from '../taxonomy';
import type { DigestEvent, DigestSeal, DigestSnapshot } from './types';
import { coverage } from './week';

// What one variant (language × category set) shows, as a pure function of the frozen snapshot.
// F06 "only the sections you picked": the category sections, the going list and the next-week
// preview are all restricted to the variant's categories, so an event from a category the reader
// didn't pick never appears anywhere in their email. The subject's counts come from here too, so
// they always match what the body shows.

export type DigestDay = {
  /** Pacific calendar day, YYYY-MM-DD. */
  key: string;
  /** Day header parts per language ("10月14日" + "周三" / "Oct 14" + "Wed"). */
  labels: Record<Locale, { date: string; weekday: string }>;
  events: DigestEvent[];
};

export type DigestSection = { category: Category; days: DigestDay[] };

export type VariantSelection = {
  /** One per picked category that has events, in taxonomy order; days in date order. */
  sections: DigestSection[];
  /** Public going/hosting/speaking seals in the picked categories; empty when attendance is off. */
  going: DigestEvent[];
  /** Featured events of the following week in the picked categories. */
  preview: DigestEvent[];
  /** Events in the sections (= the subject's count). */
  picks: number;
};

const byStart = (a: DigestEvent, b: DigestEvent) =>
  Date.parse(a.startAt) - Date.parse(b.startAt) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

function unique(list: DigestEvent[]) {
  const seen = new Set<string>();
  return list.filter((e) => !seen.has(e.id) && (seen.add(e.id), true));
}

/**
 * The covered week's events, defensively re-checked: known category, start inside [from, to).
 * Assembly already guarantees this; checking again keeps a bad snapshot from leaking events.
 */
function weekEvents(snap: DigestSnapshot) {
  const from = Date.parse(snap.from);
  const to = Date.parse(snap.to);
  return unique(
    snap.events.filter((e) => {
      const t = Date.parse(e.startAt);
      return isCategory(e.category) && t >= from && t < to;
    }),
  ).sort(byStart);
}

const wanted = (categories: readonly string[]) => new Set(categories.filter(isCategory));

const SEALS: readonly string[] = ['going', 'hosting', 'speaking'] satisfies DigestSeal[];
/** A public seal the digest may show (never "went" or "interested", whatever a snapshot holds). */
export const isDigestSeal = (s: unknown): s is DigestSeal => typeof s === 'string' && SEALS.includes(s);

/** Categories with at least one pick this week, taxonomy order (subscribers outside get no digest). */
export function categoriesWithPicks(snap: DigestSnapshot): Category[] {
  const present = new Set(weekEvents(snap).map((e) => e.category));
  return CATEGORY_SLUGS.filter((c) => present.has(c));
}

export function selectForVariant(snap: DigestSnapshot, categories: readonly string[]): VariantSelection {
  const want = wanted(categories);
  const picked = weekEvents(snap).filter((e) => want.has(e.category));

  const sections: DigestSection[] = [];
  for (const category of CATEGORY_SLUGS) {
    if (!want.has(category)) continue;
    const list = picked.filter((e) => e.category === category);
    if (list.length === 0) continue;
    const days = new Map<string, DigestEvent[]>();
    for (const e of list) {
      const k = dayKey(new Date(e.startAt), PT);
      days.set(k, [...(days.get(k) ?? []), e]);
    }
    sections.push({
      category,
      days: [...days.entries()].map(([key, events]) => {
        const first = new Date(events[0].startAt);
        return { key, labels: { en: fmtDayHeader(first, 'en'), zh: fmtDayHeader(first, 'zh') }, events };
      }),
    });
  }

  // The kill switch is applied at assembly (seal = null); checking the flag again here means a
  // snapshot with attendance off can never render a seal, whatever its events carry.
  const going = snap.showAttendance ? picked.filter((e) => isDigestSeal(e.seal)) : [];
  const previewFrom = Date.parse(snap.to);
  const previewTo = coverage(snap.isoWeek).previewTo.getTime();
  const preview = unique(
    snap.preview.filter((e) => {
      const t = Date.parse(e.startAt);
      return isCategory(e.category) && want.has(e.category) && t >= previewFrom && t < previewTo;
    }),
  ).sort(byStart);

  return { sections, going, preview, picks: picked.length };
}

/** True when the variant has no picks this week (it gets at most the monthly empty notice). */
export function isEmptyFor(snap: DigestSnapshot, categories: readonly string[]): boolean {
  const want = wanted(categories);
  return !weekEvents(snap).some((e) => want.has(e.category));
}
