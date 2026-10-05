import 'server-only';
import { and, asc, desc, eq, getTableColumns, gte, inArray, isNull, lt, lte, or, type SQL, sql } from 'drizzle-orm';
import { db as defaultDb, type DB } from '../db';
import { digestIssues, digestSends, events, subscribers } from '../db/schema';
import { newId } from '../ids';
import { CATEGORY_SLUGS } from '../taxonomy';
import { archivable } from './archive-sql';
import { parseVariantKey, type Variant, variantKey } from './variant';
import { coverage, LATE_LIMIT_MS, sendAfterFor } from './week';

// The digest issue lifecycle (guide「digest 组装」, /admin/digest). Every write is one statement,
// so it is safe on neon-http (no interactive transactions) and under double clicks:
//
//   draft ──schedule──▶ scheduled ──cron──▶ sending ──cron──▶ sent
//     ▲                    │
//     └────unschedule──────┘
//
// Content (intros, featured preview, kept covers) can only change while the issue is a draft;
// the cron freezes it into digest_issues.snapshot when sending starts (run.ts).

export type DigestIssue = typeof digestIssues.$inferSelect;
type Opts = { db?: DB; now?: Date };

/** Intro length cap, in characters (2–4 lines of the email). */
export const INTRO_MAX = 600;
const MAX_IDS = 100;

export async function getIssue(id: string, opts: Opts = {}): Promise<DigestIssue | null> {
  const db = opts.db ?? defaultDb;
  const [row] = await db.select().from(digestIssues).where(eq(digestIssues.id, id));
  return row ?? null;
}

export async function getIssueByWeek(isoWeek: string, opts: Opts = {}): Promise<DigestIssue | null> {
  const db = opts.db ?? defaultDb;
  const [row] = await db.select().from(digestIssues).where(eq(digestIssues.isoWeek, isoWeek));
  return row ?? null;
}

/**
 * The issue for `isoWeek`, created as a draft on first use. A new issue's next-week preview starts
 * as the featured published events of the following week; an existing row is returned untouched.
 */
export async function ensureIssue(isoWeek: string, opts: Opts = {}): Promise<DigestIssue> {
  const db = opts.db ?? defaultDb;
  const cov = coverage(isoWeek); // throws on a malformed or impossible week
  const existing = await getIssueByWeek(isoWeek, opts);
  if (existing) return existing;
  const featured = await db
    .select({ id: events.id })
    .from(events)
    .where(and(eq(events.status, 'published'), eq(events.featured, true), gte(events.startAt, cov.to), lt(events.startAt, cov.previewTo)))
    .orderBy(asc(events.startAt), asc(events.id));
  const [row] = await db
    .insert(digestIssues)
    .values({ id: newId('dig'), isoWeek, featuredIds: featured.map((f) => f.id), createdAt: opts.now ?? new Date() })
    .onConflictDoNothing({ target: digestIssues.isoWeek })
    .returning();
  if (row) return row;
  // Lost the race to another request creating the same week.
  const again = await getIssueByWeek(isoWeek, opts);
  if (!again) throw new Error(`digest issue ${isoWeek} vanished`);
  return again;
}

export type IssueSummary = Omit<DigestIssue, 'snapshot'> & {
  /**
   * From digest_sends. claimed: every row (each recipient claimed for this issue, digest or empty
   * notice); sent: accepted by the transport and not failed since; failed: rows with a final error
   * (invalid, ineligible, expired, window_closed, failed:<reason>, …). claimed − sent − failed are
   * still pending.
   */
  counts: { sent: number; failed: number; claimed: number };
  /**
   * The stored snapshot would give a /weekly page (archive-sql.ts, the archive's own predicate):
   * with status 'sending' or 'sent', the issue is public there. False for a week with no events.
   */
  archivable: boolean;
};

