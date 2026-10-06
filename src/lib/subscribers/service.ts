import 'server-only';
import { and, eq, inArray, lt, sql } from 'drizzle-orm';
import type { PgUpdateSetSource } from 'drizzle-orm/pg-core';
import { z } from 'zod';
import { db as defaultDb, type DB } from '../db';
import { alertSends, digestSends, jobsLog, subscribers } from '../db/schema';
import { EXPIRE_MS } from '../digest/claim';
import { type EvLang, facetColumns, type Facets, facetsOf, NO_FACETS } from '../events/facets';
import { newId } from '../ids';
import { type Category, CATEGORY_SLUGS, type Locale } from '../taxonomy';
import { tokenId, verifyToken } from './token';

// Every subscriber state change (guide「订阅到退订的流程」). Each write is one statement so it is
// safe on neon-http (no interactive transactions) and idempotent under retries and double clicks.
//
//   pending ──confirm──▶ active ◀──resume── paused
//      │                   │ ╲──pause──────▶ │
//      └──── unsubscribe ──┴──────────────────┴──▶ unsubscribed ──resubscribe──▶ active / pending
//   any ──bounce or complaint──▶ suppressed (terminal: never mailed again)
//   unsubscribed ──365 days──▶ deleted (retention cron); any ──admin Delete──▶ deleted (week 15)
//
// unsubscribed_at is the time of the last opt-out and survives a later return (form + confirm, or
// "Subscribe again"); status says whether they are opted out now. consent_* is the latest consent.
//
// F20 going alerts are a second, optional list on the same row: going_alerts says whether it is on,
// going_alerts_since when the current opt-in began (NULL while off). The alert claim only takes marks
// made after it, so switching alerts on, a new sign-up request and "Subscribe again" never bring old
// marks along. Turning alerts off (prefs, /unsubscribe?list=going, the one-click POST) never touches
// the weekly email.

export type Subscriber = typeof subscribers.$inferSelect;
type Opts = { db?: DB; now?: Date };

const DAY = 864e5;
/** A timestamp parameter for raw SQL (a CASE branch has no column type to infer it from). */
const ts = (d: Date) => sql`${d.toISOString()}::timestamptz`;
/** Guide: unconfirmed sign-ups are deleted after 7 days; a confirm link older than that is expired. */
export const PENDING_TTL_MS = 7 * DAY;
/** Prefs「暂停 4 周」. */
export const PAUSE_MS = 28 * DAY;

const Email = z.email().max(254);

/** Trimmed, lowercased address, or null when it isn't one. One rule for the form, limits and webhook. */
export function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const email = raw.trim().toLowerCase();
  return Email.safeParse(email).success ? email : null;
}

/**
 * The key for per-address limits: one bucket per inbox, not per spelling. A '+tag' is dropped for
 * every domain and dots for Gmail, so victim+1@gmail.com and v.ictim@gmail.com share victim's
 * 3-a-day budget. Only ever used as a limit key; the address is stored and mailed as typed.
 */
export function inboxKey(email: string): string {
  const at = email.lastIndexOf('@');
  if (at < 1) return email;
  let local = email.slice(0, at).split('+')[0] || email.slice(0, at);
  let domain = email.slice(at + 1);
  if (domain === 'googlemail.com') domain = 'gmail.com';
  if (domain === 'gmail.com') local = local.replace(/\./g, '');
  return `${local}@${domain}`;
}

/** Known slugs in canonical order, duplicates dropped. */
export function cleanCategories(raw: readonly unknown[]): Category[] {
  const set = new Set(raw.filter((c): c is Category => typeof c === 'string' && (CATEGORY_SLUGS as readonly string[]).includes(c)));
  return CATEGORY_SLUGS.filter((c) => set.has(c));
}

export type SubscribeInput = {
  email: string;
  locale: Locale;
  categories: Category[];
  /** F19 event-language / online-only choice carried in from a feed menu (none when omitted). */
  facets?: Facets;
  /**
   * F20 going alerts checkbox. Undefined when the form didn't show it (alerts off on this
   * deployment): a new row starts with alerts off, a re-armed row keeps its stored choice.
   */
  goingAlerts?: boolean;
  ip: string | null;
  ua: string | null;
  source: string;
};

