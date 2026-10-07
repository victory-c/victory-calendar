import 'server-only';
import { and, eq, gte, sql } from 'drizzle-orm';
import { db as defaultDb, type DB } from '../db';
import { type events, goingMarks } from '../db/schema';
import { coverage } from '../digest/week';
import type { DigestSeal } from '../digest/types';
import { publicGoing } from '../events/going';
import { addDaysKey, startOfKey, todayKeyPT } from '../format/calendar';
import { alertsMode } from '../newsletter/status';
import { showAttendance } from '../settings';
import { isCategory } from '../taxonomy';
import { digestIssueOn, digestOn, LOOKBACK_MS } from './pool';

// F20 going alerts, the marking side (design G1, G5). When an admin action makes an event publicly
// going (setGoing, publish), the moment is recorded in going_marks; the daily alert cron (run.ts)
// mails what was marked before today 00:00 PT, re-checking every event live first. So nothing here
// has to undo anything: unmarking, hiding or unpublishing writes no mark, and the live re-check at
// claim and send time drops the event.

/** The admin event fields the public going rule reads (an AdminEvent or a row about to be written). */
export type AdminEventLike = Pick<
  typeof events.$inferSelect,
  'id' | 'status' | 'going' | 'goingVisibility' | 'category' | 'format' | 'privateVenue' | 'sourceUrl' | 'startAt' | 'endAt' | 'allDay'
>;

/**
 * What a save means for a going alert. queued: the next run that sends alerts will mail it.
 * digest: tomorrow is a digest day (its run sends no alerts) and the event starts the day after,
 * before the first day the following run alerts: the digest's going list carries it instead.
 * none: anything else (no new mark, switch off, sending off, attendance hidden, too soon).
 */
export type GoingAlertVerdict = 'queued' | 'none' | 'digest';

export type GoingMarkOpts = {
  /** Victor's "Alert subscribers" switch; on where no switch is shown. */
  alert: boolean;
  /**
   * The switch was really set by Victor (the editor's going form), not a default. Only then does
   * `alert: true` on an event that already is publicly going turn a declined alert back on.
   */
  explicit?: boolean;
  /**
   * A default-on path with no switch (publish): a new mark gets the alert on, but an existing mark
   * keeps its stored choice, so restoring a cancelled or archived event never revives a decline.
   */
  keepStored?: boolean;
};

/**
 * The seal an alert may carry: going / hosting / speaking when the event is published and
 * publicGoing() shows that seal now, ignoring the attendance kill switch (the cron checks it live).
 * Never `went` (the event is over), `interested`, after_event, hidden, cycling or a downgraded going.
 */
export function alertSeal(e: AdminEventLike, now: Date): DigestSeal | null {
  if (e.status !== 'published' || !e.startAt || !isCategory(e.category)) return null;
  const g = publicGoing({ ...e, category: e.category, startAt: e.startAt, status: 'published' }, now, true);
  return g.kind === 'seal' && g.seal !== 'went' ? g.seal : null;
}

/** The latest a day's run starts: its crons fire 15:00–16:59 UTC, before 10:00 PT in either season. */
const RUN_BY_MS = 10 * 3600_000;

/**
 * The next run that may send an alert for a mark saved at `now`: tomorrow's, or the day after's
 * when tomorrow is a digest day (that run sends none, G3). It alerts events starting from the day
 * after it, and marks no older than 7 days before it runs.
 */
async function nextSending(db: DB, now: Date) {
  const tomorrow = addDaysKey(todayKeyPT(now), 1);
  const digestTomorrow = await digestIssueOn(tomorrow, db);
  const day = digestTomorrow ? addDaysKey(tomorrow, 1) : tomorrow;
  return {
    digestTomorrow,
    /** The day after tomorrow 00:00 PT: what tomorrow's run would alert from, digest or not. */
    afterTomorrow: startOfKey(tomorrow, 1),
    startsFrom: startOfKey(day, 1),
    since: new Date(startOfKey(day).getTime() + RUN_BY_MS - LOOKBACK_MS),
  };
}

