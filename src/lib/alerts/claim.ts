import 'server-only';
import { sql, type SQL } from 'drizzle-orm';
import { db as defaultDb, type DB } from '../db';
import { committedSince, eligible, EXPIRE_MS, evLangExpr, textArray, undeliveredDigest, utcDayStart } from '../digest/claim';
import { isOnlineish, langOf } from '../events/facets';
import { startOfKey } from '../format/calendar';
import type { Locale } from '../taxonomy';
import type { AlertPool } from './pool';

// Who gets a going alert today, claimed before anything is sent (design G1–G7, A1–A6), the same way
// the digest claims (digest/claim.ts): neon-http has no interactive transactions, so each write is
// one statement, and the claim is an INSERT … SELECT … ON CONFLICT DO NOTHING RETURNING on the
// (alert_day, subscriber_id) primary key. One row per reader per Pacific day carries every pending
// event for them (A1, A2), so however many runs race, nobody gets two alerts in a day. A reader is
// not claimed while an older alert of theirs is still waiting to be sent, nor after one went out
// earlier this Pacific day (an earlier day's group replayed this morning): at most one alert email
// per reader per PT day, whatever its alert_day; their new events merge into the next day's alert.
//
// A reader's events are the pool events (pool.ts: live, publicly going, marked before today) that
//   - are in their categories and pass their F19 facets (the digest's going-list rule, G4);
//   - were marked after they turned alerts on (going_alerts_since, else confirmed_at: G6);
//   - they were never sent, nor may have been sent: no alert row of theirs holds the event unless
//     its error proves it was never delivered (A6);
//   - weren't already shown to them with a seal in a digest that may have reached them (G3).
// At most 20, the soonest first; the rest wait for the next day. All times are the caller's clock.

export type AlertClaimed = {
  id: string;
  email: string;
  /** The subscriber's language now; the email follows variantKey, fixed at claim time. */
  locale: Locale;
  tokenVersion: number;
  /** The claimed events, sorted by id (the variant). */
  eventIds: string[];
  /** `<locale>:<sorted event ids>`: one render per distinct value. */
  variantKey: string;
};

/** Most events one alert carries (alert_sends check constraint). */
export const MAX_EVENTS = 20;

const rows = <T>(r: unknown): T[] => (r as { rows: T[] }).rows;
const ts = (d: Date) => sql`${d.toISOString()}::timestamptz`;
const day = (d: string) => sql`${d}::text`;

/**
 * Final alert errors that prove nothing was delivered, on alias `a`: rejected by the webhook
 * (failed:<reason>) or by Resend's validation, refused by Resend on a group's first attempt
 * (refused:<error name>, e.g. the daily quota: run.ts), never built, or held back because an event
 * stopped being alertable before a first attempt (unmarked). Its events may be alerted again. Every
 * other state (in flight, sent, expired, idem_conflict, id_mismatch, and the replay_… / ineligible
 * codes, whose first attempt may have gone out) keeps them from ever reaching that reader again.
 */
const UNDELIVERED = sql`(a.error like 'failed:%' or a.error like 'refused:%' or a.error in ('invalid', 'render_failed', 'too_large', 'unmarked'))`;

/** The alert audience on alias `s`: the digest's eligibility rule (G4/A4) and alerts switched on. */
function alertable(now: Date): SQL {
  return sql`${eligible(now)} and s.going_alerts`;
}

/** The pool as a VALUES list: one row per event with what the per-reader rules read. */
function poolValues(pool: AlertPool): SQL {
  return sql.join(
    pool.events.map(
      (e) =>
        sql`(${e.id}::text, ${e.category}::text, ${langOf(e.eventLanguage)}::text, ${isOnlineish(e.format)}::boolean, ${e.startAt}::timestamptz, ${ts(pool.markedAt.get(e.id)!)})`,
    ),
    sql`, `,
  );
}

/**
 * A digest only shows events of its covered week, which ends about 8 days after it is sent, and
 * pool events start tomorrow at the earliest: older issues can't hold one (G3 looks no further).
 */
const SEALED_LOOKBACK_MS = 14 * 864e5;

/**
 * CTEs `pool`, `sealed` and `cand` (each eligible reader who may get an alert today, and the pool
 * events they would get). A reader is left out with a row for today, an alert still waiting to be
 * sent or replayed (any day), or an alert sent since today 00:00 PT (an earlier day's group
 * replayed this morning): one alert email per PT day. Shared by the claim and the read-only
 * "anyone left?" check.
 */