export type SubscribeOutcome =
  /** New or re-requested sign-up: send the confirmation email. */
  | { kind: 'confirm'; sub: Subscriber }
  /** Already active or paused: nothing changes; we may mail them their preferences link. */
  | { kind: 'already'; sub: Subscriber }
  /** Suppressed (bounced or complained): never mail again. */
  | { kind: 'none' };

/**
 * The form's only write. New address → pending; a pending or unsubscribed row is re-armed with the
 * new choices (categories and facets) and consent record; active, paused and suppressed rows are
 * left alone. The caller shows the same "check your inbox" state in every case, so the form can't
 * reveal who subscribed.
 * Re-arming keeps confirmed_at and unsubscribed_at: a former subscriber's history (and their
 * digest_sends rows) must survive an unconfirmed re-request, which the purge then reverts.
 * Re-arming a row that is still pending bumps token_version: the confirmation email already sent
 * described the earlier choices, so only the one sent for this request can confirm (its link is
 * built from the returned row). An unsubscribed row keeps its version, so the links in a former
 * subscriber's past emails keep working.
 */
export async function requestSubscription(input: SubscribeInput, opts: Opts = {}): Promise<SubscribeOutcome> {
  const db = opts.db ?? defaultDb;
  const now = opts.now ?? new Date();
  const consent = {
    locale: input.locale,
    categories: input.categories,
    ...facetColumns(input.facets ?? NO_FACETS),
    consentAt: now,
    consentIp: input.ip,
    consentUa: input.ua?.slice(0, 512) ?? null,
    consentSource: input.source.slice(0, 64),
  };
  const alerts = input.goingAlerts === true;
  const [row] = await db
    .insert(subscribers)
    .values({
      id: newId('sub'), email: input.email, status: 'pending', createdAt: now, ...consent,
      goingAlerts: alerts, goingAlertsSince: alerts ? now : null,
    })
    .onConflictDoUpdate({
      target: subscribers.email,
      set: {
        ...consent,
        status: 'pending',
        pausedUntil: null,
        tokenVersion: sql`case when ${subscribers.status} = 'pending' then ${subscribers.tokenVersion} + 1 else ${subscribers.tokenVersion} end`,
        // A re-request is a new consent: alerts that stay on count from now, like a new opt-in.
        ...(input.goingAlerts === undefined
          ? { goingAlertsSince: sql`case when ${subscribers.goingAlerts} then ${ts(now)} end` }
          : { goingAlerts: alerts, goingAlertsSince: alerts ? now : null }),
      },
      setWhere: inArray(subscribers.status, ['pending', 'unsubscribed']),
    })
    .returning();
  if (row) return { kind: 'confirm', sub: row };
  const [existing] = await db.select().from(subscribers).where(eq(subscribers.email, input.email));
  if (existing && (existing.status === 'active' || existing.status === 'paused')) return { kind: 'already', sub: existing };
  return { kind: 'none' };
}

/** The row a link token names, when its signature matches the row's current token_version. */
export async function subscriberFromToken(token: string | null | undefined, opts: Opts = {}): Promise<Subscriber | null> {
  const db = opts.db ?? defaultDb;
  const id = tokenId(token);
  if (!id || !token) return null;
  const [row] = await db.select().from(subscribers).where(eq(subscribers.id, id));
  return row && verifyToken(token, row) ? row : null;
}

export type ConfirmResult = { result: 'confirmed' | 'already' | 'expired' | 'invalid'; sub: Subscriber | null };

/** GET /confirm/[token]: pending → active. Safe to repeat; an old or reused link never re-subscribes anyone. */
export async function confirmSubscription(token: string, opts: Opts = {}): Promise<ConfirmResult> {
  const db = opts.db ?? defaultDb;
  const now = opts.now ?? new Date();
  const sub = await subscriberFromToken(token, { db });
  if (!sub || sub.status === 'suppressed') return { result: 'invalid', sub: null };
  if (sub.status === 'active' || sub.status === 'paused') return { result: 'already', sub };
  if (sub.status === 'unsubscribed') return { result: 'expired', sub };
  const fresh = new Date(now.getTime() - PENDING_TTL_MS);
  const [row] = await db
    .update(subscribers)
    .set({ status: 'active', confirmedAt: now })
    .where(and(eq(subscribers.id, sub.id), eq(subscribers.status, 'pending'), sql`${subscribers.consentAt} > ${fresh}`))
    .returning();
  if (row) return { result: 'confirmed', sub: row };
  // Lost a race with another click, or the 7 days are up.
  const [again] = await db.select().from(subscribers).where(eq(subscribers.id, sub.id));
  if (again && (again.status === 'active' || again.status === 'paused')) return { result: 'already', sub: again };
  return { result: 'expired', sub: again ?? sub };
}

