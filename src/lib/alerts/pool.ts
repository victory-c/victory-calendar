import 'server-only';
import { and, eq, gte, inArray, lt } from 'drizzle-orm';
import { db as defaultDb, type DB } from '../db';
import { digestIssues, goingMarks } from '../db/schema';
import { liveDigestEvents } from '../digest/assemble';
import { isDigestSeal } from '../digest/select';
import type { DigestEvent } from '../digest/types';
import { publicEvents } from '../events/public-rows';
import { startOfKey, todayKeyPT } from '../format/calendar';

// F20: which events a going-alert run may mail (design G1, G2, A3). Everything is read live,
// uncached, through the same public path as the digest (events_public → redactForPublic →
// publicGoing), so an alert can only ever say what the site says right now:
//
//   a going mark with the alert switch on, made in [now − 7 days, today 00:00 PT)
//   → the event still published and still publicly going/hosting/speaking (not went), with the
//     attendance kill switch on → starting on or after tomorrow 00:00 PT (never a same-day alert)
//
// Day boundaries are Pacific midnights computed per date (startOfKey), so a 23- or 25-hour day at
// a DST change moves nothing.

/** How far back a run still picks up marks: a missed or capped day merges into the next run. */
export const LOOKBACK_MS = 7 * 864e5;

export type AlertWindow = {
  /** The run's Pacific day, YYYY-MM-DD: alert_sends.alert_day. */
  day: string;
  /** Oldest mark still alerted (now − 7 days). */
  since: Date;
  /** Today 00:00 PT: only marks made before it (a whole PT day of marks goes in one email). */
  cutoff: Date;
  /** Tomorrow 00:00 PT: the earliest start an alerted event may have. */
  startsFrom: Date;
};

export function alertWindow(now: Date): AlertWindow {
  const day = todayKeyPT(now);
  return { day, since: new Date(now.getTime() - LOOKBACK_MS), cutoff: startOfKey(day), startsFrom: startOfKey(day, 1) };
}

export type AlertPool = {
  /** The alertable events, by start time: public-safe email rows, each with a going/hosting/speaking seal. */
  events: DigestEvent[];
  cutoff: Date;
  /** When each of `events` was marked (the claim's "only marks after opting in" rule). */
  markedAt: ReadonlyMap<string, Date>;
};

type Opts = { db?: DB; now?: Date };

/**
 * A digest issue scheduled or sending with send_after on this Pacific day (G3): that day's alert
 * run sends no alerts (one newsletter email a day). The run's skip and recordGoingMark's 'digest'
 * verdict both read it.
 */
export async function digestIssueOn(day: string, db: DB = defaultDb): Promise<boolean> {
  return (await digestOn(day, db)) !== null;
}

/** The scheduled or sending digest issue whose send_after falls on this PT day, if any. */
export async function digestOn(day: string, db: DB = defaultDb): Promise<{ isoWeek: string; status: string; sendAfter: Date } | null> {
  const due = await db
    .select({ isoWeek: digestIssues.isoWeek, status: digestIssues.status, sendAfter: digestIssues.sendAfter })
    .from(digestIssues)
    .where(
      and(
        inArray(digestIssues.status, ['scheduled', 'sending']),
        gte(digestIssues.sendAfter, startOfKey(day)),
        lt(digestIssues.sendAfter, startOfKey(day, 1)),
      ),
    )
    .limit(1);
  const [d] = due;
  return d && d.sendAfter ? { isoWeek: d.isoWeek, status: d.status, sendAfter: d.sendAfter } : null;
}

/** Live email rows for these published events, kept only when they carry a seal and start late enough. */
async function alertable(ids: readonly string[], db: DB, now: Date): Promise<DigestEvent[]> {
  if (ids.length === 0) return [];
  const live = await publicEvents({ ids: [...new Set(ids)], statuses: ['published'], from: alertWindow(now).startsFrom, db });
  return (await liveDigestEvents(live, { db, at: now })).filter((e) => isDigestSeal(e.seal));
}

/** The live, alertable events for a run at `now` (the cron's claims, and the admin "next alert" card). */
export async function alertPool(opts: Opts = {}): Promise<AlertPool> {
  const db = opts.db ?? defaultDb;
  const now = opts.now ?? new Date();
  const w = alertWindow(now);
  const marks = await db
    .select({ eventId: goingMarks.eventId, markedAt: goingMarks.markedAt })
    .from(goingMarks)
    .where(and(eq(goingMarks.alert, true), gte(goingMarks.markedAt, w.since), lt(goingMarks.markedAt, w.cutoff)));
  const events = await alertable(
    marks.map((m) => m.eventId),
    db,
    now,
  );
  const at = new Map(marks.map((m) => [m.eventId, m.markedAt]));
  return { events, cutoff: w.cutoff, markedAt: new Map(events.map((e) => [e.id, at.get(e.id)!])) };
}

/**
 * The send-time re-check (A3): which of these claimed events may still be mailed now, as fresh
 * email rows. Same rules as the pool except the mark's age: an event claimed this morning stays
 * sendable while it is publicly going and its mark still has the alert on.
 */
export async function stillAlertable(ids: readonly string[], opts: Opts = {}): Promise<Map<string, DigestEvent>> {
  const db = opts.db ?? defaultDb;
  const now = opts.now ?? new Date();
  if (ids.length === 0) return new Map();
  const marked = await db
    .select({ eventId: goingMarks.eventId })
    .from(goingMarks)
    .where(and(inArray(goingMarks.eventId, [...new Set(ids)]), eq(goingMarks.alert, true)));
  const events = await alertable(
    marked.map((m) => m.eventId),
    db,
    now,
  );
  return new Map(events.map((e) => [e.id, e]));
}