/** The most recent issues by covered week, newest first, with their send counts. */
export async function listIssues(limit = 8, opts: Opts = {}): Promise<IssueSummary[]> {
  const db = opts.db ?? defaultDb;
  const { snapshot: _snapshot, ...cols } = getTableColumns(digestIssues);
  const rows = await db
    .select({
      ...cols,
      sent: sql<number>`count(*) filter (where ${digestSends.resendId} is not null and ${digestSends.error} is null)`,
      failed: sql<number>`count(*) filter (where ${digestSends.error} is not null)`,
      claimed: sql<number>`count(${digestSends.subscriberId})`,
      // Grouped by the primary key, so this may read the snapshot; the snapshot itself stays out of the result.
      archivable: sql<boolean>`coalesce(${archivable}, false)`,
    })
    .from(digestIssues)
    .leftJoin(digestSends, eq(digestSends.issueId, digestIssues.id))
    .groupBy(digestIssues.id)
    .orderBy(desc(digestIssues.isoWeek))
    .limit(Math.max(1, Math.min(52, Math.trunc(limit) || 8)));
  return rows.map(({ sent, failed, claimed, archivable: hasPage, ...issue }) => ({
    ...issue,
    counts: { sent: Number(sent), failed: Number(failed), claimed: Number(claimed) },
    archivable: hasPage === true,
  }));
}

export type IssueEdit = {
  introEn?: string | null;
  introZh?: string | null;
  /** Next-week preview; kept only for published events starting in the following week. */
  featuredIds?: readonly string[];
  /** Luma official covers kept in this email; kept only for published events of the covered week (the preview shows no covers). */
  keepCoverIds?: readonly string[];
  /** Unapproved model drafts ('intro_en' / 'intro_zh'); scheduling is refused while any mark is left. */
  autoFields?: readonly string[];
};

/**
 * Save the editor's fields. Only drafts change: returns null for an unknown issue or one that is
 * scheduled or later (unschedule first). Fields left undefined are not touched.
 */
export async function saveIssue(id: string, edit: IssueEdit, opts: Opts = {}): Promise<DigestIssue | null> {
  const db = opts.db ?? defaultDb;
  const issue = await getIssue(id, opts);
  if (!issue || issue.status !== 'draft') return null;

  const set: Partial<typeof digestIssues.$inferInsert> = {};
  if (edit.introEn !== undefined) set.introEn = cleanIntro(edit.introEn);
  if (edit.introZh !== undefined) set.introZh = cleanIntro(edit.introZh);
  if (edit.autoFields !== undefined) set.autoFields = cleanList(edit.autoFields, 8);

  const featured = edit.featuredIds === undefined ? undefined : cleanList(edit.featuredIds, MAX_IDS);
  const keep = edit.keepCoverIds === undefined ? undefined : cleanList(edit.keepCoverIds, MAX_IDS);
  if (featured || keep) {
    const cov = coverage(issue.isoWeek);
    const wanted = [...new Set([...(featured ?? []), ...(keep ?? [])])];
    const found = wanted.length
      ? await db
          .select({ id: events.id, startAt: events.startAt })
          .from(events)
          .where(and(inArray(events.id, wanted), eq(events.status, 'published'), gte(events.startAt, cov.from), lt(events.startAt, cov.previewTo)))
      : [];
    const start = new Map(found.map((r) => [r.id, r.startAt!.getTime()]));
    const inPreview = (i: string) => start.has(i) && start.get(i)! >= cov.to.getTime();
    const inWeek = (i: string) => start.has(i) && start.get(i)! < cov.to.getTime();
    if (featured) set.featuredIds = featured.filter(inPreview);
    if (keep) set.keepCoverIds = keep.filter(inWeek);
  }

  if (Object.keys(set).length === 0) return issue;
  const [row] = await db
    .update(digestIssues)
    .set(set)
    .where(and(eq(digestIssues.id, id), eq(digestIssues.status, 'draft')))
    .returning();
  return row ?? null;
}

export type ScheduleResult =
  | { ok: true; sendAfter: Date }
  | { ok: false; error: 'not_draft' | 'intro_missing' | 'unapproved' | 'too_late' };

const hasText = (col: typeof digestIssues.introEn | typeof digestIssues.introZh) => sql`char_length(btrim(coalesce(${col}, ''))) > 0`;

/**
 * draft → scheduled for the Sunday 17:00 PT before the covered week. Needs both intros, none of them
 * an unapproved model draft, and a send window that hasn't closed. The checks are repeated in the
 * UPDATE itself, so an edit landing between the read and the write can't sneak past them.
 */