const editable = ['pending', 'active', 'paused'] as const;

async function update(db: DB, id: string, from: readonly Subscriber['status'][], set: PgUpdateSetSource<typeof subscribers>) {
  const [row] = await db
    .update(subscribers)
    .set(set)
    .where(and(eq(subscribers.id, id), inArray(subscribers.status, [...from])))
    .returning();
  return row ?? null;
}

/**
 * Prefs: language, categories, (F19) facets and (F20) going alerts. Picking no category at all is
 * the same as unsubscribing; alerts unticked in that same save are switched off in the same
 * statement, so "Subscribe again" doesn't bring them back (alerts ticked there aren't switched on:
 * the reader just left everything). `facets` or `goingAlerts` left undefined keeps the stored
 * value (the one-tap language switch, or a page that didn't show the control). Switching alerts
 * on stamps going_alerts_since; saving with them already on keeps it, read from the row as it is
 * now, so a second tab or a double click can't move it.
 */
export async function updatePreferences(
  sub: Subscriber,
  prefs: { locale: Locale; categories: Category[]; facets?: Facets; goingAlerts?: boolean },
  opts: Opts = {},
) {
  const db = opts.db ?? defaultDb;
  const now = opts.now ?? new Date();
  if (prefs.categories.length === 0) {
    const set = { ...unsubscribed(now), ...(prefs.goingAlerts === false ? alertColumns(false, now) : {}) };
    return (await update(db, sub.id, editable, set)) ?? sub;
  }
  const set = {
    locale: prefs.locale,
    categories: prefs.categories,
    ...(prefs.facets ? facetColumns(prefs.facets) : {}),
    ...(prefs.goingAlerts === undefined ? {} : alertColumns(prefs.goingAlerts, now)),
  };
  return (await update(db, sub.id, editable, set)) ?? sub;
}

/** going_alerts / going_alerts_since for a choice: on keeps a running opt-in's start, off clears it. */
function alertColumns(on: boolean, now: Date) {
  return on
    ? { goingAlerts: true, goingAlertsSince: sql`case when ${subscribers.goingAlerts} then ${subscribers.goingAlertsSince} else ${ts(now)} end` }
    : { goingAlerts: false, goingAlertsSince: null };
}

/**
 * F20: going alerts off, nothing else (/api/unsubscribe?list=going one-click, the /unsubscribe
 * page's button). Idempotent; works on unsubscribed rows too (so "Subscribe again" doesn't bring
 * them back); suppressed rows are left alone.
 */
export async function disableGoingAlerts(sub: Subscriber, opts: Opts = {}) {
  const db = opts.db ?? defaultDb;
  return (await update(db, sub.id, [...editable, 'unsubscribed'], { goingAlerts: false, goingAlertsSince: null })) ?? sub;
}

export async function pauseSubscription(sub: Subscriber, opts: Opts = {}) {
  const db = opts.db ?? defaultDb;
  const now = opts.now ?? new Date();
  return (await update(db, sub.id, ['active', 'paused'], { status: 'paused', pausedUntil: new Date(now.getTime() + PAUSE_MS) })) ?? sub;
}

export async function resumeSubscription(sub: Subscriber, opts: Opts = {}) {
  const db = opts.db ?? defaultDb;
  return (await update(db, sub.id, ['paused'], { status: 'active', pausedUntil: null })) ?? sub;
}

/**
 * Drop one category; dropping the last one unsubscribes (and keeps it, so resubscribing restores
 * it). One statement computed from the row as it is now, so two tabs stopping different
 * categories at once can't each write back a stale list.
 */
