import 'server-only';
import { and, eq, inArray, isNull, sql, type SQL } from 'drizzle-orm';
import { db as defaultDb, type DB } from '../db';
import { digestSends } from '../db/schema';
import { EV_LANGS } from '../events/facets';
import { CATEGORY_SLUGS, type Locale } from '../taxonomy';
import type { PickCell } from './select';

// Who gets this issue, claimed before anything is sent (guide「digest 发送」, resend.md §5).
// neon-http has no interactive transactions, so every write here is one statement: the claim is
// an INSERT … SELECT … ON CONFLICT DO NOTHING RETURNING on the (issue_id, subscriber_id) primary
// key, which makes a second copy for the same subscriber impossible however many runs race. Rows
// claimed together share a batch_key and are retried together, so a retry repeats the same
// Resend idempotency key. All times are the caller's clock (passed in), never the database's.

export type ClaimKind = 'digest' | 'empty';

export type Claimed = {
  id: string;
  email: string;
  /** The subscriber's language now; the email itself follows variantKey, fixed at claim time. */
  locale: Locale;
  tokenVersion: number;
  categories: string[];
  variantKey: string;
  kind: ClaimKind;
};

/**
 * digest: eligible subscribers for whom this week has at least one pick: an event in one of their
 * categories that passes their F19 facets. `cells` are the week's (category, event language,
 * online) combinations (select.ts pickCells), the same events isEmptyFor() looks at.
 * empty: eligible subscribers with no such pick, who haven't had an empty notice claimed since
 * monthStart (first instant of the Pacific month: at most one "nothing this week" per month). A
 * claim whose error proves it was never delivered doesn't count (UNDELIVERED below).
 */
export type ClaimTarget =
  | { kind: 'digest'; cells: readonly PickCell[] }
  | { kind: 'empty'; cells: readonly PickCell[]; monthStart: Date };

/** A claim older than this with no resend_id belongs to a run that ended without marking it: longer than maxDuration (300 s). */
export const STALE_MS = 10 * 60_000;
/**
 * Resend keeps an idempotency key 24 h; past 23 h a replay could double-send, so the row expires
 * instead. Measured from claimed_at, which is written just before the group's first Resend call and
 * never changed afterwards (a replay does not re-stamp it), so it bounds the key's first use.
 */
export const EXPIRE_MS = 23 * 3600_000;

const rows = <T>(r: unknown): T[] => (r as { rows: T[] }).rows;
const ts = (d: Date) => sql`${d.toISOString()}::timestamptz`;

/** A text[] literal from bound params (a bare `${array}` would bind as a parenthesised list). */
export function textArray(xs: readonly string[]): SQL {
  return xs.length ? sql`array[${sql.join(xs.map((x) => sql`${x}`), sql`, `)}]::text[]` : sql`'{}'::text[]`;
}

const KNOWN = () => textArray(CATEGORY_SLUGS);

/**
 * The stored ev_lang_pref as the digest reads it, same as evLangOf() in events/facets.ts: its one
 * element when it has exactly one known value, else NULL (no preference).
 */
export function evLangExpr(pref: SQL): SQL {
  return sql`(case when cardinality(${pref}) = 1 and (${pref})[1] = any(${textArray(EV_LANGS)}) then (${pref})[1] end)`;
}

/**
 * Same string as variantKey() in ./variant.ts: locale, ':', known slugs de-duplicated and sorted
 * bytewise (collate "C" = JS default sort for ASCII), then the F19 suffixes ';l=<lang>' and ';o'
 * when set (a subscriber without facets gets the pre-F19 key). A test checks all 127 subsets × 2
 * locales, and every stored facet shape.
 */
export function variantKeyExpr(locale: SQL, categories: SQL, evLangPref: SQL = sql`null::text[]`, onlineOnly: SQL = sql`null::boolean`): SQL {
  return sql`(${locale} || ':' || array_to_string(array(select distinct u.c collate "C" from unnest(${categories}) as u(c) where u.c = any(${KNOWN()}) order by 1), ',')
    || coalesce(';l=' || ${evLangExpr(evLangPref)}, '') || (case when ${onlineOnly} is true then ';o' else '' end))`;
}

/**
 * On alias `s`: one of this week's cells is in the subscriber's categories and passes their facets.
 * The rule is matchesFacets() (events/facets.ts) in SQL: no language preference takes every event,
 * a bilingual event passes every preference, otherwise the languages must match; online-only takes
 * online and hybrid events (cell.online). One VALUES list of at most 42 rows, so the claim stays a
 * single statement.
 */
function hasPicks(cells: readonly PickCell[]): SQL {
  if (cells.length === 0) return sql`false`;
  const values = sql.join(
    cells.map((c) => sql`(${c.category}::text, ${c.lang}::text, ${c.online}::boolean)`),
    sql`, `,
  );
  const lang = evLangExpr(sql`s.ev_lang_pref`);
  return sql`exists (select 1 from (values ${values}) as p(cat, lang, online)
    where p.cat = any(s.categories)
      and (${lang} is null or p.lang = ${lang} or p.lang = 'bilingual')
      and (s.online_only is not true or p.online))`;
}

