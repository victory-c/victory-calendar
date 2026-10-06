import 'server-only';
import { db as defaultDb, type DB } from '../db';
import { sentTodayCount } from '../digest/claim';
import { DigestTooLargeError, personalize } from '../digest/render';
import { dailyCapFromEnv, DEFAULT_BUDGET_MS, LEASE, PACE_MS, releaseLease, takeLease } from '../digest/run';
import { byStart } from '../digest/select';
import { classify, digestFrom, MAX_BATCH, resendTransport, type BatchEmail, type BatchMode, type BatchOk, type BatchTransport } from '../digest/transport';
import type { DigestEvent, RenderedEmail } from '../digest/types';
import { maskEmail } from '../email/send';
import { publicOrigin } from '../host';
import { newId } from '../ids';
import { describeError } from '../log-safe';
import { alertsMode, type DigestMode } from '../newsletter/status';
import { linkToken } from '../subscribers/token';
import type { Locale } from '../taxonomy';
import {
  alertsTodayCount,
  anyAlertClaimable,
  claimAlerts,
  expireOldAlerts,
  markAlertsError,
  markAlertsSent,
  reclaimStaleAlerts,
  type AlertClaimed,
} from './claim';
import { alertPool, alertWindow, digestIssueOn, stillAlertable } from './pool';
import { ALERT_LINKS, alertLinks, renderAlert } from './render';

// F20 going alerts: the daily send (design G1–G9). Both crons (15:00 and 16:00 UTC, 07:00–09:00
// PT) run this same function, mirroring the digest's run (digest/run.ts) step for step:
//
//   expire dead claims → mode gate → the newsletter lease (shared with the digest) → replay stale
//   groups (only today's on a digest day) → digest-day skip → live pool → claim (one row per reader
//   per PT day) → re-check → send → mark
//
// Correctness never depends on timing: the (alert_day, subscriber_id) primary key allows one alert
// per reader per day and the claim skips a reader with an alert pending or sent since today 00:00
// PT (one alert email per PT day), an event that may have reached a reader is never claimed for
// them again, a claimed group is only ever re-sent under the Resend idempotency key fixed when it
// was claimed (its batch key), so a group that shrank since gets a 409 for a batch Resend already
// took (idem_conflict) rather than a second copy, and every event is re-checked live (still
// publicly going, kill switch on, not today) right before each send, first attempt or replay.
// Results and logs carry counts and codes only.

export type AlertBuildError = 'render_failed' | 'too_large';

export type AlertRunResult = {
  ok: boolean;
  /**
   * off: alertsMode() is off (no verified sender on Vercel, or ALERTS_SENDING=0): nothing claimed
   * or sent; only claims past 23 h are expired. locked: another newsletter run holds the lease.
   * digest_day: a digest goes out today (PT), so no new alert claims (one newsletter email a day);
   * only today's stale groups are replayed (an earlier day's expire: the digest carries their events).
   */
  skipped?: 'off' | 'locked' | 'digest_day';
  /** The Pacific day this run claims for (alert_sends.alert_day). */
  day?: string;
  /** Alertable events in the pool at the first claim. */
  pool: number;
  /** Rows newly claimed this run. */
  claimed: number;
  /** Fresh claims Resend accepted this run. */
  sent: number;
  /** Stale groups from an earlier run re-sent (and accepted) this run. */
  replayed: number;
  /** Rows given a final error this run (not ineligible): unmarked, invalid, refused:<name>, idem_conflict, id_mismatch, render_failed, too_large, expired. */
  failed: number;
  /** Replay members dropped because they unsubscribed, paused or turned alerts off since the claim. */
  ineligible: number;
  /** Emails that could not be built, by variant key (locale and event ids): the error and how many rows. Any entry makes ok false. */
  buildFailures?: Record<string, { error: AlertBuildError; rows: number }>;
  /** Batch calls made to the transport. */
  batches: number;
  /** Work is left for the next run (deadline, daily cap, a stop error). */
  partial?: boolean;
  reason?: string;
  /** Largest personalised HTML this run (bytes). */
  htmlMaxBytes: number;
};

