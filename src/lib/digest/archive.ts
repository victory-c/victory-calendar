import { type GoingDisplay, publicGoing, type SealKind } from '../events/going';
import type { PublicEvent } from '../events/types';
import { isoWeekBounds, startOfKey } from '../format/calendar';
import { dayKey, PT } from '../format/date';
import { CATEGORY_SLUGS, type Category, type Locale } from '../taxonomy';
import { introLines } from './fields';
import { selectForVariant } from './select';
import type { DigestSnapshot } from './types';
import { coverage } from './week';

// The public /weekly/[week] archive (DESIGN D7/D8), as a pure function of what archive-queries.ts
// loads. The frozen snapshot decides which events are in the issue, its sections (all seven
// categories, the going list, the next-week preview) and its intro; each event is then drawn from
// its current live row, so an event unpublished since vanishes, a cancelled one stays struck
// through, and the attendance kill switch, going visibility and cover changes all apply.
// Nothing per reader is ever part of it: no preferences or unsubscribe links, no token, no audience.

/** What archive-queries.ts getArchiveIssue() returns for a public issue. */
export type ArchiveIssue = {
  /** ISO instant the data was read at: going and "ended" decisions use it. */
  now: string;
  snap: DigestSnapshot;
  /** Current published and cancelled rows of the snapshot's events and preview (archived ones are gone). */
  live: PublicEvent[];
  /** The attendance kill switch as it is now. */
  showAttendance: boolean;
  /** The preview week's issue is public too, so the preview links to its archive. */
  nextIssue: boolean;
};

export type ArchiveCard = { event: PublicEvent; going: GoingDisplay };
export type ArchiveDay = { key: string; date: Date; cards: ArchiveCard[] };
export type ArchiveSection = { category: Category; days: ArchiveDay[] };

export type ArchiveView = {
  isoWeek: string;
  /** Intro paragraphs in the page language. */
  intro: string[];
  /** 我会去 / Victor is going: the issue's public seals, re-checked against the live rows. */
  going: { event: PublicEvent; seal: SealKind }[];
  /** One per category with events left, taxonomy order; days in date order. */
  sections: ArchiveSection[];
  /** Events in the category sections (0 = everything was taken down since). */
  picks: number;
  preview: { isoWeek: string; href: string; events: PublicEvent[] };
};

const NONE: GoingDisplay = { kind: 'none' };

/** Live start time, then id (a rescheduled event moves with its new time). */
const byStart = (a: PublicEvent, b: PublicEvent) => a.startAt.getTime() - b.startAt.getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** Pacific days, as the email groups them; a day's date is its first event's start. */
function byDay(events: PublicEvent[]): (Pick<ArchiveDay, 'key' | 'date'> & { events: PublicEvent[] })[] {
  const days = new Map<string, PublicEvent[]>();
  for (const e of [...events].sort(byStart)) {
    const k = dayKey(e.startAt, PT);
    days.set(k, [...(days.get(k) ?? []), e]);
  }
  return [...days.entries()].map(([key, list]) => ({ key, date: list[0].startAt, events: list }));
}

export function archiveView(issue: ArchiveIssue, locale: Locale): ArchiveView {
  const { snap, showAttendance } = issue;
  const now = new Date(issue.now);
  const live = new Map(issue.live.map((e) => [e.id, e]));
  const rows = (ids: { id: string }[]) => ids.flatMap((d) => live.get(d.id) ?? []);
  // Every category: the archive is the issue as a whole, not one reader's variant.
  const selection = selectForVariant(snap, CATEGORY_SLUGS);

  const sections = selection.sections.flatMap((sec): ArchiveSection[] => {
    const events = rows(sec.days.flatMap((d) => d.events));
    if (events.length === 0) return [];
    return [
      {
        category: sec.category,
        days: byDay(events).map(({ key, date, events: list }) => ({
          key,
          date,
          // Grey 想去 / Interested never appears in the email, so not here either.
          cards: list.map((e) => {
            const g = publicGoing(e, now, showAttendance);
            return { event: e, going: g.kind === 'seal' ? g : NONE };
          }),
        })),
      },
    ];
  });

  // The snapshot's seals (none when attendance was off at the send), kept only while the live row
  // would still show one: hidden since, kill switch on, or cancelled → gone; after the event, 去过.
  const going = rows(selection.going)
    .sort(byStart)
    .flatMap((e) => {
      if (e.status === 'cancelled') return [];
      const g = publicGoing(e, now, showAttendance);
      return g.kind === 'seal' ? [{ event: e, seal: g.seal }] : [];
    });

  const previewWeek = coverage(snap.isoWeek).previewWeek;
  return {
    isoWeek: snap.isoWeek,
    intro: introLines(snap, locale),
    going,
    sections,
    picks: sections.reduce((n, s) => n + s.days.reduce((m, d) => m + d.cards.length, 0), 0),
    preview: {
      isoWeek: previewWeek,
      href: `${issue.nextIssue ? '/weekly' : '/week'}/${previewWeek}`,
      events: rows(selection.preview).sort(byStart),
    },
  };
}

/**
 * D7: an issue is public once it is sending or sent with a version-1 snapshot of this week that
 * has events (only empty notices went out otherwise, so there is nothing to archive).
 */
export function isArchivable(snapshot: unknown, isoWeek: string): snapshot is DigestSnapshot {
  const s = snapshot as Partial<DigestSnapshot> | null;
  return s?.version === 1 && s.isoWeek === isoWeek && Array.isArray(s.events) && s.events.length > 0 && Array.isArray(s.preview);
}

/** The covered week's Monday with its year: "Oct 12, 2026" / "2026年10月12日" (titles, the index). */
export function weekDate(isoWeek: string, locale: Locale) {
  const b = isoWeekBounds(isoWeek);
  if (!b) throw new Error(`bad iso week: ${isoWeek}`);
  // Noon PT is on the right calendar day whatever the DST offset.
  const noon = new Date(startOfKey(b.from).getTime() + 12 * 3600_000);
  return new Intl.DateTimeFormat(locale === 'zh' ? 'zh-CN' : 'en-US', { timeZone: PT, year: 'numeric', month: 'short', day: 'numeric' }).format(noon);
}