export async function unsubscribeCategory(sub: Subscriber, category: Category, opts: Opts = {}) {
  const db = opts.db ?? defaultDb;
  const now = opts.now ?? new Date();
  const rest = sql`array_remove(${subscribers.categories}, ${category})`;
  const last = sql`cardinality(${rest}) = 0`;
  const [row] = await db
    .update(subscribers)
    .set({
      categories: sql`case when ${last} then ${subscribers.categories} else ${rest} end`,
      status: sql`case when ${last} then 'unsubscribed' else ${subscribers.status} end`,
      unsubscribedAt: sql`case when ${last} then ${now} else ${subscribers.unsubscribedAt} end`,
      pausedUntil: sql`case when ${last} then null else ${subscribers.pausedUntil} end`,
    })
    .where(
      and(eq(subscribers.id, sub.id), inArray(subscribers.status, [...editable]), sql`${category} = any(${subscribers.categories})`),
    )
    .returning();
  return row ?? sub;
}

/** The columns of an opt-out from everything. */
const unsubscribed = (now: Date) => ({ status: 'unsubscribed' as const, unsubscribedAt: now, pausedUntil: null });

/** One-click and manual unsubscribe. Repeating it changes nothing and still succeeds. */
export async function unsubscribeAll(sub: Subscriber, opts: Opts = {}) {
  const db = opts.db ?? defaultDb;
  const now = opts.now ?? new Date();
  return (await update(db, sub.id, editable, unsubscribed(now))) ?? sub;
}

export type Consent = { ip: string | null; ua: string | null; source: string };

/**
 * From an unsubscribed row's preferences link. Holding the link proves the inbox is theirs, so a
 * previously confirmed address goes straight back to active; one that never confirmed goes back
 * to pending and gets a fresh confirmation email (`needsConfirm`). Suppressed rows can't come back.
 * Either way the new consent (time, IP, user agent, page) replaces the old one; unsubscribed_at is
 * kept, so the row still shows the opt-out that came before it. Going alerts keep their setting and,
 * when on, restart from now.
 */
export async function resubscribe(sub: Subscriber, consent: Consent, opts: Opts = {}): Promise<{ sub: Subscriber; needsConfirm: boolean }> {
  const db = opts.db ?? defaultDb;
  const now = opts.now ?? new Date();
  const categories = sub.categories.length ? sub.categories : [...CATEGORY_SLUGS];
  const record = {
    categories,
    consentAt: now,
    consentIp: consent.ip,
    consentUa: consent.ua?.slice(0, 512) ?? null,
    consentSource: consent.source.slice(0, 64),
    // Going alerts come back as they were, counting from now: no marks from while they were away.
    goingAlertsSince: sql`case when ${subscribers.goingAlerts} then ${ts(now)} end`,
  };
  if (sub.confirmedAt) {
    const row = await update(db, sub.id, ['unsubscribed'], { ...record, status: 'active' });
    return { sub: row ?? sub, needsConfirm: false };
  }
  const row = await update(db, sub.id, ['unsubscribed'], { ...record, status: 'pending' });
  return { sub: row ?? sub, needsConfirm: Boolean(row) };
}

/** Resend webhook: hard bounces and complaints. Matches on the normalised address. */
export async function suppressEmails(emails: readonly string[], opts: Opts = {}) {
  const db = opts.db ?? defaultDb;
  const list = [...new Set(emails.map((e) => normalizeEmail(e)).filter((e): e is string => Boolean(e)))];
  if (list.length === 0) return 0;
  const rows = await db
    .update(subscribers)
    .set({ status: 'suppressed', pausedUntil: null })
    .where(and(inArray(subscribers.email, list), sql`${subscribers.status} <> 'suppressed'`))
    .returning({ id: subscribers.id });
  return rows.length;
}

/**
 * Daily cron (guide「待确认」row): a sign-up left unconfirmed for 7 days is deleted. A former
 * subscriber whose re-request went unconfirmed is not a stranger's address: it goes back to
 * unsubscribed, keeping its history and the digest_sends / alert_sends rows that reference it
 * (which would also make a DELETE fail). Going alerts are switched off there: the unconfirmed
 * request may have switched them on (anyone can type the address), and "Subscribe again" must not
 * start a list nobody confirmed; the reader can tick them again on /prefs. Two single statements,
 * so it is safe on neon-http and idempotent.
 */
