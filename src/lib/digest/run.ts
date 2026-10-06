import 'server-only';
import { createHash } from 'node:crypto';
import { and, asc, eq, gt, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import { db as defaultDb, type DB } from '../db';
import { covers, digestIssues, digestSends, syncState } from '../db/schema';
import { newId } from '../ids';
import { describeError } from '../log-safe';
import { digestMode, type DigestMode } from '../newsletter/status';
import { readSetting, showAttendance } from '../settings';
import { linksFor } from '../subscribers/links';
import { linkToken } from '../subscribers/token';
import { buildSnapshot } from './assemble';
import {
  anyClaimable,
  claimFresh,
  countSkippedEmpty,
  expireOld,
  markError,
  markSent,
  reclaimStale,
  sentTodayCount,
  type Claimed,
  type ClaimTarget,
} from './claim';
import { templateEmailUrl } from './cover';
import { DigestTooLargeError, personalize, renderEmptyNotice, renderVariant } from './render';
import { type PickCell, pickCells } from './select';
import { classify, devTransport, digestFrom, MAX_BATCH, resendTransport, type BatchEmail, type BatchMode, type BatchOk, type BatchTransport } from './transport';
import type { DigestEvent, DigestSnapshot, RenderedEmail } from './types';
import { parseVariantKey, type Variant } from './variant';
import { LATE_LIMIT_MS, monthStartPT } from './week';

// The weekly send (guide「digest 发送」; design contract §C). Both daily crons (01:00 and 02:00 UTC),
// the admin "Send now" button and any duplicate cron delivery run this same function:
//
//   mode gate → run lease → due issue (late limit) → freeze snapshot (scheduled → sending)
//   → narrow it to the live kill switches → replay stale groups → claim fresh groups (digest, then
//   empty notices) → send → mark → finalize
//
// Correctness never depends on timing. A subscriber is claimed at most once per issue (primary key),
// a claimed group is only ever re-sent as the same group under the same Resend idempotency key
// (sorted ids of the group as claimed), with the same bytes unless a kill switch narrowed the
// snapshot in between (Resend then answers 409 and the group is marked idem_conflict, never sent
// twice), and a run that dies leaves claims the next run picks up after 10 minutes. Results carry
// counts and codes only: never an address or a token.

export type RunResult = {
  ok: boolean;
  skipped?: 'no_verified_sender' | 'locked' | 'nothing_due';
  /** ISO week of the issue this run worked on. */
  issue?: string;
  /** That issue's status when the run ended. */
  status?: 'sending' | 'sent';
  /** Rows newly claimed this run (digest + empty notices). */
  claimed: number;
  /** Fresh claims Resend accepted this run. */
  sent: number;
  /** Stale groups from an earlier run that were re-sent (and accepted) this run. */
  replayed: number;
  /** Rows given a final error this run: invalid, idem_conflict, id_mismatch, no_picks, render_failed, too_large, expired, window_closed (not ineligible). */
  failed: number;
  /**
   * Emails that could not be built this run, by `kind|variantKey` (e.g. "digest|zh:ai,vc"): the
   * error and how many rows got it. Any entry makes the run ok=false (reason 'render_failed' unless
   * a stop already set one), so the cron answers 500 and jobs_log records the failure.
   */
  buildFailures?: Record<string, { error: BuildError; rows: number }>;
  /** Of sent + replayed, the "nothing this week" notices. */
  emptyNotices: number;
  /** Eligible subscribers left out because they already had this month's empty notice. */
  skippedEmpty: number;
  /** Batch calls made to the transport. */
  batches: number;
  /** Work is left for the next run (deadline, daily cap, a stop error). */
  partial?: boolean;
  reason?: string;
  /** Largest personalised HTML this run (bytes); the limit is MAX_HTML_BYTES. */
  htmlMaxBytes: number;
  /** Issues whose send window ended while still sending: unsent rows window_closed, status sent. */
  closed?: string[];
  /** Kill switches turned on since the snapshot was frozen; the stored snapshot was narrowed to match. */
  narrowed?: ('attendance_off' | 'covers_to_template')[];
  /** Scheduled issues found past the late limit: not started, left scheduled (admin shows them missed). */
  tooLate?: string[];
};

export type RunDeps = {
  db?: DB;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  transport?: BatchTransport;
  mode?: DigestMode;
  /** Stop starting new work after this long (default 240 s, under maxDuration 300 s). */
  budgetMs?: number;
  /** Digest emails per UTC day (default DIGEST_DAILY_CAP or 60; Resend Free is 100/day for everything). */
  dailyCap?: number;
};

export const DEFAULT_BUDGET_MS = 240_000;
export const DEFAULT_DAILY_CAP = 60;
/** At most one batch call per second: the team limit is 10 rps, shared with magic links. */
export const PACE_MS = 1_000;
/** Longer than maxDuration, so a run that is still alive keeps the lease. */
export const LEASE_MS = 330_000;
export const LEASE = 'digest_run';
/** Missed issues are reported for a week after the late limit, then ignored (no daily noise forever). */
const TOO_LATE_REPORT_MS = 7 * 864e5;
const MAX_ATTEMPTS = 4;
const MAX_RETRY_WAIT_MS = 5_000;

const zero = (): RunResult => ({
  ok: true, claimed: 0, sent: 0, replayed: 0, failed: 0, emptyNotices: 0, skippedEmpty: 0, batches: 0, htmlMaxBytes: 0,
});

export function dailyCapFromEnv(raw = process.env.DIGEST_DAILY_CAP): number {
  const n = Number(raw);
  return raw && Number.isFinite(n) && n >= 0 ? Math.floor(n) : DEFAULT_DAILY_CAP;
}

/** `digest/{issueId}/{22 chars of base64url sha256 over the sorted subscriber ids}`: 1–256 chars, stable per group. */
export function idempotencyKey(issueId: string, subscriberIds: readonly string[]): string {
  const ids = [...subscriberIds].sort();
  return `digest/${issueId}/${createHash('sha256').update(ids.join(',')).digest('base64url').slice(0, 22)}`;
}

export async function runDigest(deps: RunDeps = {}): Promise<RunResult> {
  const out = zero();
  const mode = deps.mode ?? digestMode();
  // No verified sender on Vercel: claim nothing and change nothing, or the whole list would be
  // recorded as sent by a transport that can't deliver.
  if (mode === 'off') return { ...out, skipped: 'no_verified_sender' };
  // Every link carries a signed token; without the secret nothing can be personalised.
  if (!process.env.SUBSCRIBER_LINK_SECRET) return { ...out, ok: false, reason: 'no_link_secret' };

  const db = deps.db ?? defaultDb;
  const clock = deps.now ?? (() => new Date());
  const started = clock();
  if (!(await takeLease(db, started))) return { ...out, skipped: 'locked' };
  try {
    await new Run({
      db,
      clock,
      sleep: deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms))),
      transport: deps.transport ?? (mode === 'live' ? resendTransport() : devTransport),
      deadline: started.getTime() + (deps.budgetMs ?? DEFAULT_BUDGET_MS),
      dailyCap: deps.dailyCap ?? dailyCapFromEnv(),
      out,
    }).go();
    return out;
  } finally {
    await releaseLease(db, started).catch((e) => console.error(`[digest] lease release failed: ${describeError(e)}`));
  }
}