/**
 * A digest that hasn't frozen yet (send_after later today or tomorrow, still scheduled) and covers
 * this start: it will show the mark with its seal, and the next alert run then skips the event for
 * its readers (alerts/claim.ts), so the honest verdict is 'digest', not 'queued'.
 */
async function inUpcomingDigest(db: DB, now: Date, start: number) {
  const today = todayKeyPT(now);
  for (const day of [today, addDaysKey(today, 1)]) {
    const d = await digestOn(day, db);
    if (!d || d.status !== 'scheduled' || d.sendAfter.getTime() <= now.getTime()) continue;
    const c = coverage(d.isoWeek);
    if (start >= c.from.getTime() && start < c.to.getTime()) return true;
  }
  return false;
}

/** The verdict for a mark that is stored with the alert on (see GoingAlertVerdict). */
async function verdict(db: DB, after: AdminEventLike, now: Date, next?: Awaited<ReturnType<typeof nextSending>>): Promise<GoingAlertVerdict> {
  if (alertsMode() === 'off' || (await showAttendance()) !== true) return 'none';
  const n = next ?? (await nextSending(db, now));
  const start = after.startAt!.getTime();
  if (start < n.afterTomorrow.getTime()) return 'none';
  if (await inUpcomingDigest(db, now, start)) return 'digest';
  return start >= n.startsFrom.getTime() ? 'queued' : 'none';
}

/**
 * Records a going mark when `before` → `after` makes the event publicly going (alertSeal goes from
 * null to a seal): marked_at = now and Victor's per-mark switch, replacing any older mark (a
 * re-mark after an unmark starts over; an event already alerted to a reader is never sent to them
 * again, alerts/claim.ts). With `keepStored` (publish) an existing mark keeps its alert choice and
 * only gets the new time.
 *
 * A save that leaves it publicly going adds no mark. With the switch off it cancels a pending
 * alert. With the switch explicitly on it turns a declined alert back on, but only while the next
 * sending run still picks the mark up (7-day lookback) and no alert row holds the event yet (a
 * reader may already have it, or may be getting it now). A default-on save never undoes a decline.
 */
export async function recordGoingMark(
  db: DB,
  before: AdminEventLike,
  after: AdminEventLike,
  now: Date,
  opts: GoingMarkOpts,
): Promise<GoingAlertVerdict> {
  if (!alertSeal(after, now)) return 'none';
  if (alertSeal(before, now)) {
    if (!opts.alert) {
      await db
        .update(goingMarks)
        .set({ alert: false })
        .where(and(eq(goingMarks.eventId, after.id), eq(goingMarks.alert, true)));
      return 'none';
    }
    if (!opts.explicit) return 'none';
    const next = await nextSending(db, now);
    const back = await db
      .update(goingMarks)
      .set({ alert: true })
      .where(
        and(
          eq(goingMarks.eventId, after.id),
          eq(goingMarks.alert, false),
          gte(goingMarks.markedAt, next.since),
          sql`not exists (select 1 from alert_sends a where a.event_ids @> array[${goingMarks.eventId}])`,
        ),
      )
      .returning({ eventId: goingMarks.eventId });
    return back.length > 0 ? verdict(db, after, now, next) : 'none';
  }
  const [stored] = await db
    .insert(goingMarks)
    .values({ eventId: after.id, markedAt: now, alert: opts.alert })
    .onConflictDoUpdate({ target: goingMarks.eventId, set: opts.keepStored ? { markedAt: now } : { markedAt: now, alert: opts.alert } })
    .returning({ alert: goingMarks.alert });
  return stored?.alert ? verdict(db, after, now) : 'none';
}

/** The stored mark's alert switch, for the editor's going form (null: never marked publicly going). */
export async function getGoingMark(eventId: string, db: DB = defaultDb): Promise<{ alert: boolean } | null> {
  const [row] = await db.select({ alert: goingMarks.alert }).from(goingMarks).where(eq(goingMarks.eventId, eventId)).limit(1);
  return row ?? null;
}