/**
 * The digest's audience rule, on alias `s` = subscribers: active, or paused with the pause over
 * (or never dated), with at least one known category. An expired pause counts as active
 * (prefs-view.ts). Requiring a known slug (not just cardinality > 0) keeps a corrupt row from
 * getting a variant key with no sections.
 */
function eligible(now: Date): SQL {
  return sql`(s.status = 'active' or (s.status = 'paused' and (s.paused_until is null or s.paused_until <= ${ts(now)}))) and s.categories && ${KNOWN()}`;
}

/**
 * Final errors that prove nothing was delivered: rejected by the webhook (failed:<reason>), never
 * built on a first attempt, or refused by Resend's validation. Every other state of an empty-notice
 * row still uses up the month's notice, so a reader never gets two in one month: in flight, sent, or
 * an outcome Resend may have delivered (expired, window_closed, id_mismatch, idem_conflict, and the
 * replay-only ineligible / replay_render_failed / replay_too_large / replay_no_picks, whose first
 * attempt may have gone out).
 */
const UNDELIVERED = sql`(e.error like 'failed:%' or e.error in ('render_failed', 'too_large', 'no_picks', 'invalid'))`;

/** On alias `s`: the subscriber already had (or may have had) an empty notice since monthStart. */
function hadEmptyNotice(monthStart: Date): SQL {
  return sql`exists (
    select 1 from digest_sends e where e.subscriber_id = s.id and e.kind = 'empty' and e.claimed_at >= ${ts(monthStart)}
      and (e.error is null or not ${UNDELIVERED}))`;
}

function audience(issueId: string, target: ClaimTarget, now: Date): SQL {
  const picks = hasPicks(target.cells);
  const match = target.kind === 'digest' ? picks : sql`not ${picks} and not ${hadEmptyNotice(target.monthStart)}`;
  return sql`${eligible(now)} and ${match}
    and not exists (select 1 from digest_sends d where d.issue_id = ${issueId}::text and d.subscriber_id = s.id)`;
}

/**
 * Claim up to `limit` subscribers who have no row for this issue yet, oldest confirmation first
 * (overflow past the daily cap falls on the newest). Returns only the rows this call inserted.
 */
export async function claimFresh(
  issueId: string,
  target: ClaimTarget,
  limit: number,
  batchKey: string,
  now: Date,
  db: DB = defaultDb,
): Promise<Claimed[]> {
  if (limit <= 0 || (target.kind === 'digest' && target.cells.length === 0)) return [];
  const r = await db.execute(sql`
    with picked as materialized (
      select s.id, s.email, s.locale, s.token_version, s.categories, s.ev_lang_pref, s.online_only
      from subscribers s
      where ${audience(issueId, target, now)}
      order by s.confirmed_at asc nulls last, s.id
      limit ${Math.floor(limit)}
    ), ins as (
      insert into digest_sends (issue_id, subscriber_id, variant_key, claimed_at, kind, batch_key)
      select ${issueId}::text, p.id, ${variantKeyExpr(sql`p.locale`, sql`p.categories`, sql`p.ev_lang_pref`, sql`p.online_only`)}, ${ts(now)}, ${target.kind}::text, ${batchKey}::text
      from picked p
      on conflict do nothing
      returning subscriber_id, variant_key, kind
    )
    select p.id, p.email, p.locale, p.token_version as "tokenVersion", p.categories, i.variant_key as "variantKey", i.kind
    from ins i join picked p on p.id = i.subscriber_id
    order by p.id`);
  return rows<Claimed>(r);
}

/** Whether a claim for any of these targets would find someone (read-only; used when the daily cap is reached). */
export async function anyClaimable(issueId: string, targets: readonly ClaimTarget[], now: Date, db: DB = defaultDb): Promise<boolean> {
  for (const target of targets) {
    if (target.kind === 'digest' && target.cells.length === 0) continue;
    const [r] = rows<{ found: boolean }>(
      await db.execute(sql`select exists (select 1 from subscribers s where ${audience(issueId, target, now)}) as found`),
    );
    if (r?.found) return true;
  }
  return false;
}

export type Reclaimed = { batchKey: string; rows: Claimed[]; ineligible: number };

/**
 * One whole stale group (claimed 10 min – 23 h ago, never sent, no error), oldest first, skipping
 * the batch keys in `skip` (groups this run already handled). Members who unsubscribed, paused or
 * were suppressed since get error 'ineligible' and are dropped for good; the rest are returned.
 * claimed_at is left as it was: the 23 h expiry must keep counting from the group's first Resend
 * call, not from the latest replay. Nothing here guards against two runners taking the same group;
 * the run lease (run.ts) lets only one runner work at a time. Null when there is no stale group.
 */