export type AlertRunDeps = {
  db?: DB;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  transport?: BatchTransport;
  mode?: DigestMode;
  /** Stop starting new work after this long (default 240 s, under maxDuration 300 s). */
  budgetMs?: number;
  /** Newsletter emails (digest + alerts) per UTC day: DIGEST_DAILY_CAP, default 60. */
  dailyCap?: number;
  /** Alert emails per UTC day inside dailyCap: ALERT_DAILY_CAP, default 30. */
  alertCap?: number;
};

export const DEFAULT_ALERT_CAP = 30;
const MAX_ATTEMPTS = 4;
const MAX_RETRY_WAIT_MS = 5_000;

const zero = (): AlertRunResult => ({
  ok: true, pool: 0, claimed: 0, sent: 0, replayed: 0, failed: 0, ineligible: 0, batches: 0, htmlMaxBytes: 0,
});

export function alertCapFromEnv(raw = process.env.ALERT_DAILY_CAP): number {
  const n = Number(raw);
  return raw && Number.isFinite(n) && n >= 0 ? Math.floor(n) : DEFAULT_ALERT_CAP;
}

/**
 * `alert/{day}/{batch key}`: fixed when the group is claimed (alert_sends.batch_key), so every
 * attempt and replay of a group uses it whoever is still in the group; ≤ 256 chars.
 */
export function alertIdempotencyKey(alertDay: string, batchKey: string): string {
  return `alert/${alertDay}/${batchKey}`;
}

/** Local and CI ('dev' mode): one masked line per batch, nothing leaves the machine, rows get resend_id 'dev'. */
export const alertDevTransport: BatchTransport = async (emails, idempotencyKey, mode) => {
  if (emails.length < 1 || emails.length > MAX_BATCH) throw new Error(`alert batch size ${emails.length}`);
  console.info(`[alert:dev] batch n=${emails.length} mode=${mode} key=${idempotencyKey} first=${maskEmail(emails[0].to)} subject=${emails[0].subject}`);
  return { ok: true, ids: emails.map(() => 'dev'), invalid: [], dailyUsed: null };
};

export async function runAlerts(deps: AlertRunDeps = {}): Promise<AlertRunResult> {
  const out = zero();
  const mode = deps.mode ?? alertsMode();
  const db = deps.db ?? defaultDb;
  const clock = deps.now ?? (() => new Date());
  // No verified sender on Vercel (or alerts switched off), or no link secret: claim and send
  // nothing. Claims past 23 h can never be sent again, so they still expire (that needs neither):
  // left pending they would hold back a reader's deletion and the retention purge for as long as
  // sending stays off.
  if (mode === 'off' || !process.env.SUBSCRIBER_LINK_SECRET) {
    out.failed = await expireOldAlerts(clock(), db);
    return mode === 'off' ? { ...out, skipped: 'off' } : { ...out, ok: false, reason: 'no_link_secret' };
  }

  const started = clock();
  // The digest's lease: newsletter sends never overlap, so the shared daily cap can't be raced.
  if (!(await takeLease(db, started, LEASE))) return { ...out, skipped: 'locked' };
  try {
    await new AlertRun({
      db,
      clock,
      sleep: deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms))),
      transport: deps.transport ?? (mode === 'live' ? resendTransport() : alertDevTransport),
      started,
      deadline: started.getTime() + (deps.budgetMs ?? DEFAULT_BUDGET_MS),
      dailyCap: deps.dailyCap ?? dailyCapFromEnv(),
      alertCap: deps.alertCap ?? alertCapFromEnv(),
      out,
    }).go();
    return out;
  } finally {
    await releaseLease(db, started, LEASE).catch((e) => console.error(`[alerts] lease release failed: ${describeError(e)}`));
  }
}

