import 'server-only';
import { and, asc, desc, eq, inArray, type SQL, sql } from 'drizzle-orm';
import { db as defaultDb, type DB } from '../db';
import { digestIssues, digestSends, jobsLog, SUBSCRIBER_STATUS, subscribers } from '../db/schema';
import { eligibleSubscriber } from '../digest/issues';
import { coverage } from '../digest/week';
import { EV_LANGS, type EvLang, evLangOf, facetsOf } from '../events/facets';
import { type Category, CATEGORY_SLUGS, type Locale } from '../taxonomy';
import { cleanCategories, normalizeEmail, type Subscriber } from './service';
import { tokenId } from './token';

// /admin/subscribers (M3 week 15, guide row「/admin/subscribers」): counts, the G3 gate, one exact
// lookup at a time and the CSV export. Read-only; the writes (suppress, delete, retention) live in
// service.ts. Nothing here returns consent_ip, consent_ua or token_version, and there is no list
// query except the export, which only the admin session can reach (DESIGN D12, D14).

type Opts = { db?: DB; now?: Date };
export type SubscriberStatus = (typeof SUBSCRIBER_STATUS)[number];
export type LocaleCounts = Record<Locale, number> & { total: number };

const zero = (): LocaleCounts => ({ en: 0, zh: 0, total: 0 });
const add = (c: LocaleCounts, locale: Locale, n: number) => {
  c[locale] += n;
  c.total += n;
};

/** Every status × language, zeros included, with the column totals. */
export async function statusCounts(opts: Opts = {}): Promise<{ rows: Record<SubscriberStatus, LocaleCounts>; total: LocaleCounts }> {
  const db = opts.db ?? defaultDb;
  const found = await db
    .select({ status: subscribers.status, locale: subscribers.locale, n: sql<number>`count(*)::int` })
    .from(subscribers)
    .groupBy(subscribers.status, subscribers.locale);
  const rows = Object.fromEntries(SUBSCRIBER_STATUS.map((s) => [s, zero()])) as Record<SubscriberStatus, LocaleCounts>;
  const total = zero();
  for (const r of found) {
    add(rows[r.status], r.locale, Number(r.n));
    add(total, r.locale, Number(r.n));
  }
  return { rows, total };
}

/**
 * Category × language among the subscribers the digest goes to (eligibleSubscriber, the rule
 * behind /admin/digest's "eligible" count, at the same instant). A subscriber counts once in every
 * category they picked, so the rows add up to more than `people`. Unknown slugs and repeats are
 * dropped the way the digest drops them.
 */
export async function categoryMatrix(opts: Opts = {}): Promise<{ rows: Record<Category, LocaleCounts>; people: LocaleCounts }> {
  const db = opts.db ?? defaultDb;
  const found = await db
    .select({ locale: subscribers.locale, categories: subscribers.categories, n: sql<number>`count(*)::int` })
    .from(subscribers)
    .where(eligibleSubscriber(opts.now ?? new Date()))
    .groupBy(subscribers.locale, subscribers.categories);
  const rows = Object.fromEntries(CATEGORY_SLUGS.map((c) => [c, zero()])) as Record<Category, LocaleCounts>;
  const people = zero();
  for (const r of found) {
    const n = Number(r.n);
    add(people, r.locale, n);
    for (const c of cleanCategories(r.categories)) add(rows[c], r.locale, n);
  }
  return { rows, people };
}

export type FacetCounts = {
  /** Event-language preference ('any' = none, or a stored shape the digest reads as none). */
  evLang: Record<'any' | EvLang, LocaleCounts>;
  /** Online-only readers (the rest get every format). */
  onlineOnly: LocaleCounts;
  people: LocaleCounts;
};

/**
 * F19 facets × language among the same readers as categoryMatrix (the digest's own rule, at the
 * same instant): how many narrowed their email by event language or to online events. Each reader
 * is in exactly one event-language row, so those rows add up to `people`.
 */