export async function reclaimStale(
  issueId: string,
  now: Date,
  db: DB = defaultDb,
  skip: readonly string[] = [],
): Promise<Reclaimed | null> {
  const staleBefore = new Date(now.getTime() - STALE_MS);
  const expiredBefore = new Date(now.getTime() - EXPIRE_MS);
  const [group] = rows<{ batchKey: string }>(
    await db.execute(sql`
      select batch_key as "batchKey" from digest_sends
      where issue_id = ${issueId}::text and resend_id is null and error is null and batch_key is not null
        and claimed_at < ${ts(staleBefore)} and claimed_at > ${ts(expiredBefore)}
        and not (batch_key = any(${textArray(skip)}))
      order by claimed_at, batch_key
      limit 1`),
  );
  if (!group) return null;
  const inGroup = sql`d.issue_id = ${issueId}::text and d.batch_key = ${group.batchKey}::text
    and d.resend_id is null and d.error is null and d.claimed_at < ${ts(staleBefore)} and d.claimed_at > ${ts(expiredBefore)}
    and s.id = d.subscriber_id`;
  const gone = rows<{ subscriber_id: string }>(
    await db.execute(sql`
      update digest_sends d set error = 'ineligible' from subscribers s
      where ${inGroup} and not (${eligible(now)})
      returning d.subscriber_id`),
  );
  const back = rows<Claimed>(
    await db.execute(sql`
      select s.id, s.email, s.locale, s.token_version as "tokenVersion", s.categories, d.variant_key as "variantKey", d.kind
      from digest_sends d, subscribers s
      where ${inGroup} and ${eligible(now)}`),
  );
  back.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { batchKey: group.batchKey, rows: back, ineligible: gone.length };
}

/** Unsent claims older than 23 h get error 'expired' (shown in admin; never replayed). */
export async function expireOld(issueId: string, now: Date, db: DB = defaultDb): Promise<number> {
  const r = await db.execute(sql`
    update digest_sends set error = 'expired'
    where issue_id = ${issueId}::text and resend_id is null and error is null
      and claimed_at <= ${ts(new Date(now.getTime() - EXPIRE_MS))}
    returning subscriber_id`);
  return rows(r).length;
}

/** Record Resend's id per subscriber in one statement. Rows already marked are left alone. */
export async function markSent(
  issueId: string,
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
    update digest_sends d set resend_id = v.rid, sent_at = ${ts(now)}
    from (values ${values}) as v(sid, rid)
    where d.issue_id = ${issueId}::text and d.subscriber_id = v.sid and d.resend_id is null
    returning d.subscriber_id`);
  return rows(r).length;
}

export type ErrorTarget = readonly string[] | { batchKey: string } | { allUnsent: true };
const isIds = (t: ErrorTarget): t is readonly string[] => Array.isArray(t);

/** Final error on unsent, error-free rows: by subscriber ids, by batch, or every unsent row of the issue. */
export async function markError(issueId: string, target: ErrorTarget, error: string, db: DB = defaultDb): Promise<number> {
  let which: SQL | undefined;
  if (isIds(target)) {
    if (target.length === 0) return 0;
    which = inArray(digestSends.subscriberId, [...target]);
  } else if ('batchKey' in target) {
    which = eq(digestSends.batchKey, target.batchKey);
  }
  const r = await db
    .update(digestSends)
    .set({ error })
    .where(and(eq(digestSends.issueId, issueId), which, isNull(digestSends.resendId), isNull(digestSends.error)))
    .returning({ id: digestSends.subscriberId });
  return r.length;
}

/**
 * Digest mail committed today (UTC day, the Resend quota day): rows sent since 00:00 UTC plus
 * claims made since then that are still waiting to be sent or replayed. Counting the waiting ones
 * keeps a run from claiming more on top of a group that a later run will retry.
 */
export async function sentTodayCount(now: Date, db: DB = defaultDb): Promise<number> {
  const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const [r] = rows<{ n: number }>(
    await db.execute(sql`
      select count(*)::int as n from digest_sends
      where sent_at >= ${ts(day)} or (resend_id is null and error is null and claimed_at >= ${ts(day)})`),
  );
  return Number(r?.n ?? 0);
}

/** Eligible subscribers left out this issue because they already had this month's empty notice (same rule as the claim). */
export async function countSkippedEmpty(
  issueId: string,
  cells: readonly PickCell[],
  monthStart: Date,
  now: Date,
  db: DB = defaultDb,
): Promise<number> {
  const [r] = rows<{ n: number }>(
    await db.execute(sql`
      select count(*)::int as n from subscribers s
      where ${eligible(now)} and not ${hasPicks(cells)}
        and not exists (select 1 from digest_sends d where d.issue_id = ${issueId}::text and d.subscriber_id = s.id)
        and ${hadEmptyNotice(monthStart)}`),
  );
  return Number(r?.n ?? 0);
}

/** Resend webhook email.failed for a digest email: final, e.g. 'failed:reached_daily_quota'. */
export async function markFailed(issueId: string, subscriberId: string, reason: string, db: DB = defaultDb): Promise<number> {
  const safe = /^[a-z_]{1,40}$/.test(reason) ? reason : 'other';
  const r = await db
    .update(digestSends)
    .set({ error: `failed:${safe}` })
    .where(and(eq(digestSends.issueId, issueId), eq(digestSends.subscriberId, subscriberId), isNull(digestSends.error)))
    .returning({ id: digestSends.subscriberId });
  return r.length;
}