type Built = { email: BatchEmail; row: AlertClaimed } | { error: AlertBuildError; row: AlertClaimed };
type Ctx = {
  db: DB;
  clock: () => Date;
  sleep: (ms: number) => Promise<void>;
  transport: BatchTransport;
  /** When this run took the lease: every claim made before it belongs to a run that is over. */
  started: Date;
  deadline: number;
  dailyCap: number;
  alertCap: number;
  out: AlertRunResult;
};

const byId = (a: AlertClaimed, b: AlertClaimed) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const localeOf = (variantKey: string): Locale | null => {
  const l = variantKey.slice(0, variantKey.indexOf(':'));
  return l === 'en' || l === 'zh' ? l : null;
};

class AlertRun {
  private readonly db: DB;
  private readonly out: AlertRunResult;
  private readonly from = digestFrom();
  /** Every link and the List-Unsubscribe target start with it; stable for a deployment, so a replay is byte-identical. */
  private readonly origin = publicOrigin();
  private lastCall = Number.NEGATIVE_INFINITY;
  /** One render per variant per run; each recipient only swaps in their own token. */
  private readonly cache = new Map<string, Promise<RenderedEmail>>();
  private readonly loggedFailures = new Set<string>();

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
    const w = alertWindow(this.now());
    this.out.day = w.day;
    this.out.failed += await expireOldAlerts(this.now(), this.db);
    // Digest day (G3): the weekly email goes out today, so nobody gets an alert too.
    const digestDay = await digestIssueOn(w.day, this.db);

    // 1. Groups an earlier run claimed but never marked: the members still eligible, under the
    //    key fixed at claim time, re-checked live. A group handled once is not taken again this
    //    run. On a digest day an earlier day's group is left to expire (the digest carries its
    //    events), so it can't land next to the digest.
    const replayed: string[] = [];
    for (;;) {
      if (this.timeLeft() <= 0) return this.halt('deadline', true);
      const group = await reclaimStaleAlerts(this.now(), this.c.started, this.db, { skip: replayed, fromDay: digestDay ? w.day : undefined });
      if (!group) break;
      replayed.push(group.batchKey);
      this.out.ineligible += group.ineligible;
      if (group.rows.length === 0) continue;
      if ((await this.send(group.alertDay, group.batchKey, group.rows, true)) === 'stop') return;
    }

    // 2. Digest day: no new claims. Today's marks wait for tomorrow, which skips what the digest
    //    already showed with a seal.
    if (digestDay) {
      this.out.skipped = 'digest_day';
      return;
    }