export async function purgeStalePending(opts: Opts = {}) {
  const db = opts.db ?? defaultDb;
  const now = opts.now ?? new Date();
  const stale = and(eq(subscribers.status, 'pending'), lt(subscribers.consentAt, new Date(now.getTime() - PENDING_TTL_MS)));
  const reverted = await db
    .update(subscribers)
    .set({ status: 'unsubscribed', unsubscribedAt: sql`coalesce(${subscribers.unsubscribedAt}, ${now})`, goingAlerts: false, goingAlertsSince: null })
    .where(and(stale, sql`${subscribers.confirmedAt} is not null`))
    .returning({ id: subscribers.id });
  const deleted = await db
    .delete(subscribers)
    .where(
      and(
        stale,
        sql`${subscribers.confirmedAt} is null`,
        sql`not exists (select 1 from ${digestSends} where ${digestSends.subscriberId} = ${subscribers.id})`,
        sql`not exists (select 1 from ${alertSends} where ${alertSends.subscriberId} = ${subscribers.id})`,
      ),
    )
    .returning({ id: subscribers.id });
  return { deleted: deleted.length, reverted: reverted.length };
}

/** What a preferences page may show. Never the email address (PRD「不暴露邮箱」). */
export type SubscriberView = {
  status: Subscriber['status'];
  locale: Locale;
  categories: Category[];
  /** F19 facets as the digest reads them (a malformed stored value shows as none). */
  evLang: EvLang | null;
  onlineOnly: boolean;
  /** F20: emailed when Victor marks an event as going. */
  goingAlerts: boolean;
  pausedUntil: string | null;
};

export function viewOf(sub: Subscriber): SubscriberView {
  return {
    status: sub.status,
    locale: sub.locale,
    categories: cleanCategories(sub.categories),
    ...facetsOf(sub),
    goingAlerts: sub.goingAlerts,
    pausedUntil: sub.pausedUntil?.toISOString() ?? null,
  };
}

const SUBSCRIBER_ID = /^sub_[0-9a-z]{16}$/;

/**
 * Resend webhook, digest emails: the same suppression by subscriber id (the email's `sub` tag),
 * an exact primary-key match that doesn't depend on how the provider spells the address.
 */
export async function suppressSubscriberIds(ids: readonly string[], opts: Opts = {}) {
  const db = opts.db ?? defaultDb;
  const list = [...new Set(ids.filter((id) => typeof id === 'string' && SUBSCRIBER_ID.test(id)))];
  if (list.length === 0) return 0;
  const rows = await db
    .update(subscribers)
    .set({ status: 'suppressed', pausedUntil: null })
    .where(and(inArray(subscribers.id, list), sql`${subscribers.status} <> 'suppressed'`))
    .returning({ id: subscribers.id });
  return rows.length;
}

const resultRows = <T>(r: unknown): T[] => (r as { rows: T[] }).rows;
/**
 * The row (alias `s`) has a claim not yet resolved that can still be sent: the digest or the going
 * alert may be mailing it right now (digest/claim.ts, alerts/claim.ts). A claim older than
 * EXPIRE_MS is never sent or replayed (the Resend idempotency key has lapsed), so it doesn't count
 * even before a run marks it 'expired': a run that stopped early, or alerts switched off, must not
 * block a deletion or the retention purge for good.
 */
const inFlight = (now: Date) => {
  const live = ts(new Date(now.getTime() - EXPIRE_MS));
  return sql`(exists (select 1 from ${digestSends} d where d.subscriber_id = s.id and d.resend_id is null and d.error is null and d.claimed_at > ${live})
  or exists (select 1 from ${alertSends} a where a.subscriber_id = s.id and a.resend_id is null and a.error is null and a.claimed_at > ${live}))`;
};

/** The pg error code of a driver error, or of the one a Drizzle error wraps ('23503' = foreign key). */
function pgCode(e: unknown): string | null {
  const code = (e as { cause?: { code?: unknown } })?.cause?.code ?? (e as { code?: unknown })?.code;
  return typeof code === 'string' ? code : null;
}

export type DeleteResult = {
  result: 'deleted' | 'not_found' | 'in_flight' | 'suppressed';
  /** Send records deleted with the subscriber: digest_sends plus (F20) alert_sends rows. */
  sends: number;
};