function candidates(alertDay: string, pool: AlertPool, now: Date): SQL {
  const lang = evLangExpr(sql`s.ev_lang_pref`);
  return sql`
    pool(id, cat, lang, online, starts, marked_at) as (values ${poolValues(pool)}),
    sealed as (
      select d.subscriber_id, x.ev->>'id' as event_id
      from digest_sends d
      join digest_issues i on i.id = d.issue_id and i.send_after > ${ts(new Date(now.getTime() - SEALED_LOOKBACK_MS))}
      cross join lateral jsonb_array_elements(
        case when jsonb_typeof(i.snapshot->'events') = 'array' then i.snapshot->'events' else '[]'::jsonb end
      ) as x(ev)
      where d.kind = 'digest' and (d.error is null or not ${undeliveredDigest('d')})
        and i.snapshot->>'showAttendance' = 'true'
        and x.ev->>'seal' in ('going', 'hosting', 'speaking')
        and x.ev->>'id' in (select id from pool)
    ),
    cand as (
      select s.id, s.email, s.locale, s.token_version, s.confirmed_at,
        array(
          select q.id from (
            select p.id from pool p
            where p.cat = any(s.categories)
              and (${lang} is null or p.lang = ${lang} or p.lang = 'bilingual')
              and (s.online_only is not true or p.online)
              and p.marked_at >= coalesce(s.going_alerts_since, s.confirmed_at)
              and not exists (
                select 1 from alert_sends a
                where a.subscriber_id = s.id and a.event_ids @> array[p.id] and (a.error is null or not ${UNDELIVERED}))
              and not exists (select 1 from sealed z where z.subscriber_id = s.id and z.event_id = p.id)
            order by p.starts, p.id
            limit ${MAX_EVENTS}
          ) as q
          order by q.id collate "C"
        ) as event_ids
      from subscribers s
      where ${alertable(now)}
        and not exists (
          select 1 from alert_sends a
          where a.subscriber_id = s.id
            and (a.alert_day = ${day(alertDay)} or (a.resend_id is null and a.error is null) or a.sent_at >= ${ts(startOfKey(alertDay))}))
    )`;
}

/**
 * Claim up to `limit` readers who have pending events and no alert row today, oldest confirmation
 * first (overflow past the daily cap falls on the newest, whose events merge into tomorrow's
 * alert). Returns only the rows this call inserted.
 */
export async function claimAlerts(
  alertDay: string,
  pool: AlertPool,
  limit: number,
  batchKey: string,
  now: Date,
  db: DB = defaultDb,
): Promise<AlertClaimed[]> {
  if (limit <= 0 || pool.events.length === 0) return [];
  const r = await db.execute(sql`
    with ${candidates(alertDay, pool, now)},
    picked as materialized (
      select c.id, c.email, c.locale, c.token_version, c.event_ids from cand c
      where cardinality(c.event_ids) > 0
      order by c.confirmed_at asc nulls last, c.id
      limit ${Math.floor(limit)}
    ), ins as (
      insert into alert_sends (alert_day, subscriber_id, event_ids, variant_key, claimed_at, batch_key)
      select ${day(alertDay)}, p.id, p.event_ids, p.locale || ':' || array_to_string(p.event_ids, ','), ${ts(now)}, ${batchKey}::text
      from picked p
      on conflict do nothing
      returning subscriber_id, event_ids, variant_key
    )
    select p.id, p.email, p.locale, p.token_version as "tokenVersion", i.event_ids as "eventIds", i.variant_key as "variantKey"
    from ins i join picked p on p.id = i.subscriber_id
    order by p.id`);
  return rows<AlertClaimed>(r);
}

/** Whether a claim would find anyone (read-only; used when the daily cap is reached). */
export async function anyAlertClaimable(alertDay: string, pool: AlertPool, now: Date, db: DB = defaultDb): Promise<boolean> {
  if (pool.events.length === 0) return false;
  const [r] = rows<{ found: boolean }>(
    await db.execute(sql`with ${candidates(alertDay, pool, now)} select exists (select 1 from cand where cardinality(event_ids) > 0) as found`),
  );
  return Boolean(r?.found);
}

export type ReclaimedAlerts = { alertDay: string; batchKey: string; rows: AlertClaimed[]; ineligible: number };

const claimedCols = sql`s.id, s.email, s.locale, s.token_version as "tokenVersion", a.event_ids as "eventIds", a.variant_key as "variantKey"`;

/**
 * One whole stale group (claimed before `claimedBefore` and under 23 h ago, never sent, no error),
 * oldest first, skipping the batch keys in `skip` and, with `fromDay`, groups of an earlier
 * alert_day. `claimedBefore` is the replaying run's start: that run holds the newsletter lease
 * (longer than any run lives), so whatever was claimed before it belongs to a run that is over,
 * and a 15:xx run's leftovers are retried by the 16:xx run however close the two fire. Members
 * who unsubscribed, paused, were suppressed or turned alerts off since get error 'ineligible' (the
 * first attempt may have reached them) and are dropped; the rest are returned. claimed_at is left
 * as it was, so the 23 h expiry counts from the first attempt. Null when there is no stale group.
 */