    // 3. Fresh claims from the live pool, oldest subscribers first, up to 100 per call. Room is
    //    the alert cap and the shared newsletter cap, both counting everything committed today.
    let first = true;
    for (;;) {
      if (this.timeLeft() <= 0) return this.halt('deadline', true);
      const at = this.now();
      const pool = await alertPool({ db: this.db, now: at });
      if (first) this.out.pool = pool.events.length;
      first = false;
      if (pool.events.length === 0) break;
      const [alerts, all] = await Promise.all([alertsTodayCount(at, this.db), sentTodayCount(at, this.db)]);
      const room = Math.min(this.c.alertCap - alerts, this.c.dailyCap - all);
      if (room <= 0) {
        // Only a real overflow is reported; the waiting readers' events merge into tomorrow's alert.
        if (await anyAlertClaimable(w.day, pool, at, this.db)) this.halt('daily_cap', true);
        break;
      }
      const batchKey = newId('abk');
      const rows = await claimAlerts(w.day, pool, Math.min(MAX_BATCH, room), batchKey, at, this.db);
      if (rows.length === 0) break;
      this.out.claimed += rows.length;
      if ((await this.send(w.day, batchKey, rows, false)) === 'stop') return;
    }
  }

  /**
   * Send one claimed group. 'stop' ends the run and leaves the group's claims for a later run,
   * except after a definitive refusal on a fresh group's first delivery attempt (see below).
   * First every event is re-checked live (A3): a row with an event that may no longer be mailed is
   * held back for good (unmarked; replay_unmarked on a replay, whose first attempt may have gone
   * out). The idempotency key is the group's batch key, fixed at claim time: a replay whose group
   * shrank since (a member dropped out, failed to build or was held back) keeps the first attempt's
   * key, so Resend answers 409 for a batch it already took (idem_conflict, no second copy).
   */
  private async send(alertDay: string, batchKey: string, group: AlertClaimed[], replay: boolean): Promise<'ok' | 'stop'> {
    const sorted = [...group].sort(byId);
    const live = await stillAlertable(
      sorted.flatMap((r) => r.eventIds),
      { db: this.db, now: this.now() },
    );
    const stale = sorted.filter((r) => r.eventIds.length === 0 || r.eventIds.some((id) => !live.has(id)));
    if (stale.length) {
      this.out.failed += await markAlertsError(alertDay, stale.map((r) => r.id), replay ? 'replay_unmarked' : 'unmarked', this.db);
    }
    const fresh = sorted.filter((r) => !stale.includes(r));
    const built = await Promise.all(fresh.map((row) => this.build(alertDay, row, live)));
    const broken = new Map<AlertBuildError, AlertClaimed[]>();
    const emails: BatchEmail[] = [];
    const members: AlertClaimed[] = [];
    for (const b of built) {
      if ('error' in b) broken.set(b.error, [...(broken.get(b.error) ?? []), b.row]);
      else {
        emails.push(b.email);
        members.push(b.row);
      }
    }
    for (const [error, rows] of broken) {
      const n = await markAlertsError(alertDay, rows.map((r) => r.id), replay ? `replay_${error}` : error, this.db);
      this.out.failed += n;
      if (n > 0) this.buildFailed(error, rows);
    }
    if (emails.length === 0) return 'ok';

    const ids = members.map((m) => m.id);
    const key = alertIdempotencyKey(alertDay, batchKey);
    let mode: BatchMode = 'strict';
    let last = '';
    // Whether an earlier attempt of this group may have been delivered: always on a replay, and
    // after any attempt with an unknown outcome (5xx, network, rate limit) in this loop.
    let mayHaveSent = replay;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      await this.pace();
      const r = await this.call(emails, mode === 'strict' ? key : `${key}:p`, mode);
      if (r.ok) {
        await this.record(alertDay, r, members, replay);
        return 'ok';
      }
      const next = classify(r.error);
      last = r.error.name;
      // Never the message: providers echo recipients back.
      console.warn(`[alerts] ${alertDay}: batch of ${emails.length} (${mode}) got ${r.error.name} ${r.error.statusCode ?? '-'} -> ${next}`);
      if (next === 'permissive') {
        if (mode === 'strict') {
          mode = 'permissive';
          continue;
        }
        this.out.failed += await markAlertsError(alertDay, ids, 'invalid', this.db);
        return 'ok';
      }
      if (next === 'conflict') {
        console.error(`[alerts] ${alertDay}: idempotency conflict on ${key}; ${ids.length} claim(s) marked idem_conflict (the first attempt may have been delivered)`);
        this.out.failed += await markAlertsError(alertDay, ids, 'idem_conflict', this.db);
        return 'ok';
      }
      if (next === 'stop') {
        // Refused outright (quota, sender, key) with nothing of this group sent before, under a key
        // nobody used yet: the rows are freed (refused:<name>), so their events merge into each
        // reader's next alert instead of being held back as maybe-delivered. Otherwise the claims
        // stay for a later run (and expire after 23 h).
        if (!mayHaveSent) {
          const code = /^[a-z_]{1,40}$/.test(r.error.name) ? r.error.name : 'other';
          this.out.failed += await markAlertsError(alertDay, ids, `refused:${code}`, this.db);
        }
        this.halt(r.error.name, false);
        return 'stop';
      }
      mayHaveSent = true;
      const wait = Math.min(r.retryAfterMs ?? 500 * 2 ** attempt, MAX_RETRY_WAIT_MS);
      if (attempt + 1 >= MAX_ATTEMPTS || this.timeLeft() <= wait) break;
      await this.c.sleep(wait);
    }
    // Still failing (5xx, network, rate limit): the claims go stale and a later run replays the same key.
    this.halt(`retry:${last}`, false);
    return 'stop';
  }

  /** Batch calls start at least PACE_MS apart (the team limit is shared with the digest and magic links). */
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
      console.error(`[alerts] transport threw: ${describeError(e)}`);
      return { ok: false as const, error: { name: 'application_error', statusCode: null, message: 'threw' }, retryAfterMs: null };
    }
  }

  private async record(alertDay: string, r: BatchOk, members: AlertClaimed[], replay: boolean) {
    if (!r.ids) {
      console.error(`[alerts] ${alertDay}: batch accepted but its ids could not be paired; ${members.length} claim(s) id_mismatch`);
      this.out.failed += await markAlertsError(alertDay, members.map((m) => m.id), 'id_mismatch', this.db);
      return;
    }
    const got = r.ids;
    const pairs = members.flatMap((m, i) => (got[i] ? [{ subscriberId: m.id, resendId: got[i]! }] : []));
    const marked = await markAlertsSent(alertDay, pairs, this.now(), this.db);
    if (replay) this.out.replayed += marked;
    else this.out.sent += marked;
    const invalid = new Set(r.invalid);
    const rejected = members.filter((_, i) => !got[i] && invalid.has(i)).map((m) => m.id);
    const unknown = members.filter((_, i) => !got[i] && !invalid.has(i)).map((m) => m.id);
    if (rejected.length) this.out.failed += await markAlertsError(alertDay, rejected, 'invalid', this.db);
    if (unknown.length) this.out.failed += await markAlertsError(alertDay, unknown, 'id_mismatch', this.db);
  }

  private async build(alertDay: string, row: AlertClaimed, live: ReadonlyMap<string, DigestEvent>): Promise<Built> {
    const locale = localeOf(row.variantKey);
    if (!locale) return { error: 'render_failed', row };
    let pending = this.cache.get(row.variantKey);
    if (!pending) {
      const events = row.eventIds.map((id) => live.get(id)!).sort(byStart);
      pending = renderAlert(events, locale, this.origin);
      this.cache.set(row.variantKey, pending);
    }
    try {
      const rendered = await pending;
      const token = linkToken({ id: row.id, tokenVersion: row.tokenVersion });
      // Throws DigestTooLargeError over MAX_HTML_BYTES (as does the render): refused, never clipped.
      const { subject, html, text } = personalize(rendered, token, ALERT_LINKS);
      this.out.htmlMaxBytes = Math.max(this.out.htmlMaxBytes, Buffer.byteLength(html));
      return {
        row,
        email: {
          from: this.from,
          to: row.email,
          subject,
          html,
          text,
          headers: {
            // RFC 8058, scoped to this list: a one-click POST turns off going alerts only.
            'List-Unsubscribe': `<${alertLinks(locale, token, this.origin).oneClick}>`,
            'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
            'X-Entity-Ref-ID': `alert/${alertDay}`,
          },
          tags: [
            { name: 'kind', value: 'alert' },
            { name: 'day', value: alertDay },
            { name: 'sub', value: row.id },
          ],
        },
      };
    } catch (e) {
      this.logFailure(row.variantKey, describeError(e));
      return { error: e instanceof DigestTooLargeError ? 'too_large' : 'render_failed', row };
    }
  }

  /** Rows that could not be built fail the run (counts per variant only), so the cron alerts. */
  private buildFailed(error: AlertBuildError, rows: AlertClaimed[]) {
    this.out.ok = false;
    this.out.reason ??= 'render_failed';
    const all = (this.out.buildFailures ??= {});
    for (const r of rows) all[r.variantKey] = { error, rows: (all[r.variantKey]?.rows ?? 0) + 1 };
  }

  private logFailure(variantKey: string, why: string) {
    if (this.loggedFailures.has(variantKey)) return;
    this.loggedFailures.add(variantKey);
    console.error(`[alerts] cannot build ${variantKey}: ${why}`);
  }
}