/**
 * /admin/subscribers「Delete」(DESIGN D2): the subscriber row, its digest_sends and alert_sends
 * history and the `admin_delete` audit row (id only), in ONE statement. The subscriber goes first
 * and its sends are deleted from that delete's RETURNING, so a row that stays keeps its history; the
 * send tables' foreign keys are NO ACTION, checked at the end of the statement, once all deletes are
 * done. Refused while a claim is in flight (the digest or an alert may be mailing them right now)
 * and, unless `allowSuppressed`, for a suppressed row, since deleting it drops the do-not-send block
 * too. A claim that lands between the snapshot and the delete fails a foreign key: also "in flight".
 */
export async function deleteSubscriber(id: string, opts: Opts & { allowSuppressed?: boolean } = {}): Promise<DeleteResult> {
  const db = opts.db ?? defaultDb;
  const now = opts.now ?? new Date();
  if (typeof id !== 'string' || !SUBSCRIBER_ID.test(id)) return { result: 'not_found', sends: 0 };
  const allow = opts.allowSuppressed === true;
  let out: { deleted: number; sends: number } | undefined;
  try {
    [out] = resultRows<{ deleted: number; sends: number }>(
      await db.execute(sql`
        with gone as (
          delete from ${subscribers} s
          where s.id = ${id} ${allow ? sql`` : sql`and s.status <> 'suppressed'`} and not ${inFlight(now)}
          returning s.id
        ),
        sends as (delete from ${digestSends} where subscriber_id in (select id from gone) returning 1),
        alerts as (delete from ${alertSends} where subscriber_id in (select id from gone) returning 1),
        audit as (
          insert into ${jobsLog} (job, started_at, finished_at, ok, detail)
          select 'admin_delete', ${ts(now)}, ${ts(now)}, true, jsonb_build_object('id', id) from gone
          returning 1
        )
        select (select count(*) from gone)::int as deleted,
          ((select count(*) from sends) + (select count(*) from alerts))::int as sends`),
    );
  } catch (e) {
    if (pgCode(e) === '23503') return { result: 'in_flight', sends: 0 };
    throw e;
  }
  if (out && Number(out.deleted) > 0) return { result: 'deleted', sends: Number(out.sends) };
  // Nothing deleted: say why (a read, so it needn't be part of the statement above).
  const [why] = resultRows<{ status: Subscriber['status']; busy: boolean }>(
    await db.execute(sql`select s.status, ${inFlight(now)} as busy from ${subscribers} s where s.id = ${id}`),
  );
  if (!why) return { result: 'not_found', sends: 0 };
  if (why.status === 'suppressed' && !allow && !why.busy) return { result: 'suppressed', sends: 0 };
  return { result: 'in_flight', sends: 0 };
}

/** DESIGN D3: an unsubscribed row is kept for a year after the opt-out, then deleted with its history. */
export const UNSUBSCRIBED_TTL_MS = 365 * DAY;

/**
 * Daily cron (DESIGN D3 retention): rows still unsubscribed more than 365 days after
 * unsubscribed_at are deleted with their digest_sends and alert_sends, in one statement shaped like
 * deleteSubscriber. Suppressed rows are the do-not-send list and stay indefinitely; pending,
 * active and paused rows are never touched. A row with a claim in flight waits for the next run.
 * The conditions sit on the DELETE itself, so a row resubscribed while this runs is re-checked
 * under its row lock and left alone, history included.
 */
export async function purgeOldUnsubscribed(opts: Opts = {}): Promise<{ deleted: number }> {
  const db = opts.db ?? defaultDb;
  const now = opts.now ?? new Date();
  const [out] = resultRows<{ deleted: number }>(
    await db.execute(sql`
      with gone as (
        delete from ${subscribers} s
        where s.status = 'unsubscribed' and s.unsubscribed_at < ${ts(new Date(now.getTime() - UNSUBSCRIBED_TTL_MS))} and not ${inFlight(now)}
        returning s.id
      ),
      sends as (delete from ${digestSends} where subscriber_id in (select id from gone) returning 1),
      alerts as (delete from ${alertSends} where subscriber_id in (select id from gone) returning 1)
      select (select count(*) from gone)::int as deleted`),
  );
  return { deleted: Number(out?.deleted ?? 0) };
}