export async function reclaimStaleAlerts(
  now: Date,
  claimedBefore: Date,
  db: DB = defaultDb,
  opts: { skip?: readonly string[]; fromDay?: string } = {},
): Promise<ReclaimedAlerts | null> {
  const expiredBefore = new Date(now.getTime() - EXPIRE_MS);
  const fromDay = opts.fromDay ? sql`and alert_day >= ${day(opts.fromDay)}` : sql``;
  const [group] = rows<{ batchKey: string; alertDay: string }>(
    await db.execute(sql`
      select batch_key as "batchKey", alert_day as "alertDay" from alert_sends
      where resend_id is null and error is null and batch_key is not null
        and claimed_at < ${ts(claimedBefore)} and claimed_at > ${ts(expiredBefore)}
        and not (batch_key = any(${textArray(opts.skip ?? [])})) ${fromDay}
      order by claimed_at, batch_key
      limit 1`),
  );
  if (!group) return null;
  const inGroup = sql`a.alert_day = ${day(group.alertDay)} and a.batch_key = ${group.batchKey}::text
    and a.resend_id is null and a.error is null and a.claimed_at < ${ts(claimedBefore)} and a.claimed_at > ${ts(expiredBefore)}
    and s.id = a.subscriber_id`;
  const gone = rows<{ subscriber_id: string }>(
    await db.execute(sql`
      update alert_sends a set error = 'ineligible' from subscribers s
      where ${inGroup} and not (${alertable(now)})
      returning a.subscriber_id`),
  );
  const back = rows<AlertClaimed>(await db.execute(sql`select ${claimedCols} from alert_sends a, subscribers s where ${inGroup} and ${alertable(now)}`));
  back.sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
  return { alertDay: group.alertDay, batchKey: group.batchKey, rows: back, ineligible: gone.length };
}

/** Unsent claims older than 23 h get error 'expired' (never replayed: Resend's idempotency key is gone). */
export async function expireOldAlerts(now: Date, db: DB = defaultDb): Promise<number> {
  const r = await db.execute(sql`
    update alert_sends set error = 'expired'
    where resend_id is null and error is null and claimed_at <= ${ts(new Date(now.getTime() - EXPIRE_MS))}
    returning subscriber_id`);
  return rows(r).length;
}

/** Record Resend's id per subscriber in one statement. Rows already marked are left alone. */
export async function markAlertsSent(
  alertDay: string,
  pairs: readonly { subscriberId: string; resendId: string }[],
  now: Date,
  db: DB = defaultDb,
): Promise<number> {
  if (pairs.length === 0) return 0;
  const values = sql.join(
    pairs.map((p) => sql`(${p.subscriberId}::text, ${p.resendId}::text)`),
    sql`, `,
  );
  const r = await db.execute(sql`
    update alert_sends a set resend_id = v.rid, sent_at = ${ts(now)}
    from (values ${values}) as v(sid, rid)
    where a.alert_day = ${day(alertDay)} and a.subscriber_id = v.sid and a.resend_id is null
    returning a.subscriber_id`);
  return rows(r).length;
}

/** Final error on these unsent, error-free rows of the day. */
export async function markAlertsError(alertDay: string, subscriberIds: readonly string[], error: string, db: DB = defaultDb): Promise<number> {
  if (subscriberIds.length === 0) return 0;
  const r = await db.execute(sql`
    update alert_sends set error = ${error}::text
    where alert_day = ${day(alertDay)} and subscriber_id = any(${textArray(subscriberIds)})
      and resend_id is null and error is null
    returning subscriber_id`);
  return rows(r).length;
}

/** Alert mail committed today (UTC day), the ALERT_DAILY_CAP count; sentTodayCount() is digest + alerts. */
export async function alertsTodayCount(now: Date, db: DB = defaultDb): Promise<number> {
  const [r] = rows<{ n: number }>(
    await db.execute(sql`select count(*)::int as n from alert_sends where ${committedSince(utcDayStart(now))}`),
  );
  return Number(r?.n ?? 0);
}

/** Resend webhook email.failed for an alert email: final, e.g. 'failed:reached_daily_quota'. */
export async function markAlertFailed(alertDay: string, subscriberId: string, reason: string, db: DB = defaultDb): Promise<number> {
  const safe = /^[a-z_]{1,40}$/.test(reason) ? reason : 'other';
  const r = await db.execute(sql`
    update alert_sends set error = ${`failed:${safe}`}::text
    where alert_day = ${day(alertDay)} and subscriber_id = ${subscriberId}::text and error is null
    returning subscriber_id`);
  return rows(r).length;
}