export async function facetMatrix(opts: Opts = {}): Promise<FacetCounts> {
  const db = opts.db ?? defaultDb;
  const found = await db
    .select({ locale: subscribers.locale, evLangPref: subscribers.evLangPref, onlineOnly: subscribers.onlineOnly, n: sql<number>`count(*)::int` })
    .from(subscribers)
    .where(eligibleSubscriber(opts.now ?? new Date()))
    .groupBy(subscribers.locale, subscribers.evLangPref, subscribers.onlineOnly);
  const evLang = Object.fromEntries(['any', ...EV_LANGS].map((k) => [k, zero()])) as FacetCounts['evLang'];
  const onlineOnly = zero();
  const people = zero();
  for (const r of found) {
    const n = Number(r.n);
    const f = facetsOf(r);
    add(people, r.locale, n);
    add(evLang[f.evLang ?? 'any'], r.locale, n);
    if (f.onlineOnly) add(onlineOnly, r.locale, n);
  }
  return { evLang, onlineOnly, people };
}

/** G3 (guide week 15, PRD「连续 2 期准时发给 ≥50 人」): the bar for confirmed subscribers and digests sent. */
export const G3_CONFIRMED = 50;
/** An issue is on time when it finished within 3 hours of its Sunday 17:00 PT send time. */
export const ON_TIME_MS = 3 * 3600_000;

export type IssueGate = {
  id: string;
  isoWeek: string;
  status: 'sending' | 'sent';
  sendAfter: Date | null;
  sentAt: Date | null;
  /** Digests accepted by Resend and not failed since (the monthly empty notice doesn't count): G3's ≥ 50. */
  sent: number;
  /**
   * Every email of the issue accepted by Resend and not failed since, empty notices included: the
   * denominator of the bounce and complaint rates, since an empty notice's webhook rows carry
   * kind=digest too (run.ts tags both kinds alike).
   */
  delivered: number;
  /** sentAt − sendAfter ≤ 3 h; null while it is still sending inside that window. */
  onTime: boolean | null;
  /** From the webhook's email_event rows (DESIGN D11), each delivery counted once (svix id). */
  hardBounces: number;
  complaints: number;
  /**
   * Seed copies of this issue (kind=digest_seed) that didn't arrive: bounced (soft or hard),
   * suppressed by Resend (a seed that bounced before comes back as email.suppressed from then on)
   * or failed after Resend accepted it.
   */
  seedBounces: number;
};

export type GateStatus = {
  /** Active or paused now: everyone who confirmed and hasn't left or been suppressed. */
  confirmed: number;
  /** The two most recent issues that started sending, newest first. */
  issues: IssueGate[];
  /** Those two cover back-to-back ISO weeks: no week between them was skipped or never sent. */
  consecutive: boolean;
  /** G3「连续 2 期准时发给 ≥50 人」: consecutive, and both on time with ≥ 50 digests sent. */
  twoInARow: boolean;
};

/** `newer` is the ISO week right after `older` (W52 or W53 → next year's W01 included). */
function followedBy(older: string, newer: string): boolean {
  try {
    return coverage(older).previewWeek === newer;
  } catch {
    return false; // a malformed iso_week is never adjacent to anything
  }
}

const detail = (key: string) => sql`(${jobsLog.detail} ->> ${sql.raw(`'${key}'`)})`;
/** Webhook delivery is at least once: count each svix id once (a row without one counts alone). */
const distinctEvents = (where: SQL) => sql<number>`(count(distinct coalesce(${detail('svix')}, ${jobsLog.id}::text)) filter (where ${where}))::int`;