/** One runner at a time (same pattern as claimSyncRun): a conditional UPDATE on a sync_state row. */
async function takeLease(db: DB, at: Date): Promise<boolean> {
  await db.insert(syncState).values({ source: LEASE }).onConflictDoNothing();
  const won = await db
    .update(syncState)
    .set({ lastRunAt: at })
    .where(
      and(
        eq(syncState.source, LEASE),
        or(isNull(syncState.lastRunAt), lte(syncState.lastRunAt, new Date(at.getTime() - LEASE_MS))),
      ),
    )
    .returning({ source: syncState.source });
  return won.length > 0;
}

/** Only our own lease: a run that outlived it must not free a newer runner's. */
async function releaseLease(db: DB, at: Date) {
  await db
    .update(syncState)
    .set({ lastRunAt: null })
    .where(and(eq(syncState.source, LEASE), eq(syncState.lastRunAt, at)));
}

type Issue = typeof digestIssues.$inferSelect;
type BuildError = 'no_picks' | 'render_failed' | 'too_large';
type Built = { email: BatchEmail; row: Claimed } | { error: BuildError; row: Claimed };
type Ctx = {
  db: DB;
  clock: () => Date;
  sleep: (ms: number) => Promise<void>;
  transport: BatchTransport;
  deadline: number;
  dailyCap: number;
  out: RunResult;
};

