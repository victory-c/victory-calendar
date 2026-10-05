import 'server-only';
import { cacheLife, cacheTag } from 'next/cache';
import { hasDatabase } from '../db';
import { startOfKey } from '../format/calendar';
import { dayKey, PT } from '../format/date';
import { showAttendance } from '../settings';
import { seedEvents } from './seed';
import { publicEvents } from './public-rows';
import { redactForPublic } from './redact';
import type { PublicEvent } from './types';

export type Upcoming = {
  /** ISO instant the list was computed at; use it for going/ended decisions on the page. */
  now: string;
  todayKey: string;
  events: PublicEvent[];
  showAttendance: boolean;
  sample: boolean;
};

const startOfDayPT = (now: Date, addDays = 0) => startOfKey(dayKey(now, PT), addDays);

// The site shows published and cancelled events (struck through); the DB read lives in
// public-rows.ts so the digest can use it uncached.
const fromDb = (from: Date, to: Date) => publicEvents({ from, to });
/** One event by slug, whenever it starts (detail pages, OG cards, per-event ICS). */
const bySlug = (slug: string) => publicEvents({ slug });

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
    ? seedEvents(now).map(redactForPublic).filter((e) => e.startAt >= from && e.startAt < to).sort((a, b) => +a.startAt - +b.startAt)
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
    ? seedEvents(now).map(redactForPublic).filter((e) => e.startAt >= from && e.startAt < to).sort((a, b) => +a.startAt - +b.startAt)
    : await fromDb(from, to);
  return { now: now.toISOString(), events, showAttendance: await showAttendance(), sample };
}

export async function getEventBySlug(slug: string): Promise<(Window & { event: PublicEvent | null })> {
  'use cache';
  cacheTag('events');
  cacheLife({ stale: 300, revalidate: 900, expire: 86_400 });
  const now = new Date();
  const sample = !hasDatabase();
  const events = sample ? seedEvents(now).map(redactForPublic).filter((e) => e.slug === slug) : await bySlug(slug);
  return { now: now.toISOString(), events, event: events[0] ?? null, showAttendance: await showAttendance(), sample };
}

/** Slugs to prerender at build time (upcoming window). */
export async function upcomingSlugs() {
  const { events } = await getWindow(-1, 30);
  return events.map((e) => e.slug);
}

/** Explicit Pacific day-key range [fromKey, toKey) — month grid, ISO week, archive. */
export async function getRange(fromKey: string, toKey: string): Promise<Window & { todayKey: string }> {
  'use cache';
  cacheTag('events');
  cacheLife({ stale: 300, revalidate: 900, expire: 86_400 });
  const now = new Date();
  const from = startOfKey(fromKey);
  const to = startOfKey(toKey);
  const sample = !hasDatabase();
  const events = sample
    ? seedEvents(now).map(redactForPublic).filter((e) => e.startAt >= from && e.startAt < to).sort((a, b) => +a.startAt - +b.startAt)
    : await fromDb(from, to);
  return { now: now.toISOString(), todayKey: dayKey(now, PT), events, showAttendance: await showAttendance(), sample };
}

/** Today's PT day key, cached alongside the event data so pages stay prerenderable. */
export async function getToday() {
  'use cache';
  cacheLife({ stale: 300, revalidate: 900, expire: 86_400 });
  return dayKey(new Date(), PT);
}