export async function gateStatus(opts: Opts = {}): Promise<GateStatus> {
  const db = opts.db ?? defaultDb;
  const now = opts.now ?? new Date();
  const [counted] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(subscribers)
    .where(inArray(subscribers.status, ['active', 'paused']));
  const issues = await db
    .select({
      id: digestIssues.id,
      isoWeek: digestIssues.isoWeek,
      status: digestIssues.status,
      sendAfter: digestIssues.sendAfter,
      sentAt: digestIssues.sentAt,
      sent: sql<number>`(count(${digestSends.subscriberId}) filter (where ${digestSends.kind} = 'digest' and ${digestSends.resendId} is not null and ${digestSends.error} is null))::int`,
      delivered: sql<number>`(count(${digestSends.subscriberId}) filter (where ${digestSends.resendId} is not null and ${digestSends.error} is null))::int`,
    })
    .from(digestIssues)
    .leftJoin(digestSends, eq(digestSends.issueId, digestIssues.id))
    .where(inArray(digestIssues.status, ['sending', 'sent']))
    .groupBy(digestIssues.id)
    .orderBy(desc(digestIssues.isoWeek))
    .limit(2);
  const ids = issues.map((i) => i.id);
  const events = ids.length
    ? await db
        .select({
          issue: sql<string>`${detail('issue')}`,
          hard: distinctEvents(sql`${detail('kind')} = 'digest' and ${detail('type')} = 'email.bounced' and coalesce(${detail('bounce')}, '') <> 'Transient'`),
          complaints: distinctEvents(sql`${detail('kind')} = 'digest' and ${detail('type')} = 'email.complained'`),
          seed: distinctEvents(sql`${detail('kind')} = 'digest_seed' and ${detail('type')} in ('email.bounced', 'email.suppressed', 'email.failed')`),
        })
        .from(jobsLog)
        .where(and(eq(jobsLog.job, 'email_event'), inArray(detail('issue'), ids)))
        .groupBy(detail('issue'))
    : [];
  const byIssue = new Map(events.map((e) => [e.issue, e]));
  const gated = issues.map((i): IssueGate => {
    const e = byIssue.get(i.id);
    const late = (end: Date) => end.getTime() - i.sendAfter!.getTime() > ON_TIME_MS;
    return {
      id: i.id,
      isoWeek: i.isoWeek,
      status: i.status as IssueGate['status'],
      sendAfter: i.sendAfter,
      sentAt: i.sentAt,
      sent: Number(i.sent),
      delivered: Number(i.delivered),
      // Scheduling always sets send_after; without one there is nothing to measure against.
      onTime: !i.sendAfter ? null : i.sentAt ? !late(i.sentAt) : late(now) ? false : null,
      hardBounces: Number(e?.hard ?? 0),
      complaints: Number(e?.complaints ?? 0),
      seedBounces: Number(e?.seed ?? 0),
    };
  });
  // A missed week (left 'scheduled' past the late limit, or never scheduled) sits between the two
  // newest issues that went out without showing up in them, so adjacency is checked on the weeks.
  const consecutive = gated.length === 2 && followedBy(gated[1].isoWeek, gated[0].isoWeek);
  return {
    confirmed: Number(counted?.n ?? 0),
    issues: gated,
    consecutive,
    twoInARow: consecutive && gated.every((i) => i.sent >= G3_CONFIRMED && i.onTime === true),
  };
}

export type OptInRate = {
  /** Ever confirmed (confirmed_at set), whatever their status now. */
  confirmed: number;
  /** Sign-ups deleted unconfirmed after 7 days, from the purge's jobs_log rows (week 13 on). */
  purged: number;
  /** Never confirmed and now unsubscribed or suppressed (a bounced confirmation, an opt-out from prefs). */
  neverConfirmedOut: number;
  /** Waiting for a click now; left out of the rate. */
  pending: number;
  /** confirmed / (confirmed + purged + neverConfirmedOut), or null before anyone finished. */
  rate: number | null;
};

/**
 * Approximate double-opt-in rate: of the sign-ups that reached an outcome, how many confirmed.
 * Approximate because purge history only exists from week 13 and rows deleted later (retention,
 * Delete) leave both sides of the ratio.
 */