const byId = (a: Claimed, b: Claimed) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

class Run {
  private readonly db: DB;
  private readonly out: RunResult;
  private readonly from = digestFrom();
  private lastCall = Number.NEGATIVE_INFINITY;
  /** One render per kind and variant per run; each recipient only swaps in their own token. */
  private readonly cache = new Map<string, Promise<RenderedEmail | null>>();
  private readonly loggedFailures = new Set<string>();
  // Set once the issue is chosen and frozen.
  private issue!: Issue;
  private snap!: DigestSnapshot;
  /** The week's (category, event language, online) combinations the claims test subscribers against. */
  private cells: PickCell[] = [];

  constructor(private readonly c: Ctx) {
    this.db = c.db;
    this.out = c.out;
  }

  private now() {
    return this.c.clock();
  }

  private timeLeft() {
    return this.c.deadline - this.now().getTime();
  }

  /** Leave the rest for the next run. ok=false when something is wrong (quota, config, provider). */
  private halt(reason: string, ok: boolean) {
    this.out.partial = true;
    this.out.reason = reason;
    if (!ok) this.out.ok = false;
  }

  async go() {
    const issue = await this.dueIssue();
    if (!issue) {
      this.out.skipped = 'nothing_due';
      return;
    }
    const frozen = await this.freeze(issue);
    const snap = frozen && (await this.narrow(issue, frozen));
    if (!snap) {
      // Changed under us between the read and the write (unscheduled, or finished by another run).
      this.out.skipped = 'nothing_due';
      return;
    }
    this.issue = issue;
    this.snap = snap;
    // The same events select.ts shows (known category, inside the covered week), so a claimed
    // digest always has picks for its variant.
    this.cells = pickCells(snap);
    this.out.issue = issue.isoWeek;
    this.out.status = 'sending';
    await this.sendIssue();
  }

  /** Closes sending issues past the window, reports missed ones, and returns the issue to work on. */
  private async dueIssue(): Promise<Issue | null> {
    const now = this.now();
    const due = await this.db
      .select()
      .from(digestIssues)
      .where(
        and(
          lte(digestIssues.sendAfter, now),
          or(
            eq(digestIssues.status, 'sending'),
            and(
              eq(digestIssues.status, 'scheduled'),
              gt(digestIssues.sendAfter, new Date(now.getTime() - LATE_LIMIT_MS - TOO_LATE_REPORT_MS)),
            ),
          ),
        ),
      )
      .orderBy(asc(digestIssues.sendAfter));
    let live: Issue | null = null;
    for (const issue of due) {
      const late = now.getTime() >= issue.sendAfter!.getTime() + LATE_LIMIT_MS;
      if (late && issue.status === 'sending') {
        this.out.failed += await this.closeWindow(issue, now);
        (this.out.closed ??= []).push(issue.isoWeek);
      } else if (late) {
        console.warn(`[digest] ${issue.isoWeek}: scheduled but past the send window; not sending (too_late)`);
        (this.out.tooLate ??= []).push(issue.isoWeek);
      } else {
        live ??= issue;
      }
    }
    return live;
  }

