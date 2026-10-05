import 'server-only';
import { and, eq, inArray, lt, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db as defaultDb, type DB } from '../db';
import { digestSends, subscribers } from '../db/schema';
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
//
// unsubscribed_at is the time of the last opt-out and survives a later return (form + confirm, or
// "Subscribe again"); status says whether they are opted out now. consent_* is the latest consent.

export type Subscriber = typeof subscribers.$inferSelect;
type Opts = { db?: DB; now?: Date };

const DAY = 864e5;
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
 * new choices and consent record; active, paused and suppressed rows are left alone. The caller
 * shows the same "check your inbox" state in every case, so the form can't reveal who subscribed.
 * Re-arming keeps confirmed_at and unsubscribed_at: a former subscriber's history (and their
 * digest_sends rows) must survive an unconfirmed re-request, which the purge then reverts.
 */
export async function requestSubscription(input: SubscribeInput, opts: Opts = {}): Promise<SubscribeOutcome> {
  const db = opts.db ?? defaultDb;
  const now = opts.now ?? new Date();
  const consent = {
    locale: input.locale,
    categories: input.categories,
    consentAt: now,
    consentIp: input.ip,
    consentUa: input.ua?.slice(0, 512) ?? null,
    consentSource: input.source.slice(0, 64),
  };
  const [row] = await db
    .insert(subscribers)
    .values({ id: newId('sub'), email: input.email, status: 'pending', createdAt: now, ...consent })
    .onConflictDoUpdate({
      target: subscribers.email,
      set: { ...consent, status: 'pending', pausedUntil: null },
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

async function update(db: DB, id: string, from: readonly Subscriber['status'][], set: Partial<typeof subscribers.$inferInsert>) {
  const [row] = await db
    .update(subscribers)
    .set(set)
    .where(and(eq(subscribers.id, id), inArray(subscribers.status, [...from])))
    .returning();
  return row ?? null;
}

/** Prefs: language and categories. Picking no category at all is the same as unsubscribing. */
export async function updatePreferences(sub: Subscriber, prefs: { locale: Locale; categories: Category[] }, opts: Opts = {}) {
  const db = opts.db ?? defaultDb;
  if (prefs.categories.length === 0) return unsubscribeAll(sub, opts);
  return (await update(db, sub.id, editable, { locale: prefs.locale, categories: prefs.categories })) ?? sub;
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

/** One-click and manual unsubscribe. Repeating it changes nothing and still succeeds. */
export async function unsubscribeAll(sub: Subscriber, opts: Opts = {}) {
  const db = opts.db ?? defaultDb;
  const now = opts.now ?? new Date();
  return (await update(db, sub.id, editable, { status: 'unsubscribed', unsubscribedAt: now, pausedUntil: null })) ?? sub;
}

export type Consent = { ip: string | null; ua: string | null; source: string };

/**
 * From an unsubscribed row's preferences link. Holding the link proves the inbox is theirs, so a
 * previously confirmed address goes straight back to active; one that never confirmed goes back
 * to pending and gets a fresh confirmation email (`needsConfirm`). Suppressed rows can't come back.
 * Either way the new consent (time, IP, user agent, page) replaces the old one; unsubscribed_at is
 * kept, so the row still shows the opt-out that came before it.
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
 * unsubscribed, keeping its history and the digest_sends rows that reference it (which would also
 * make a DELETE fail). Two single statements, so it is safe on neon-http and idempotent.
 */
export async function purgeStalePending(opts: Opts = {}) {
  const db = opts.db ?? defaultDb;
  const now = opts.now ?? new Date();
  const stale = and(eq(subscribers.status, 'pending'), lt(subscribers.consentAt, new Date(now.getTime() - PENDING_TTL_MS)));
  const reverted = await db
    .update(subscribers)
    .set({ status: 'unsubscribed', unsubscribedAt: sql`coalesce(${subscribers.unsubscribedAt}, ${now})` })
    .where(and(stale, sql`${subscribers.confirmedAt} is not null`))
    .returning({ id: subscribers.id });
  const deleted = await db
    .delete(subscribers)
    .where(
      and(
        stale,
        sql`${subscribers.confirmedAt} is null`,
        sql`not exists (select 1 from ${digestSends} where ${digestSends.subscriberId} = ${subscribers.id})`,
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
  pausedUntil: string | null;
};

export function viewOf(sub: Subscriber): SubscriberView {
  return {
    status: sub.status,
    locale: sub.locale,
    categories: cleanCategories(sub.categories),
    pausedUntil: sub.pausedUntil?.toISOString() ?? null,
  };
}