export async function optInRate(opts: Opts = {}): Promise<OptInRate> {
  const db = opts.db ?? defaultDb;
  const [[s], [p]] = await Promise.all([
    db
      .select({
        confirmed: sql<number>`(count(*) filter (where ${subscribers.confirmedAt} is not null))::int`,
        out: sql<number>`(count(*) filter (where ${subscribers.confirmedAt} is null and ${subscribers.status} in ('unsubscribed', 'suppressed')))::int`,
        pending: sql<number>`(count(*) filter (where ${subscribers.status} = 'pending'))::int`,
      })
      .from(subscribers),
    db
      .select({ purged: sql<number>`coalesce(sum((${detail('deleted')})::int), 0)::int` })
      .from(jobsLog)
      .where(and(eq(jobsLog.job, 'subscribers_purge'), eq(jobsLog.ok, true))),
  ]);
  const confirmed = Number(s?.confirmed ?? 0);
  const purged = Number(p?.purged ?? 0);
  const neverConfirmedOut = Number(s?.out ?? 0);
  const done = confirmed + purged + neverConfirmedOut;
  return { confirmed, purged, neverConfirmedOut, pending: Number(s?.pending ?? 0), rate: done ? confirmed / done : null };
}

// ---- lookup ------------------------------------------------------------------------------------

export type SubscriberQuery = { email: string } | { id: string };

const ID = /^sub_[0-9a-hjkmnp-tv-z]{16}$/;

/**
 * What the search box holds, read exactly: a whole address (normalised as the form stores it), a
 * sub_… id, a link token, or a link pasted from one of our emails (/prefs/<token>, /confirm/<token>,
 * /unsubscribe?t=<token>, from any host). Anything else, a partial address included, is null.
 */
export function parseLookup(raw: unknown): SubscriberQuery | null {
  if (typeof raw !== 'string') return null;
  const q = raw.trim();
  if (!q || q.length > 2048) return null;
  if (ID.test(q)) return { id: q };
  const fromToken = tokenId(q);
  if (fromToken) return { id: fromToken };
  if (/^https?:\/\//i.test(q) || q.startsWith('/')) {
    let url: URL;
    try {
      url = new URL(q, 'https://lookup.invalid');
    } catch {
      return null;
    }
    for (const part of [url.searchParams.get('t'), ...url.pathname.split('/').reverse()]) {
      const id = tokenId(part);
      if (id) return { id };
    }
    return null;
  }
  const email = normalizeEmail(q);
  return email ? { email } : null;
}

export type SendSummary = {
  isoWeek: string;
  kind: 'digest' | 'empty';
  claimedAt: string;
  sentAt: string | null;
  state: 'sent' | 'failed' | 'pending';
  /** digest_sends.error: a short code (invalid, expired, failed:<reason>, …), never recipient data. */
  error: string | null;
};

/** One subscriber as the admin lookup shows it. Dates are ISO strings (the result goes to the client). */
export type SubscriberDetail = {
  id: string;
  email: string;
  status: Subscriber['status'];
  locale: Locale;
  categories: Category[];
  /** F19 facets as the digest reads them (a malformed stored value shows as none). */
  evLang: EvLang | null;
  onlineOnly: boolean;
  createdAt: string;
  consentAt: string | null;
  consentSource: string | null;
  confirmedAt: string | null;
  unsubscribedAt: string | null;
  pausedUntil: string | null;
  /** The last three digest_sends rows, newest claim first. */
  sends: SendSummary[];
  /** A claim not resolved yet: Delete is refused until the send finishes. */
  inFlight: boolean;
};

const iso = (d: Date | null) => d?.toISOString() ?? null;