  private async closeWindow(issue: Issue, now: Date) {
    const n = await markError(issue.id, { allUnsent: true }, 'window_closed', this.db);
    await this.db
      .update(digestIssues)
      .set({ status: 'sent', sentAt: now })
      .where(and(eq(digestIssues.id, issue.id), eq(digestIssues.status, 'sending')));
    console.warn(`[digest] ${issue.isoWeek}: send window closed; ${n} unsent claim(s) closed`);
    return n;
  }

  /**
   * scheduled → sending in one conditional UPDATE that also stores the assembled content. Every
   * later render of the issue (retries, the 02:00 run) uses that snapshot, so the bytes don't change
   * (unless a kill switch narrows it: see narrow()).
   */
  private async freeze(issue: Issue): Promise<DigestSnapshot | null> {
    if (issue.status === 'sending' && issue.snapshot) return issue.snapshot as DigestSnapshot;
    const now = this.now();
    const built = await buildSnapshot(issue, { db: this.db, now });
    const [row] = await this.db
      .update(digestIssues)
      .set({ status: 'sending', snapshot: built })
      .where(
        and(
          eq(digestIssues.id, issue.id),
          issue.status === 'scheduled'
            ? and(eq(digestIssues.status, 'scheduled'), lte(digestIssues.sendAfter, now))
            : and(eq(digestIssues.status, 'sending'), isNull(digestIssues.snapshot)),
        ),
      )
      .returning();
    if (row?.snapshot) return row.snapshot as DigestSnapshot;
    const [again] = await this.db.select().from(digestIssues).where(eq(digestIssues.id, issue.id));
    return again?.status === 'sending' && again.snapshot ? (again.snapshot as DigestSnapshot) : null;
  }

  /**
   * The frozen snapshot, minus what a kill switch turned on since the freeze has taken away: with
   * show_attendance now off, no going section, seals or going count (the snapshot's flag gates all
   * three); with official_covers_to_template now on, official and host-composite covers become the
   * template. Only ever narrows: a switch turned back on later doesn't restore anything. A change is
   * stored with one conditional UPDATE, so every later render (replays, the next runs, test send,
   * the admin preview) uses the narrowed copy. Null when the issue stopped sending meanwhile.
   */
  private async narrow(issue: Issue, snap: DigestSnapshot): Promise<DigestSnapshot | null> {
    const [attendance, toTemplate] = await Promise.all([showAttendance(), readSetting('official_covers_to_template')]);
    const why: NonNullable<RunResult['narrowed']> = [];
    let next = snap;
    if (snap.showAttendance && attendance !== true) {
      const unseal = (e: DigestEvent): DigestEvent => (e.seal ? { ...e, seal: null } : e);
      next = { ...next, showAttendance: false, events: next.events.map(unseal), preview: next.preview.map(unseal) };
      why.push('attendance_off');
    }
    if (toTemplate?.on) {
      const swapped = await this.officialToTemplate(next);
      if (swapped !== next) {
        next = swapped;
        why.push('covers_to_template');
      }
    }
    if (next === snap) return snap;
    const [row] = await this.db
      .update(digestIssues)
      .set({ snapshot: next })
      .where(and(eq(digestIssues.id, issue.id), eq(digestIssues.status, 'sending')))
      .returning({ id: digestIssues.id });
    if (!row) return null;
    this.out.narrowed = why;
    console.warn(`[digest] ${issue.isoWeek}: snapshot narrowed after the freeze (${why.join(', ')})`);
    return next;
  }

