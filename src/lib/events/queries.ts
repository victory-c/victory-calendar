import 'server-only';
import { TZDate } from '@date-fns/tz';
import { and, asc, eq, gte, inArray, lt } from 'drizzle-orm';
import { cacheLife, cacheTag } from 'next/cache';
import { db, hasDatabase } from '../db';
import { covers, eventsPublic } from '../db/schema';
import { dayKey, PT } from '../format/date';
import { showAttendance } from '../settings';
import { isCategory } from '../taxonomy';
import { seedEvents } from './seed';
import type { PublicCover, PublicEvent } from './types';

export type Upcoming = {
  /** ISO instant the list was computed at; use it for going/ended decisions on the page. */
  now: string;
  todayKey: string;
  events: PublicEvent[];
  showAttendance: boolean;
  sample: boolean;
};

function startOfDayPT(now: Date, addDays = 0) {
  const [y, m, d] = dayKey(now, PT).split('-').map(Number);
  return new Date(new TZDate(y, m - 1, d + addDays, 0, 0, 0, PT).getTime());
}

const PUBLIC_STATUSES = ['published', 'cancelled'] as const;

async function fromDb(from: Date, to: Date, slug?: string): Promise<PublicEvent[]> {
  const rows = await db
    .select()
    .from(eventsPublic)
    .leftJoin(covers, eq(covers.id, eventsPublic.coverId))
    .where(
      slug
        ? and(inArray(eventsPublic.status, [...PUBLIC_STATUSES]), eq(eventsPublic.slug, slug))
        : and(inArray(eventsPublic.status, [...PUBLIC_STATUSES]), gte(eventsPublic.startAt, from), lt(eventsPublic.startAt, to)),
    )
    .orderBy(asc(eventsPublic.startAt));
  return rows.flatMap(({ events_public: e, covers: c }) => {
    if (!e.startAt || !isCategory(e.category)) return [];
    const cover: PublicCover | null = c
      ? {
          kind: c.kind, url400: c.url400, url800: c.url800, url1600: c.url1600, thumbhash: c.thumbhash,
          dominant: c.dominant, letterboxed: c.letterboxed, attribution: c.attribution, license: c.license,
          sourcePageUrl: c.sourcePageUrl,
        }
      : null;
    return [
      {
        id: e.id, slug: e.slug, status: e.status === 'cancelled' ? 'cancelled' : 'published',
        titleEn: e.titleEn ?? e.titleZh ?? '', titleZh: e.titleZh ?? e.titleEn ?? '',
        summaryEn: e.summaryEn, summaryZh: e.summaryZh, noteEn: e.noteEn, noteZh: e.noteZh,
        category: e.category, tags: e.tags, eventLanguage: e.eventLanguage, startAt: e.startAt, endAt: e.endAt,
        tz: e.tz, allDay: e.allDay, format: e.format, venueName: e.venueName, city: e.city,
        neighborhood: e.neighborhood, region: e.region, address: e.address, privateVenue: e.privateVenue,
        priceText: e.priceText, access: e.access, hostName: e.hostName, hostUrl: e.hostUrl, sourceUrl: e.sourceUrl,
        going: e.going, goingVisibility: e.goingVisibility, featured: e.featured, sequence: e.sequence,
        publishedAt: e.publishedAt, cover,
      } satisfies PublicEvent,
    ];
  });
}

/** Today (PT) plus the next `days - 1` days. Cached and tagged; publishing invalidates 'events'. */
export async function getUpcoming(days = 7): Promise<Upcoming> {
  'use cache';
  cacheTag('events');
  cacheLife({ stale: 300, revalidate: 900, expire: 86_400 });
  const now = new Date();
  const from = startOfDayPT(now);
  const to = startOfDayPT(now, days);
  const sample = !hasDatabase();
  const events = sample
    ? seedEvents(now).filter((e) => e.startAt >= from && e.startAt < to).sort((a, b) => +a.startAt - +b.startAt)
    : await fromDb(from, to);
  return { now: now.toISOString(), todayKey: dayKey(now, PT), events, showAttendance: await showAttendance(), sample };
}

export type Window = { now: string; events: PublicEvent[]; showAttendance: boolean; sample: boolean };

/**
 * Feeds and calendars: published + cancelled events whose start falls in [today + fromDays,
 * today + toDays). Cancelled rows stay visible for 14 days after cancellation via their start
 * date window (guide: STATUS:CANCELLED kept 14 days).
 */
export async function getWindow(fromDays: number, toDays: number): Promise<Window> {
  'use cache';
  cacheTag('events');
  cacheLife({ stale: 300, revalidate: 900, expire: 86_400 });
  const now = new Date();
  const from = startOfDayPT(now, fromDays);
  const to = startOfDayPT(now, toDays);
  const sample = !hasDatabase();
  const events = sample
    ? seedEvents(now).filter((e) => e.startAt >= from && e.startAt < to).sort((a, b) => +a.startAt - +b.startAt)
    : await fromDb(from, to);
  return { now: now.toISOString(), events, showAttendance: await showAttendance(), sample };
}

export async function getEventBySlug(slug: string): Promise<(Window & { event: PublicEvent | null })> {
  'use cache';
  cacheTag('events');
  cacheLife({ stale: 300, revalidate: 900, expire: 86_400 });
  const now = new Date();
  const sample = !hasDatabase();
  const events = sample ? seedEvents(now).filter((e) => e.slug === slug) : await fromDb(now, now, slug);
  return { now: now.toISOString(), events, event: events[0] ?? null, showAttendance: await showAttendance(), sample };
}

/** Slugs to prerender at build time (upcoming window). */
export async function upcomingSlugs() {
  const { events } = await getWindow(-1, 30);
  return events.map((e) => e.slug);
}