/** Exact match on the address or the primary key; the columns are listed, so nothing else leaks. */
export async function subscriberDetail(q: SubscriberQuery, opts: Opts = {}): Promise<SubscriberDetail | null> {
  const db = opts.db ?? defaultDb;
  const [row] = await db
    .select({
      id: subscribers.id,
      email: subscribers.email,
      status: subscribers.status,
      locale: subscribers.locale,
      categories: subscribers.categories,
      evLangPref: subscribers.evLangPref,
      onlineOnly: subscribers.onlineOnly,
      createdAt: subscribers.createdAt,
      consentAt: subscribers.consentAt,
      consentSource: subscribers.consentSource,
      confirmedAt: subscribers.confirmedAt,
      unsubscribedAt: subscribers.unsubscribedAt,
      pausedUntil: subscribers.pausedUntil,
    })
    .from(subscribers)
    .where('email' in q ? eq(subscribers.email, q.email) : eq(subscribers.id, q.id));
  if (!row) return null;
  const { evLangPref, onlineOnly, ...rest } = row;
  const [sends, [busy]] = await Promise.all([
    db
      .select({
        isoWeek: digestIssues.isoWeek,
        kind: digestSends.kind,
        claimedAt: digestSends.claimedAt,
        sentAt: digestSends.sentAt,
        resendId: digestSends.resendId,
        error: digestSends.error,
      })
      .from(digestSends)
      .innerJoin(digestIssues, eq(digestIssues.id, digestSends.issueId))
      .where(eq(digestSends.subscriberId, row.id))
      .orderBy(desc(digestSends.claimedAt), desc(digestIssues.isoWeek))
      .limit(3),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(digestSends)
      .where(and(eq(digestSends.subscriberId, row.id), sql`${digestSends.resendId} is null and ${digestSends.error} is null`)),
  ]);
  return {
    ...rest,
    ...facetsOf({ evLangPref, onlineOnly }),
    categories: cleanCategories(row.categories),
    createdAt: row.createdAt.toISOString(),
    consentAt: iso(row.consentAt),
    confirmedAt: iso(row.confirmedAt),
    unsubscribedAt: iso(row.unsubscribedAt),
    pausedUntil: iso(row.pausedUntil),
    sends: sends.map((s) => ({
      isoWeek: s.isoWeek,
      kind: s.kind,
      claimedAt: s.claimedAt.toISOString(),
      sentAt: iso(s.sentAt),
      state: s.error ? 'failed' : s.resendId ? 'sent' : 'pending',
      error: s.error,
    })),
    inFlight: Number(busy?.n ?? 0) > 0,
  };
}

// ---- CSV export --------------------------------------------------------------------------------

/**
 * The export's columns (DESIGN D12). Every status, so a migration carries the unsubscribed and
 * suppressed rows over and never mails them again; no consent IP or user agent (data minimisation).
 * The F19 facets come last (so older column positions don't move), as the digest reads them:
 * ev_lang_pref en / zh / bilingual or empty for any, online_only true / false.
 */
export const EXPORT_COLUMNS = [
  'id', 'email', 'status', 'locale', 'categories', 'created_at', 'consent_at', 'consent_source', 'confirmed_at',
  'unsubscribed_at', 'paused_until', 'ev_lang_pref', 'online_only',
] as const;

export async function exportRows(opts: Opts = {}): Promise<string[][]> {
  const db = opts.db ?? defaultDb;
  const found = await db
    .select({
      id: subscribers.id,
      email: subscribers.email,
      status: subscribers.status,
      locale: subscribers.locale,
      categories: subscribers.categories,
      createdAt: subscribers.createdAt,
      consentAt: subscribers.consentAt,
      consentSource: subscribers.consentSource,
      confirmedAt: subscribers.confirmedAt,
      unsubscribedAt: subscribers.unsubscribedAt,
      pausedUntil: subscribers.pausedUntil,
      evLangPref: subscribers.evLangPref,
      onlineOnly: subscribers.onlineOnly,
    })
    .from(subscribers)
    .orderBy(asc(subscribers.createdAt), asc(subscribers.id));
  return found.map((r) => [
    r.id, r.email, r.status, r.locale, r.categories.join(';'), r.createdAt.toISOString(), iso(r.consentAt) ?? '',
    r.consentSource ?? '', iso(r.confirmedAt) ?? '', iso(r.unsubscribedAt) ?? '', iso(r.pausedUntil) ?? '',
    evLangOf(r.evLangPref) ?? '', String(r.onlineOnly === true),
  ]);
}

/**
 * One RFC 4180 field: always quoted, quotes doubled. A cell a spreadsheet would run as a formula
 * (leading = + - @, tab or CR) gets a leading apostrophe (OWASP CSV injection).
 */
export function csvCell(v: string): string {
  const safe = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  return `"${safe.replace(/"/g, '""')}"`;
}

/** UTF-8 BOM (so Excel reads the Chinese), a header line, CRLF after every record. */
export function toCsv(header: readonly string[], rows: readonly (readonly string[])[]): string {
  return `﻿${[header, ...rows].map((r) => `${r.map(csvCell).join(',')}\r\n`).join('')}`;
}