  /**
   * Official and host-composite covers swapped for the template (no credit). The kind isn't in the
   * snapshot, so it is looked up by the cover id in the frozen /og/email-cover/{id} URL: exactly the
   * picture the email would show. Returns `snap` itself when nothing changes.
   */
  private async officialToTemplate(snap: DigestSnapshot): Promise<DigestSnapshot> {
    const prefix = `${snap.origin.replace(/\/+$/, '')}/og/email-cover/`;
    const coverId = (e: DigestEvent) => {
      if (!e.coverUrl.startsWith(prefix)) return null;
      try {
        return decodeURIComponent(e.coverUrl.slice(prefix.length));
      } catch {
        return null;
      }
    };
    const all = [...snap.events, ...snap.preview];
    const ids = [...new Set(all.map(coverId).filter((id): id is string => Boolean(id)))];
    if (ids.length === 0) return snap;
    const official = new Set(
      (
        await this.db
          .select({ id: covers.id })
          .from(covers)
          .where(and(inArray(covers.id, ids), inArray(covers.kind, ['official', 'host_composite'])))
      ).map((r) => r.id),
    );
    if (official.size === 0) return snap;
    const swap = (e: DigestEvent): DigestEvent => {
      const id = coverId(e);
      return id && official.has(id) ? { ...e, coverUrl: templateEmailUrl(snap.origin, e.category), coverCredit: null } : e;
    };
    return { ...snap, events: snap.events.map(swap), preview: snap.preview.map(swap) };
  }

  private async sendIssue() {
    const id = this.issue.id;
    this.out.failed += await expireOld(id, this.now(), this.db);

    // 1. Groups an earlier run claimed but never marked: the same members under the same key. A
    //    group handled once is not taken again this run (send() leaves every member sent or failed
    //    unless it stops the run; this keeps a bug there from looping on one group).
    const replayed: string[] = [];
    for (;;) {
      if (this.timeLeft() <= 0) return this.halt('deadline', true);
      const group = await reclaimStale(id, this.now(), this.db, replayed);
      if (!group) break;
      replayed.push(group.batchKey);
      if (group.rows.length === 0) continue; // everyone in it became ineligible
      if ((await this.send(group.rows, true)) === 'stop') return;
    }

    // 2. Fresh claims, oldest subscribers first, up to 100 per call across variants, topped up
    //    with this month's empty notices. The daily cap counts everything sent or claimed today.
    for (;;) {
      if (this.timeLeft() <= 0) return this.halt('deadline', true);
      const at = this.now();
      const digest: ClaimTarget = { kind: 'digest', cells: this.cells };
      const empty: ClaimTarget = { kind: 'empty', cells: this.cells, monthStart: monthStartPT(at) };
      const room = this.c.dailyCap - (await sentTodayCount(at, this.db));
      if (room <= 0) {
        // Only a real overflow waits for tomorrow; if nobody is left the issue can finish now.
        if (await anyClaimable(id, [digest, empty], at, this.db)) return this.halt('daily_cap', true);
        break;
      }
      const limit = Math.min(MAX_BATCH, room);
      const batchKey = newId('dbk');
      let rows = await claimFresh(id, digest, limit, batchKey, at, this.db);
      if (rows.length < limit) rows = rows.concat(await claimFresh(id, empty, limit - rows.length, batchKey, at, this.db));
      if (rows.length === 0) break;
      this.out.claimed += rows.length;
      if ((await this.send(rows, false)) === 'stop') return;
    }

    // 3. Nobody left to claim: the issue is sent once no claim is still waiting.
    const now = this.now();
    this.out.skippedEmpty = await countSkippedEmpty(id, this.cells, monthStartPT(now), now, this.db);
    const [done] = await this.db
      .update(digestIssues)
      .set({ status: 'sent', sentAt: now })
      .where(
        and(
          eq(digestIssues.id, id),
          eq(digestIssues.status, 'sending'),
          sql`not exists (select 1 from ${digestSends} where ${digestSends.issueId} = ${id} and ${digestSends.resendId} is null and ${digestSends.error} is null)`,
        ),
      )
      .returning({ id: digestIssues.id });
    if (done) this.out.status = 'sent';
  }