export async function scheduleIssue(id: string, opts: Opts = {}): Promise<ScheduleResult> {
  const db = opts.db ?? defaultDb;
  const now = opts.now ?? new Date();
  const issue = await getIssue(id, opts);
  const why = issue ? scheduleBlocker(issue, now) : 'not_draft';
  if (why) return { ok: false, error: why };
  const sendAfter = sendAfterFor(issue!.isoWeek);
  const [row] = await db
    .update(digestIssues)
    .set({ status: 'scheduled', sendAfter })
    .where(
      and(
        eq(digestIssues.id, id),
        eq(digestIssues.status, 'draft'),
        sql`cardinality(${digestIssues.autoFields}) = 0`,
        hasText(digestIssues.introEn),
        hasText(digestIssues.introZh),
      ),
    )
    .returning({ sendAfter: digestIssues.sendAfter });
  if (row?.sendAfter) return { ok: true, sendAfter: row.sendAfter };
  // Something changed in between; report what it is now.
  const fresh = await getIssue(id, opts);
  return { ok: false, error: (fresh && scheduleBlocker(fresh, now)) || 'not_draft' };
}

function scheduleBlocker(issue: DigestIssue, now: Date): Exclude<ScheduleResult, { ok: true }>['error'] | null {
  if (issue.status !== 'draft') return 'not_draft';
  if (now.getTime() >= sendAfterFor(issue.isoWeek).getTime() + LATE_LIMIT_MS) return 'too_late';
  if (!issue.introEn?.trim() || !issue.introZh?.trim()) return 'intro_missing';
  if (issue.autoFields.length > 0) return 'unapproved';
  return null;
}

/** scheduled → draft (the send time is cleared). An issue that started sending can't be pulled back. */
export async function unscheduleIssue(id: string, opts: Opts = {}): Promise<boolean> {
  const db = opts.db ?? defaultDb;
  const rows = await db
    .update(digestIssues)
    .set({ status: 'draft', sendAfter: null })
    .where(and(eq(digestIssues.id, id), eq(digestIssues.status, 'scheduled')))
    .returning({ id: digestIssues.id });
  return rows.length > 0;
}

/**
 * Who the digest goes to: active, or paused with the pause over (or never given an end; prefs-view
 * already shows those as active), with at least one known category. Pending, unsubscribed and
 * suppressed rows never qualify. The sending claim (claim.ts) applies the same rule.
 */
export function eligibleSubscriber(now: Date): SQL {
  const known = sql`array[${sql.join(CATEGORY_SLUGS.map((c) => sql`${c}`), sql`, `)}]::text[]`;
  return and(
    sql`${subscribers.categories} && ${known}`,
    or(
      eq(subscribers.status, 'active'),
      and(eq(subscribers.status, 'paused'), or(isNull(subscribers.pausedUntil), lte(subscribers.pausedUntil, now))),
    ),
  )!;
}

/** Eligible subscribers per variant (language × category set), largest first. Counts only, no addresses. */
export async function audience(opts: Opts = {}): Promise<{ variant: Variant; count: number }[]> {
  const db = opts.db ?? defaultDb;
  const now = opts.now ?? new Date();
  const rows = await db
    .select({ locale: subscribers.locale, categories: subscribers.categories, count: sql<number>`count(*)` })
    .from(subscribers)
    .where(eligibleSubscriber(now))
    .groupBy(subscribers.locale, subscribers.categories);
  const byKey = new Map<string, { variant: Variant; count: number }>();
  for (const r of rows) {
    // The same set can be stored in another order or with an unknown slug; the key normalises both.
    const variant = parseVariantKey(variantKey(r.locale, r.categories));
    if (!variant) continue; // unreachable: the rule above requires a known slug
    const slot = byKey.get(variant.key);
    if (slot) slot.count += Number(r.count);
    else byKey.set(variant.key, { variant, count: Number(r.count) });
  }
  return [...byKey.values()].sort((a, b) => b.count - a.count || (a.variant.key < b.variant.key ? -1 : 1));
}

/** Trimmed, \r\n → \n, capped at INTRO_MAX characters (code points, so no split surrogate); '' → null. */
export function cleanIntro(raw: string | null): string | null {
  if (raw == null) return null;
  const text = Array.from(raw.replace(/\r\n?/g, '\n').trim()).slice(0, INTRO_MAX).join('').trim();
  return text || null;
}

function cleanList(raw: readonly unknown[], max: number): string[] {
  const out = new Set<string>();
  for (const v of raw) {
    if (typeof v !== 'string') continue;
    const s = v.trim().slice(0, 64); // ids are ~20 chars; an over-long one then matches nothing
    if (s) out.add(s);
    if (out.size >= max) break;
  }
  return [...out];
}