  /**
   * Send one claimed group. 'stop' ends the run and leaves the group's claims for a later run.
   * The idempotency key covers the group as handed in, so a replay repeats the first attempt's key
   * even when some members now fail to build: Resend then answers 409 for a batch it already took
   * (idem_conflict, no second copy) instead of mailing the rest again under a new key.
   */
  private async send(group: Claimed[], replay: boolean): Promise<'ok' | 'stop'> {
    const sorted = [...group].sort(byId);
    const built = await Promise.all(sorted.map((row) => this.build(row)));
    const broken = new Map<BuildError, Claimed[]>();
    const emails: BatchEmail[] = [];
    const members: Claimed[] = [];
    for (const b of built) {
      if ('error' in b) broken.set(b.error, [...(broken.get(b.error) ?? []), b.row]);
      else {
        emails.push(b.email);
        members.push(b.row);
      }
    }
    for (const [error, rows] of broken) {
      // On a replay the first attempt may already have been delivered, so the stored code says so
      // (it keeps counting toward the monthly empty-notice rule; claim.ts UNDELIVERED).
      const code = replay ? `replay_${error}` : error;
      const n = await markError(this.issue.id, rows.map((r) => r.id), code, this.db);
      this.out.failed += n;
      if (n > 0) this.buildFailed(error, rows);
    }
    if (emails.length === 0) return 'ok';

    const ids = members.map((m) => m.id);
    const key = idempotencyKey(this.issue.id, (replay ? sorted : members).map((m) => m.id));
    let mode: BatchMode = 'strict';
    let last = '';
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      await this.pace();
      const r = await this.call(emails, mode === 'strict' ? key : `${key}:p`, mode);
      if (r.ok) {
        await this.record(r, members, replay);
        return 'ok';
      }
      const next = classify(r.error);
      last = r.error.name;
      // Never the message: providers echo recipients back.
      console.warn(`[digest] ${this.issue.isoWeek}: batch of ${emails.length} (${mode}) got ${r.error.name} ${r.error.statusCode ?? '-'} -> ${next}`);
      if (next === 'permissive') {
        if (mode === 'strict') {
          mode = 'permissive';
          continue;
        }
        this.out.failed += await markError(this.issue.id, ids, 'invalid', this.db);
        return 'ok';
      }
      if (next === 'conflict') {
        // Same key, different body: on a replay, most likely a batch Resend already took whose bytes
        // changed since (a narrowed snapshot, a deploy, a member who no longer builds). Never resent.
        console.error(`[digest] ${this.issue.isoWeek}: idempotency conflict on ${key}; ${ids.length} claim(s) marked idem_conflict (the first attempt may have been delivered)`);
        this.out.failed += await markError(this.issue.id, ids, 'idem_conflict', this.db);
        return 'ok';
      }
      if (next === 'stop') {
        this.halt(r.error.name, false);
        return 'stop';
      }
      const wait = Math.min(r.retryAfterMs ?? 500 * 2 ** attempt, MAX_RETRY_WAIT_MS);
      if (attempt + 1 >= MAX_ATTEMPTS || this.timeLeft() <= wait) break;
      await this.c.sleep(wait);
    }
    // Still failing (5xx, network, rate limit): the claims go stale and a later run replays the same key.
    this.halt(`retry:${last}`, false);
    return 'stop';
  }

  /** Batch calls start at least PACE_MS apart. */
  private async pace() {
    const wait = this.lastCall + PACE_MS - this.now().getTime();
    if (wait > 0) await this.c.sleep(wait);
    this.lastCall = this.now().getTime();
  }

  private async call(emails: BatchEmail[], key: string, mode: BatchMode) {
    this.out.batches++;
    try {
      return await this.c.transport(emails, key, mode);
    } catch (e) {
      // A transport bug: the outcome is unknown, so treat it like a network error (same key again).
      console.error(`[digest] transport threw: ${describeError(e)}`);
      return { ok: false as const, error: { name: 'application_error', statusCode: null, message: 'threw' }, retryAfterMs: null };
    }
  }

  private async record(r: BatchOk, members: Claimed[], replay: boolean) {
    const id = this.issue.id;
    if (!r.ids) {
      console.error(`[digest] ${this.issue.isoWeek}: batch accepted but its ids could not be paired; ${members.length} claim(s) id_mismatch`);
      this.out.failed += await markError(id, members.map((m) => m.id), 'id_mismatch', this.db);
      return;
    }
    const got = r.ids;
    const pairs = members.flatMap((m, i) => (got[i] ? [{ subscriberId: m.id, resendId: got[i]! }] : []));
    const marked = await markSent(id, pairs, this.now(), this.db);
    if (replay) this.out.replayed += marked;
    else this.out.sent += marked;
    this.out.emptyNotices += members.filter((m, i) => got[i] && m.kind === 'empty').length;
    const invalid = new Set(r.invalid);
    const rejected = members.filter((_, i) => !got[i] && invalid.has(i)).map((m) => m.id);
    // Neither an id nor a reported error: never leave it to be retried as part of a different group.
    const unknown = members.filter((_, i) => !got[i] && !invalid.has(i)).map((m) => m.id);
    if (rejected.length) this.out.failed += await markError(id, rejected, 'invalid', this.db);
    if (unknown.length) this.out.failed += await markError(id, unknown, 'id_mismatch', this.db);
  }

  private async build(row: Claimed): Promise<Built> {
    const variant = parseVariantKey(row.variantKey);
    if (!variant) return { error: 'render_failed', row };
    const ck = `${row.kind}|${variant.key}`;
    let pending = this.cache.get(ck);
    if (!pending) {
      pending = this.render(row.kind, variant);
      this.cache.set(ck, pending);
    }
    try {
      const rendered = await pending;
      // A digest claim always has a pick for its categories and facets; null means select and claim disagree.
      if (!rendered) {
        this.logFailure(ck, 'no picks');
        return { error: 'no_picks', row };
      }
      const token = linkToken({ id: row.id, tokenVersion: row.tokenVersion });
      // Throws DigestTooLargeError over MAX_HTML_BYTES (as does the render): refused, never clipped.
      const { subject, html, text } = personalize(rendered, token);
      this.out.htmlMaxBytes = Math.max(this.out.htmlMaxBytes, Buffer.byteLength(html));
      // The variant's locale (fixed at claim time) and the frozen origin: a replay must be byte-identical.
      const links = linksFor(variant.locale, token, this.snap.origin);
      return {
        row,
        email: {
          from: this.from,
          to: row.email,
          subject,
          html,
          text,
          headers: {
            'List-Unsubscribe': `<${links.oneClick}>`,
            'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
            'X-Entity-Ref-ID': this.issue.id,
          },
          tags: [
            { name: 'kind', value: 'digest' },
            { name: 'issue', value: this.issue.id },
            { name: 'sub', value: row.id },
          ],
        },
      };
    } catch (e) {
      this.logFailure(ck, describeError(e));
      return { error: e instanceof DigestTooLargeError ? 'too_large' : 'render_failed', row };
    }
  }

  /** Rows that could not be built fail the run (counts per variant only), so the cron alerts. */
  private buildFailed(error: BuildError, rows: Claimed[]) {
    this.out.ok = false;
    this.out.reason ??= 'render_failed';
    const all = (this.out.buildFailures ??= {});
    for (const r of rows) {
      const k = `${r.kind}|${r.variantKey}`;
      all[k] = { error, rows: (all[k]?.rows ?? 0) + 1 };
    }
  }

  private render(kind: Claimed['kind'], variant: Variant): Promise<RenderedEmail | null> {
    return kind === 'empty' ? renderEmptyNotice(this.snap, variant) : renderVariant(this.snap, variant);
  }

  private logFailure(ck: string, why: string) {
    if (this.loggedFailures.has(ck)) return;
    this.loggedFailures.add(ck);
    console.error(`[digest] ${this.issue.isoWeek}: cannot build ${ck}: ${why}`);
  }
}
