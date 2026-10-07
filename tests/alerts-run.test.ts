import { readFileSync } from 'node:fs';
import { eq, sql } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { testDb } from './helpers/pglite';

// F20 going alerts, the send side (design G1–G9, acceptance A1–A6), on PGlite with an injected
// transport, clock and sleep. The pool, claims, re-checks, caps, lease and replay are the real code;
// the email is a small double that keeps the real contract (three placeholder links, picks 0,
// DigestTooLargeError over the limit) unless a test sets `h.real`, which runs the real renderAlert
// end to end. The default db handle points at the test's PGlite (settings are read through it).

const h = vi.hoisted(() => ({
  db: null as unknown,
  real: false,
  renders: [] as string[],
  /** renderAlert throws for a variant containing this event id. */
  failOn: null as string | null,
  /** renderAlert reports this variant as over the size limit. */
  hugeOn: null as string | null,
}));

vi.mock('@/lib/db', async (orig) => ({
  ...(await orig()),
  db: new Proxy({}, { get: (_t, p) => Reflect.get(h.db as object, p) }),
  hasDatabase: () => true,
}));

vi.mock('@/lib/alerts/render', async (orig) => {
  const real = await orig<typeof import('@/lib/alerts/render')>();
  const { DigestTooLargeError, TOKEN } = await import('@/lib/digest/render');
  type Ev = import('@/lib/digest/types').DigestEvent;
  return {
    ...real,
    renderAlert: async (events: Ev[], locale: 'en' | 'zh', origin: string) => {
      h.renders.push(`${locale}:${events.map((e) => e.id).join(',')}`);
      if (h.real) return real.renderAlert(events, locale, origin);
      if (h.failOn && events.some((e) => e.id === h.failOn)) throw new Error('render exploded');
      if (h.hugeOn && events.some((e) => e.id === h.hugeOn)) throw new DigestTooLargeError('alert html is 95000 bytes (limit 90000)');
      const l = real.alertLinks(locale, TOKEN, origin);
      const body = events.map((e) => `<p>${e.titleEn} · ${e.seal}</p>`).join('');
      const html = `<!doctype html><html lang="${locale}"><body>${body}<a href="${l.offAlerts}">off</a> <a href="${l.prefs}">prefs</a> <a href="${l.unsubscribe}">all</a></body></html>`;
      const text = `${events.map((e) => e.titleEn).join('\n')}\n<${l.offAlerts}>\n<${l.prefs}>\n<${l.unsubscribe}>`;
      const subject = `${locale} · ${events.map((e) => e.id).join(',')}`;
      return { subject, preheader: '', html, text, bytes: html.length, picks: 0, going: events.length };
    },
  };
});

const { runAlerts, alertIdempotencyKey, alertCapFromEnv } = await import('@/lib/alerts/run');
const claim = await import('@/lib/alerts/claim');
const { alertPool, alertWindow, stillAlertable } = await import('@/lib/alerts/pool');
const { runDigest, LEASE, PACE_MS } = await import('@/lib/digest/run');
const { sentTodayCount } = await import('@/lib/digest/claim');
const { setGoing } = await import('@/lib/admin/events');
const { alertSends, covers, digestIssues, digestSends, events, goingMarks, jobsLog, settings, subscribers, syncState } = await import(
  '@/lib/db/schema'
);
const { templateCoverRow } = await import('@/lib/covers/template');
const { newId } = await import('@/lib/ids');
const { linkToken } = await import('@/lib/subscribers/token');
const cronRoute = await import('@/app/api/cron/alerts/route');
type DB = import('@/lib/db').DB;
type NewEvent = import('@/lib/db/schema').NewEvent;
type Sub = typeof subscribers.$inferSelect;
type BatchEmail = import('@/lib/digest/transport').BatchEmail;
type BatchMode = import('@/lib/digest/transport').BatchMode;
type BatchOk = import('@/lib/digest/transport').BatchOk;
type BatchErr = import('@/lib/digest/transport').BatchErr;
type BatchTransport = import('@/lib/digest/transport').BatchTransport;
type AlertRunDeps = import('@/lib/alerts/run').AlertRunDeps;

const MIN = 60_000;
const HOUR = 3600_000;
const DAY = 864e5;
/** Wednesday 2026-10-07 08:00 PDT: the 15:00 UTC cron. */
const RUN = new Date('2026-10-07T15:00:00Z');
const TODAY = '2026-10-07';
/** Tuesday 2026-10-06 11:00 PDT: a mark made the day before the run. */
const MARKED = new Date('2026-10-06T18:00:00Z');
/** Friday 2026-10-09 18:30 PDT. */
const FRI = new Date('2026-10-10T01:30:00Z');

// Each test starts a fresh PGlite with every migration: slow on a busy machine.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

let db: DB;
let n = 0;
let seq = 0;

beforeEach(async () => {
  db = (await testDb()).db as unknown as DB;
  h.db = db;
  h.real = false;
  h.renders = [];
  h.failOn = null;
  h.hugeOn = null;
  vi.stubEnv('SUBSCRIBER_LINK_SECRET', 'test-secret-alerts-0123456789');
  vi.stubEnv('RESEND_FROM', "Victor's Picks <picks@mail.picks.test>");
  vi.stubEnv('PUBLIC_HOST', 'picks.test');
  vi.stubEnv('SHOW_ATTENDANCE', '');
  vi.stubEnv('ALERTS_SENDING', '');
  vi.stubEnv('DIGEST_SENDING', '');
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

// ---- fixtures ----------------------------------------------------------------------------------

/** An active English reader of AI events with going alerts on, confirmed a month before the run. */
async function seedSub(over: Partial<typeof subscribers.$inferInsert> = {}): Promise<Sub> {
  const [row] = await db
    .insert(subscribers)
    .values({
      id: newId('sub'), email: `reader${++n}@example.org`, status: 'active', locale: 'en', categories: ['ai'], goingAlerts: true,
      consentAt: new Date(RUN.getTime() - 30 * DAY), confirmedAt: new Date(RUN.getTime() - 30 * DAY + n * MIN), ...over,
    })
    .returning();
  return row;
}

/** A published Luma AI event Friday evening that Victor is publicly going to (no mark unless mark() is called). */
async function addEvent(over: Partial<NewEvent> = {}): Promise<string> {
  const id = over.id ?? `evt_${String(++seq).padStart(4, '0')}`;
  const coverId = `cov_${id.slice(4)}`;
  await db.insert(covers).values({ id: coverId, ...templateCoverRow('ai', null) });
  const startAt = over.startAt ?? FRI;
  await db.insert(events).values({
    slug: `event-${id}`, status: 'published', sourceUrl: `https://luma.com/${id}`, titleEn: `Event ${id}`, titleZh: `活动 ${id}`,
    noteEn: 'Worth it.', category: 'ai', startAt, endAt: startAt ? new Date(startAt.getTime() + 2.5 * HOUR) : null,
    tz: 'America/Los_Angeles', city: 'San Francisco', neighborhood: 'SoMa', format: 'in_person', going: 'going', goingVisibility: 'public',
    coverId, ...over, id,
  });
  return id;
}

const mark = (eventId: string, markedAt = MARKED, alert = true) => db.insert(goingMarks).values({ eventId, markedAt, alert });

/** An event marked going the day before the run. */
async function marked(over: Partial<NewEvent> = {}, at = MARKED): Promise<string> {
  const id = await addEvent(over);
  await mark(id, at);
  return id;
}

const rows = async () => (await db.select().from(alertSends)).sort((a, b) => (a.subscriberId < b.subscriberId ? -1 : 1));
const rowOf = async (sub: { id: string }, day = TODAY) =>
  (await db.select().from(alertSends).where(eq(alertSends.subscriberId, sub.id))).find((r) => r.alertDay === day);
const sorted = (...ids: string[]) => [...ids].sort();
/** The batch key the claim gave this subscriber's row (the group's Resend idempotency key). */
const batchKeyOf = async (subscriberId: string, day = TODAY) =>
  (await db.select().from(alertSends).where(eq(alertSends.subscriberId, subscriberId))).find((r) => r.alertDay === day)!.batchKey!;

function fakeClock(start: Date) {
  let t = start.getTime();
  const sleep = vi.fn(async (ms: number) => void (t += ms));
  return { now: () => new Date(t), set: (d: Date) => void (t = d.getTime()), advance: (ms: number) => void (t += ms), sleep };
}

type Call = { emails: BatchEmail[]; key: string; mode: BatchMode; json: string };
type Script = (call: Call, index: number) => BatchOk | BatchErr | undefined;

function fakeTransport(script?: Script) {
  const calls: Call[] = [];
  const t: BatchTransport = async (emails, key, mode) => {
    const call = { emails: structuredClone(emails), key, mode, json: JSON.stringify(emails) };
    calls.push(call);
    return script?.(call, calls.length - 1) ?? { ok: true, ids: emails.map((_, i) => `re_${calls.length}_${i}`), invalid: [], dailyUsed: null };
  };
  return { t, calls, sent: () => calls.flatMap((c) => c.emails) };
}

const err = (name: string, statusCode: number | null, retryAfterMs: number | null = null): BatchErr => ({ ok: false, error: { name, statusCode, message: 'x' }, retryAfterMs });

/** Resend-like: the same key with the same body is a replay (same ids); a different body is a 409. */
function resendLike() {
  const seen = new Map<string, string>();
  return (call: Call) => {
    const first = seen.get(call.key);
    if (first === undefined) return void seen.set(call.key, call.json);
    return first === call.json ? undefined : err('invalid_idempotent_request', 409);
  };
}

const sqlText = (q: unknown) => (typeof q === 'string' ? q : new PgDialect().sqlToQuery((q as { getSQL: () => import('drizzle-orm').SQL }).getSQL()).sql);

/** Wraps `execute`: `before` runs ahead of the first statement containing `needle` (it may throw), `after` once it is done. */
function hook(real: DB, needle: string, on: { before?: () => Promise<unknown>; after?: () => Promise<unknown> }) {
  let armed = true;
  return new Proxy(real, {
    get(t, p) {
      if (p === 'execute') {
        return async (q: Parameters<DB['execute']>[0]) => {
          const hit = armed && sqlText(q).includes(needle);
          if (hit) armed = false;
          if (hit && on.before) await on.before();
          const r = await t.execute(q);
          if (hit && on.after) await on.after();
          return r;
        };
      }
      const v = Reflect.get(t, p, t);
      return typeof v === 'function' ? v.bind(t) : v;
    },
  });
}

const crashOnce = (real: DB, needle: string) => hook(real, needle, { before: async () => { throw new Error('connection lost'); } });

/** Any database access fails the test. */
const noDb = new Proxy({}, { get: () => { throw new Error('database touched'); } }) as DB;

function setup(start = RUN, script?: Script) {
  const clock = fakeClock(start);
  const tr = fakeTransport(script);
  const run = (over: Partial<AlertRunDeps> = {}) =>
    runAlerts({ db, now: clock.now, sleep: clock.sleep, transport: tr.t, mode: 'live', dailyCap: 1000, alertCap: 1000, ...over });
  return { clock, tr, run };
}

const subTag = (e: BatchEmail) => e.tags.find((t) => t.name === 'sub')!.value;

// ---- the window and the pool -------------------------------------------------------------------

describe('alertWindow: Pacific midnights, DST-safe', () => {
  it('a PDT day', () => {
    expect(alertWindow(RUN)).toEqual({
      day: TODAY, since: new Date(RUN.getTime() - 7 * DAY), cutoff: new Date('2026-10-07T07:00:00Z'), startsFrom: new Date('2026-10-08T07:00:00Z'),
    });
  });

  it('across the fall-back change: the day after it starts at 08:00 UTC', () => {
    // Sunday 2026-11-01 is 25 hours long.
    expect(alertWindow(new Date('2026-11-01T15:00:00Z'))).toMatchObject({
      day: '2026-11-01', cutoff: new Date('2026-11-01T07:00:00Z'), startsFrom: new Date('2026-11-02T08:00:00Z'),
    });
    expect(alertWindow(new Date('2026-11-02T15:00:00Z'))).toMatchObject({
      day: '2026-11-02', cutoff: new Date('2026-11-02T08:00:00Z'), startsFrom: new Date('2026-11-03T08:00:00Z'),
    });
  });

  it('across the spring-forward change', () => {
    expect(alertWindow(new Date('2027-03-15T15:00:00Z'))).toMatchObject({
      day: '2027-03-15', cutoff: new Date('2027-03-15T07:00:00Z'), startsFrom: new Date('2027-03-16T07:00:00Z'),
    });
    expect(alertWindow(new Date('2027-03-14T16:00:00Z'))).toMatchObject({ cutoff: new Date('2027-03-14T08:00:00Z'), startsFrom: new Date('2027-03-15T07:00:00Z') });
  });
});

describe('alertPool: live, publicly going, marked before today, not today (A3, G1, G2)', () => {
  it('keeps only events that still pass publicGoing and the alert switch', async () => {
    const good = await marked();
    const hosting = await marked({ going: 'hosting' });
    const speaking = await marked({ going: 'speaking' });
    const exclusions = [
      await marked({ going: 'interested' }), // unmarked since
      await marked({ going: 'none' }),
      await marked({ goingVisibility: 'hidden' }),
      await marked({ goingVisibility: 'after_event' }),
      await marked({ privateVenue: true }), // a going downgraded since
      await marked({ sourceUrl: 'https://example.org/party' }),
      await marked({ category: 'cycling', going: 'hosting' }),
      await marked({ status: 'archived' }), // unpublished
      await marked({ status: 'cancelled' }),
      await marked({ status: 'draft' }),
    ];
    const off = await addEvent();
    await mark(off, MARKED, false); // Victor's switch off
    const pool = await alertPool({ db, now: RUN });
    expect(pool.events.map((e) => e.id).sort()).toEqual(sorted(good, hosting, speaking));
    expect(pool.events.map((e) => e.seal).sort()).toEqual(['going', 'hosting', 'speaking']);
    expect(pool.cutoff).toEqual(new Date('2026-10-07T07:00:00Z'));
    expect(pool.markedAt.get(good)).toEqual(MARKED);
    expect(exclusions).toHaveLength(10);
  });

  it('the attendance kill switch empties it (settings row or SHOW_ATTENDANCE=false)', async () => {
    await marked();
    await db.insert(settings).values({ key: 'show_attendance', value: { on: false } });
    expect((await alertPool({ db, now: RUN })).events).toEqual([]);
    await db.delete(settings);
    vi.stubEnv('SHOW_ATTENDANCE', 'false');
    expect((await alertPool({ db, now: RUN })).events).toEqual([]);
    vi.stubEnv('SHOW_ATTENDANCE', '');
    expect((await alertPool({ db, now: RUN })).events).toHaveLength(1);
  });

  it('marks from [now − 7 days, today 00:00 PT) only', async () => {
    const old = await marked({}, new Date(RUN.getTime() - 7 * DAY - MIN));
    const week = await marked({}, new Date(RUN.getTime() - 7 * DAY + MIN));
    const lastMinute = await marked({}, new Date('2026-10-07T06:59:59Z')); // Tue 23:59:59 PDT
    const today = await marked({}, new Date('2026-10-07T07:00:00Z')); // Wed 00:00 PDT
    const ids = (await alertPool({ db, now: RUN })).events.map((e) => e.id);
    expect(ids.sort()).toEqual(sorted(week, lastMinute));
    expect(ids).not.toContain(old);
    expect(ids).not.toContain(today);
  });

  it('events starting before tomorrow 00:00 PT are never alerted (same day, already over)', async () => {
    const tonight = await marked({ startAt: new Date('2026-10-08T06:59:00Z') }); // Wed 23:59 PDT
    const midnight = await marked({ startAt: new Date('2026-10-08T07:00:00Z') }); // Thu 00:00 PDT
    await marked({ startAt: new Date('2026-10-07T16:00:00Z') }); // this morning
    await marked({ startAt: new Date('2026-10-06T01:00:00Z'), endAt: new Date('2026-10-06T03:00:00Z') }); // went
    const ids = (await alertPool({ db, now: RUN })).events.map((e) => e.id);
    expect(ids).toEqual([midnight]);
    expect(ids).not.toContain(tonight);
  });

  it('DST: on the PST Monday after the change, the cutoff and "tomorrow" are 08:00 UTC', async () => {
    const mon = new Date('2026-11-02T15:00:00Z'); // Mon 07:00 PST
    const sunLate = await marked({ startAt: new Date('2026-11-05T02:00:00Z') }, new Date('2026-11-02T07:30:00Z')); // marked Sun 23:30 PST
    await marked({ startAt: new Date('2026-11-05T02:00:00Z') }, new Date('2026-11-02T08:00:00Z')); // marked Mon 00:00 PST
    await marked({ startAt: new Date('2026-11-03T07:59:00Z') }); // Mon 23:59 PST: still today
    const tue = await marked({ startAt: new Date('2026-11-03T08:00:00Z') }); // Tue 00:00 PST
    const marks = await db.select().from(goingMarks);
    await db.update(goingMarks).set({ markedAt: new Date('2026-11-01T20:00:00Z') }).where(eq(goingMarks.eventId, tue));
    expect(marks).toHaveLength(4);
    expect((await alertPool({ db, now: mon })).events.map((e) => e.id).sort()).toEqual(sorted(sunLate, tue));
  });

  it('stillAlertable re-checks claimed ids live, whatever the age of the mark', async () => {
    const a = await marked();
    const b = await marked();
    const c = await marked();
    await db.update(goingMarks).set({ markedAt: new Date('2026-10-07T12:00:00Z') }).where(eq(goingMarks.eventId, a)); // re-marked today
    await db.update(events).set({ going: 'interested' }).where(eq(events.id, b));
    await db.update(goingMarks).set({ alert: false }).where(eq(goingMarks.eventId, c));
    expect([...(await stillAlertable([a, b, c, 'evt_missing'], { db, now: RUN })).keys()]).toEqual([a]);
  });
});

// ---- claims ------------------------------------------------------------------------------------

describe('runAlerts: who gets what', () => {
  it('A1: two marks on the same Pacific day → one email per reader with both events', async () => {
    const a = await marked();
    const b = await marked({ startAt: new Date(FRI.getTime() + DAY) }, new Date('2026-10-07T05:00:00Z')); // Tue 22:00 PDT
    const en = await seedSub();
    const zh = await seedSub({ locale: 'zh' });
    const { run, tr } = setup();
    expect(await run()).toMatchObject({ ok: true, day: TODAY, pool: 2, claimed: 2, sent: 2, replayed: 0, failed: 0, batches: 1 });
    expect(tr.sent().map((e) => e.to).sort()).toEqual([en.email, zh.email].sort());
    const ids = sorted(a, b);
    for (const s of [en, zh]) {
      expect(await rowOf(s)).toMatchObject({ eventIds: ids, variantKey: `${s.locale}:${ids.join(',')}`, error: null, sentAt: RUN });
    }
    // One render per variant, events by start time.
    expect(h.renders.sort()).toEqual([`en:${a},${b}`, `zh:${a},${b}`]);
  });

  it('A2: the 16:00 run and later runs that day add nothing; a mark after midnight waits for tomorrow, alone', async () => {
    const a = await marked({}, new Date('2026-10-07T06:59:00Z')); // Tue 23:59 PDT
    const b = await marked({}, new Date('2026-10-07T07:00:00Z')); // Wed 00:00 PDT
    const s = await seedSub();
    const { run, tr, clock } = setup();
    expect(await run()).toMatchObject({ claimed: 1, sent: 1 });
    clock.advance(HOUR);
    expect(await run()).toMatchObject({ ok: true, claimed: 0, sent: 0, batches: 0 });
    clock.set(new Date(RUN.getTime() + DAY));
    expect(await run()).toMatchObject({ claimed: 1, sent: 1 });
    expect(tr.calls.map((c) => c.emails.map((e) => e.subject))).toEqual([[`en · ${a}`], [`en · ${b}`]]);
    const all = await rows();
    expect(all.map((r) => [r.alertDay, r.eventIds]).sort()).toEqual([[TODAY, [a]], ['2026-10-08', [b]]]);
    expect(all.every((r) => r.subscriberId === s.id)).toBe(true);
  });

  it('racing claims never overlap; racing runs: one waits for the lease', async () => {
    await marked();
    const subs = await Promise.all(Array.from({ length: 8 }, () => seedSub()));
    const pool = await alertPool({ db, now: RUN });
    const results = await Promise.all(Array.from({ length: 4 }, (_, i) => claim.claimAlerts(TODAY, pool, 8, `abk_${i}`, RUN, db)));
    const ids = results.flat().map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.sort()).toEqual(subs.map((s) => s.id).sort());
    await db.delete(alertSends);
    const { run } = setup();
    const runs = await Promise.all([run(), run()]);
    expect(runs.map((r) => r.skipped ?? 'ran').sort()).toEqual(['locked', 'ran']);
    expect(await rows()).toHaveLength(8);
  });

  it('A4: only digest-eligible readers with going alerts on', async () => {
    await marked();
    const yes = [
      await seedSub(),
      await seedSub({ status: 'paused', pausedUntil: new Date(RUN.getTime() - DAY) }),
      await seedSub({ status: 'paused', pausedUntil: null }),
    ];
    for (const over of [
      { goingAlerts: false },
      { status: 'unsubscribed' as const },
      { status: 'suppressed' as const },
      { status: 'pending' as const },
      { status: 'paused' as const, pausedUntil: new Date(RUN.getTime() + DAY) },
      { categories: [] },
      { categories: ['crypto'] },
    ]) {
      await seedSub(over);
    }
    const { run, tr } = setup();
    expect(await run()).toMatchObject({ claimed: 3, sent: 3 });
    expect(tr.sent().map((e) => e.to).sort()).toEqual(yes.map((s) => s.email).sort());
  });

  it("G4: the reader's categories and F19 facets, like the digest's going list", async () => {
    const enAi = await marked({ eventLanguage: 'en' });
    const zhAi = await marked({ eventLanguage: 'zh' });
    const biAi = await marked({ eventLanguage: 'bilingual' });
    const online = await marked({ format: 'online', city: null, neighborhood: null });
    const hybrid = await marked({ format: 'hybrid' });
    const vc = await marked({ category: 'vc' });
    const all = await seedSub({ categories: ['ai', 'vc'] });
    const aiOnly = await seedSub();
    const zh = await seedSub({ evLangPref: ['zh'] });
    const remote = await seedSub({ onlineOnly: true, categories: ['ai', 'vc'] });
    const campus = await seedSub({ categories: ['campus'] });
    const odd = await seedSub({ evLangPref: ['en', 'zh'] }); // malformed: no preference
    const { run } = setup();
    await run();
    expect((await rowOf(all))?.eventIds).toEqual(sorted(enAi, zhAi, biAi, online, hybrid, vc));
    expect((await rowOf(aiOnly))?.eventIds).toEqual(sorted(enAi, zhAi, biAi, online, hybrid));
    expect((await rowOf(zh))?.eventIds).toEqual(sorted(zhAi, biAi));
    expect((await rowOf(remote))?.eventIds).toEqual(sorted(online, hybrid));
    expect(await rowOf(campus)).toBeUndefined();
    expect((await rowOf(odd))?.eventIds).toEqual((await rowOf(aiOnly))?.eventIds);
  });

  it('G6: only marks made after the reader turned alerts on (going_alerts_since, else confirmed_at)', async () => {
    const early = await marked({}, new Date('2026-10-06T08:00:00Z'));
    const late = await marked({}, new Date('2026-10-06T20:00:00Z'));
    const optedIn = await seedSub({ goingAlertsSince: new Date('2026-10-06T12:00:00Z') });
    const confirmedLate = await seedSub({ confirmedAt: new Date('2026-10-06T12:00:00Z') });
    const longAgo = await seedSub({ goingAlertsSince: null });
    // Opted in at sign-up (before confirming): the sign-up time counts.
    const atSignup = await seedSub({ goingAlertsSince: new Date('2026-10-06T07:00:00Z'), confirmedAt: new Date('2026-10-06T21:00:00Z') });
    const { run } = setup();
    await run();
    expect((await rowOf(optedIn))?.eventIds).toEqual([late]);
    expect((await rowOf(confirmedLate))?.eventIds).toEqual([late]);
    expect((await rowOf(longAgo))?.eventIds).toEqual(sorted(early, late));
    expect((await rowOf(atSignup))?.eventIds).toEqual(sorted(early, late));
  });

  it('one alert email per PT day: a reader with an alert still pending, or sent since today 00:00 PT, is not claimed', async () => {
    await marked();
    const pending = await seedSub();
    const sentToday = await seedSub();
    const sentYesterday = await seedSub();
    const free = await seedSub();
    const other = await addEvent({ startAt: new Date(FRI.getTime() + DAY) });
    // Rows of an earlier alert_day: one still waiting (a group a replay will retry), one replayed
    // this morning, one delivered yesterday evening (PT).
    await db.insert(alertSends).values([
      { alertDay: '2026-10-06', subscriberId: pending.id, eventIds: [other], variantKey: `en:${other}`, claimedAt: new Date('2026-10-06T16:30:00Z'), batchKey: 'abk_old' },
      { alertDay: '2026-10-06', subscriberId: sentToday.id, eventIds: [other], variantKey: `en:${other}`, claimedAt: new Date('2026-10-06T16:30:00Z'), resendId: 're_t', sentAt: new Date('2026-10-07T07:00:00Z') },
      { alertDay: '2026-10-06', subscriberId: sentYesterday.id, eventIds: [other], variantKey: `en:${other}`, claimedAt: new Date('2026-10-06T16:30:00Z'), resendId: 're_y', sentAt: new Date('2026-10-07T06:59:59Z') },
    ]);
    const pool = await alertPool({ db, now: RUN });
    expect((await claim.claimAlerts(TODAY, pool, 100, 'abk_t', RUN, db)).map((r) => r.id).sort()).toEqual(sorted(sentYesterday.id, free.id));
    expect(await claim.anyAlertClaimable(TODAY, pool, RUN, db)).toBe(false);
    expect(pending).toBeTruthy();
    expect(sentToday).toBeTruthy();
  });

  it('at most 20 events in one alert, the soonest; the rest go the next day', async () => {
    const ids = [];
    for (let i = 0; i < 25; i++) ids.push(await marked({ startAt: new Date(FRI.getTime() + i * HOUR) }));
    const s = await seedSub();
    const { run, clock } = setup();
    await run();
    expect((await rowOf(s))?.eventIds).toEqual(sorted(...ids.slice(0, 20)));
    clock.set(new Date(RUN.getTime() + DAY));
    await run();
    expect((await rowOf(s, '2026-10-08'))?.eventIds).toEqual(sorted(...ids.slice(20)));
  });
});

describe('runAlerts: never twice (A6, G3)', () => {
  it('an alerted event is not sent again on later days, nor after an unmark and re-mark', async () => {
    const a = await addEvent({ startAt: new Date(FRI.getTime() + 3 * DAY) });
    await setGoing(a, 'interested', 'public', db, { now: new Date(MARKED.getTime() - HOUR) });
    expect((await setGoing(a, 'going', 'public', db, { now: MARKED })).alert).toBe('queued');
    await seedSub();
    const { run, tr, clock } = setup();
    expect(await run()).toMatchObject({ sent: 1 });
    // Victor unmarks and marks again the same day; the next morning's pool has it again.
    await setGoing(a, 'interested', 'public', db, { now: new Date(RUN.getTime() + HOUR) });
    expect((await setGoing(a, 'going', 'public', db, { now: new Date(RUN.getTime() + 2 * HOUR) })).alert).toBe('queued');
    for (const days of [1, 2]) {
      clock.set(new Date(RUN.getTime() + days * DAY));
      expect((await alertPool({ db, now: clock.now() })).events.map((e) => e.id)).toEqual([a]);
      expect(await run()).toMatchObject({ ok: true, pool: 1, claimed: 0, sent: 0 });
    }
    expect(tr.calls).toHaveLength(1);
  });

  it('a newly marked event still reaches a reader who already had others', async () => {
    const a = await marked();
    const s = await seedSub();
    const { run, clock } = setup();
    await run();
    const b = await marked({}, new Date(RUN.getTime() + 3 * HOUR));
    clock.set(new Date(RUN.getTime() + DAY));
    await run();
    expect((await rowOf(s))?.eventIds).toEqual([a]);
    expect((await rowOf(s, '2026-10-08'))?.eventIds).toEqual([b]);
  });

  it('an alert that provably never went out frees its events; one that may have does not', async () => {
    const a = await marked();
    const failedSub = await seedSub();
    const invalidSub = await seedSub();
    const conflictSub = await seedSub();
    const expiredSub = await seedSub();
    const { run, clock } = setup();
    await run();
    expect(await claim.markAlertFailed(TODAY, failedSub.id, 'reached_daily_quota', db)).toBe(1);
    expect(await claim.markAlertFailed(TODAY, failedSub.id, 'reached_daily_quota', db)).toBe(0);
    await db.update(alertSends).set({ error: 'invalid', resendId: null }).where(eq(alertSends.subscriberId, invalidSub.id));
    await db.update(alertSends).set({ error: 'idem_conflict', resendId: null }).where(eq(alertSends.subscriberId, conflictSub.id));
    await db.update(alertSends).set({ error: 'expired', resendId: null }).where(eq(alertSends.subscriberId, expiredSub.id));
    clock.set(new Date(RUN.getTime() + DAY));
    expect(await run()).toMatchObject({ claimed: 2, sent: 2 });
    expect((await rowOf(failedSub, '2026-10-08'))?.eventIds).toEqual([a]);
    expect((await rowOf(invalidSub, '2026-10-08'))?.eventIds).toEqual([a]);
    expect(await rowOf(conflictSub, '2026-10-08')).toBeUndefined();
    expect(await rowOf(expiredSub, '2026-10-08')).toBeUndefined();
  });

  it("a late (16:xx) group replayed the next morning is that reader's only alert that PT day; new events wait a day", async () => {
    const a = await marked();
    const s = await seedSub();
    let down = true;
    const { run, tr, clock } = setup(new Date('2026-10-07T16:30:00Z'), () => (down ? err('internal_server_error', 500) : undefined));
    expect(await run({ budgetMs: 1 })).toMatchObject({ ok: false, claimed: 1, sent: 0, reason: 'retry:internal_server_error' });
    const b = await marked({ startAt: new Date(FRI.getTime() + DAY) }, new Date('2026-10-07T20:00:00Z'));
    down = false;
    clock.set(new Date('2026-10-08T15:10:00Z'));
    expect(await run()).toMatchObject({ ok: true, replayed: 1, claimed: 0, sent: 0 });
    const thursday = tr.calls.slice(1);
    expect(thursday.flatMap((c) => c.emails.map((e) => e.subject))).toEqual([`en · ${a}`]);
    // A later run that morning adds nothing; Friday's alert carries `b`.
    clock.set(new Date('2026-10-08T16:10:00Z'));
    expect(await run()).toMatchObject({ claimed: 0, replayed: 0, batches: 0 });
    clock.set(new Date('2026-10-09T15:00:00Z'));
    expect(await run()).toMatchObject({ claimed: 1, sent: 1 });
    expect((await rowOf(s, '2026-10-09'))?.eventIds).toEqual([b]);
  });

  it("G3: events a reader's digest may already have shown with a seal are skipped", async () => {
    const a = await marked();
    const b = await marked();
    const shown = await seedSub();
    const notInDigest = await seedSub();
    const bounced = await seedSub();
    const inFlight = await seedSub();
    const issue = newId('dig');
    await db.insert(digestIssues).values({
      id: issue, isoWeek: '2026-W41', status: 'sent', sendAfter: new Date('2026-10-05T00:00:00Z'),
      snapshot: { version: 1, showAttendance: true, events: [{ id: a, seal: 'going' }, { id: b, seal: null }], preview: [] },
    });
    const narrowed = newId('dig');
    await db.insert(digestIssues).values({
      id: narrowed, isoWeek: '2026-W40', status: 'sent', sendAfter: new Date('2026-09-28T00:00:00Z'),
      snapshot: { version: 1, showAttendance: false, events: [{ id: b, seal: 'going' }], preview: [] },
    });
    await db.insert(digestSends).values([
      { issueId: issue, subscriberId: shown.id, variantKey: 'en:ai', resendId: 're_d1', sentAt: MARKED },
      { issueId: narrowed, subscriberId: shown.id, variantKey: 'en:ai', resendId: 're_d0', sentAt: MARKED },
      { issueId: issue, subscriberId: bounced.id, variantKey: 'en:ai', resendId: 're_d2', sentAt: MARKED, error: 'failed:bounce' },
      { issueId: issue, subscriberId: inFlight.id, variantKey: 'en:ai', claimedAt: RUN, batchKey: 'dbk_1' },
      { issueId: issue, subscriberId: notInDigest.id, variantKey: 'en:ai', kind: 'empty', resendId: 're_d3', sentAt: MARKED },
    ]);
    const { run } = setup();
    await run();
    expect((await rowOf(shown))?.eventIds).toEqual([b]);
    expect((await rowOf(inFlight))?.eventIds).toEqual([b]);
    expect((await rowOf(notInDigest))?.eventIds).toEqual(sorted(a, b));
    expect((await rowOf(bounced))?.eventIds).toEqual(sorted(a, b));
  });
});

describe('runAlerts: the live re-check before every send (A3)', () => {
  it('an event unmarked between the claim and the send holds the row back (unmarked); its other events go tomorrow', async () => {
    const a = await marked();
    const b = await marked({ startAt: new Date(FRI.getTime() + DAY) });
    const s = await seedSub();
    const { tr, clock } = setup();
    const unmark = () => db.update(events).set({ going: 'interested' }).where(eq(events.id, a));
    const deps = { now: clock.now, sleep: clock.sleep, transport: tr.t, mode: 'live' as const, dailyCap: 1000, alertCap: 1000 };
    expect(await runAlerts({ ...deps, db: hook(db, 'insert into alert_sends', { after: unmark }) })).toMatchObject({
      ok: true, claimed: 1, sent: 0, failed: 1, batches: 0,
    });
    expect(tr.calls).toHaveLength(0);
    expect(await rowOf(s)).toMatchObject({ eventIds: sorted(a, b), error: 'unmarked', resendId: null });
    clock.set(new Date(RUN.getTime() + DAY));
    expect(await runAlerts({ ...deps, db })).toMatchObject({ claimed: 1, sent: 1 });
    expect((await rowOf(s, '2026-10-08'))?.eventIds).toEqual([b]);
  });

  it("a replay re-checks too: replay_unmarked, never sent (the first attempt may have gone out)", async () => {
    const a = await marked();
    const b = await marked();
    const s = await seedSub();
    const { run, tr, clock } = setup(RUN, (_c, i) => (i === 0 ? err('internal_server_error', 500) : undefined));
    expect(await run({ budgetMs: 1 })).toMatchObject({ ok: false, partial: true, reason: 'retry:internal_server_error', claimed: 1, sent: 0 });
    expect(await rowOf(s)).toMatchObject({ resendId: null, error: null });
    await db.update(events).set({ goingVisibility: 'hidden' }).where(eq(events.id, a));
    clock.advance(HOUR);
    expect(await run()).toMatchObject({ ok: true, replayed: 0, failed: 1 });
    expect(tr.calls).toHaveLength(1);
    expect((await rowOf(s))?.error).toBe('replay_unmarked');
    clock.set(new Date(RUN.getTime() + DAY));
    expect((await alertPool({ db, now: clock.now() })).events.map((e) => e.id)).toEqual([b]);
    expect(await run()).toMatchObject({ claimed: 0 });
  });

  it('the kill switch turned on between runs: nothing new is claimed and a waiting group is held back', async () => {
    await marked();
    const s = await seedSub();
    await seedSub();
    const { run, clock } = setup(RUN, (_c, i) => (i === 0 ? err('internal_server_error', 500) : undefined));
    await run({ budgetMs: 1 });
    expect((await rows()).filter((r) => r.resendId === null && r.error === null)).toHaveLength(2);
    await db.insert(settings).values({ key: 'show_attendance', value: { on: false } });
    clock.advance(HOUR);
    expect(await run()).toMatchObject({ pool: 0, claimed: 0, sent: 0, replayed: 0, failed: 2 });
    expect((await rowOf(s))?.error).toBe('replay_unmarked');
  });
});

// ---- caps, digest day ----------------------------------------------------------------------------

describe('runAlerts: caps and the digest day (G3, G7)', () => {
  it('ALERT_DAILY_CAP holds back the newest readers; their events merge into the next alert', async () => {
    const later = { startAt: new Date(FRI.getTime() + 3 * DAY) };
    const a = await marked(later);
    const old = await seedSub();
    const mid = await seedSub();
    const newest = await seedSub();
    const { run, clock } = setup();
    expect(await run({ alertCap: 2 })).toMatchObject({ ok: true, claimed: 2, sent: 2, partial: true, reason: 'daily_cap' });
    expect(await rowOf(newest)).toBeUndefined();
    const b = await marked(later, new Date(RUN.getTime() + 3 * HOUR));
    clock.set(new Date(RUN.getTime() + DAY));
    expect(await run({ alertCap: 2 })).toMatchObject({ claimed: 2, partial: true });
    // Oldest first again: the two who already had `a` get just `b`... until the cap; the newest waits once more.
    expect((await rowOf(old, '2026-10-08'))?.eventIds).toEqual([b]);
    expect((await rowOf(mid, '2026-10-08'))?.eventIds).toEqual([b]);
    clock.set(new Date(RUN.getTime() + 2 * DAY));
    await run({ alertCap: 2 });
    expect((await rowOf(newest, '2026-10-09'))?.eventIds).toEqual(sorted(a, b));
  });

  it('the shared newsletter cap counts digest emails sent today too, and the digest counts alerts', async () => {
    await marked();
    const subs = await Promise.all(Array.from({ length: 4 }, () => seedSub()));
    const issue = newId('dig');
    await db.insert(digestIssues).values({ id: issue, isoWeek: '2026-W41', status: 'sent', sendAfter: new Date('2026-10-05T00:00:00Z') });
    // Three digest emails earlier this UTC day (one still waiting to be replayed counts too).
    await db.insert(digestSends).values([
      { issueId: issue, subscriberId: subs[0].id, variantKey: 'en:ai', resendId: 're_1', sentAt: new Date('2026-10-07T01:00:00Z') },
      { issueId: issue, subscriberId: subs[1].id, variantKey: 'en:ai', resendId: 're_2', sentAt: new Date('2026-10-07T01:00:00Z') },
      { issueId: issue, subscriberId: subs[2].id, variantKey: 'en:ai', claimedAt: new Date('2026-10-07T01:30:00Z') },
      { issueId: issue, subscriberId: subs[3].id, variantKey: 'en:ai', resendId: 're_4', sentAt: new Date('2026-10-06T23:59:00Z') }, // yesterday UTC
    ]);
    expect(await sentTodayCount(RUN, db)).toBe(3);
    const { run } = setup();
    expect(await run({ dailyCap: 4, alertCap: 30 })).toMatchObject({ claimed: 1, sent: 1, partial: true, reason: 'daily_cap' });
    expect(await sentTodayCount(RUN, db)).toBe(4);
    expect(await claim.alertsTodayCount(RUN, db)).toBe(1);
    expect(await sentTodayCount(new Date(RUN.getTime() + DAY), db)).toBe(0);
  });

  it('a full cap with nobody left to alert is not an overflow', async () => {
    await marked();
    await seedSub();
    const { run, clock } = setup();
    await run({ alertCap: 1 });
    clock.advance(HOUR);
    const r = await run({ alertCap: 1 });
    expect(r).toMatchObject({ ok: true, claimed: 0 });
    expect(r.partial).toBeUndefined();
  });

  it('a cap of 0 sends nothing', async () => {
    await marked();
    await seedSub();
    const { run, tr } = setup();
    expect(await run({ alertCap: 0 })).toMatchObject({ ok: true, claimed: 0, partial: true, reason: 'daily_cap' });
    expect(tr.calls).toHaveLength(0);
  });

  it('G3: on the day a digest goes out nobody gets an alert; the next day skips what the digest showed', async () => {
    const sun = new Date('2026-10-11T15:00:00Z'); // Sunday 08:00 PDT; the W42 issue goes at 17:00 PDT
    const a = await marked({ startAt: new Date('2026-10-14T01:30:00Z') }, new Date('2026-10-10T18:00:00Z'));
    const b = await marked({ startAt: new Date('2026-10-15T01:30:00Z') }, new Date('2026-10-10T19:00:00Z'));
    const s = await seedSub();
    const issue = newId('dig');
    await db.insert(digestIssues).values({ id: issue, isoWeek: '2026-W42', status: 'scheduled', sendAfter: new Date('2026-10-12T00:00:00Z') });
    const { run, tr, clock } = setup(sun);
    expect(await run()).toMatchObject({ ok: true, skipped: 'digest_day', day: '2026-10-11', claimed: 0 });
    await db.update(digestIssues).set({ status: 'sending' }).where(eq(digestIssues.id, issue));
    clock.advance(HOUR);
    expect(await run()).toMatchObject({ skipped: 'digest_day' });
    expect(await rows()).toEqual([]);
    // The digest went out Sunday evening with `a` sealed in its going list.
    await db.update(digestIssues).set({
      status: 'sent', snapshot: { version: 1, showAttendance: true, events: [{ id: a, seal: 'going' }, { id: b, seal: null }], preview: [] },
    }).where(eq(digestIssues.id, issue));
    await db.insert(digestSends).values({ issueId: issue, subscriberId: s.id, variantKey: 'en:ai', resendId: 're_d', sentAt: new Date('2026-10-12T01:00:00Z') });
    clock.set(new Date('2026-10-12T15:00:00Z'));
    expect(await run()).toMatchObject({ ok: true, claimed: 1, sent: 1 });
    expect((await rowOf(s, '2026-10-12'))?.eventIds).toEqual([b]);
    expect(tr.calls).toHaveLength(1);
  });

  it("G3: on a digest day an earlier day's leftover group is not replayed (it expires; the digest carries it); today's is", async () => {
    const a = await marked({ startAt: new Date('2026-10-14T01:30:00Z') }, new Date('2026-10-09T18:00:00Z'));
    const sat = await seedSub();
    const sun = await seedSub();
    await db.insert(digestIssues).values({ id: newId('dig'), isoWeek: '2026-W42', status: 'scheduled', sendAfter: new Date('2026-10-12T00:00:00Z') });
    // Saturday's late group and a Sunday group claimed before the digest was scheduled, both left by a failed send.
    await db.insert(alertSends).values([
      { alertDay: '2026-10-10', subscriberId: sat.id, eventIds: [a], variantKey: `en:${a}`, claimedAt: new Date('2026-10-10T16:30:00Z'), batchKey: 'abk_sat' },
      { alertDay: '2026-10-11', subscriberId: sun.id, eventIds: [a], variantKey: `en:${a}`, claimedAt: new Date('2026-10-11T15:00:00Z'), batchKey: 'abk_sun' },
    ]);
    // Sunday 08:10 PDT, 22 h 40 min after Saturday's claim: still replayable on any other day.
    const { run, tr, clock } = setup(new Date('2026-10-11T15:10:00Z'));
    expect(await run()).toMatchObject({ ok: true, skipped: 'digest_day', replayed: 1, claimed: 0 });
    expect(tr.sent().map((e) => e.to)).toEqual([sun.email]);
    expect(await rowOf(sat, '2026-10-10')).toMatchObject({ resendId: null, error: null });
    // Monday: Saturday's group is past 23 h and expires, never sent.
    clock.set(new Date('2026-10-12T15:00:00Z'));
    await run();
    expect(await rowOf(sat, '2026-10-10')).toMatchObject({ resendId: null, error: 'expired' });
    expect(tr.calls).toHaveLength(1);
  });

  it('a digest issue on another day, or a draft or sent one today, does not skip', async () => {
    await marked();
    await seedSub();
    await db.insert(digestIssues).values([
      { id: newId('dig'), isoWeek: '2026-W42', status: 'scheduled', sendAfter: new Date('2026-10-12T00:00:00Z') },
      { id: newId('dig'), isoWeek: '2026-W43', status: 'draft', sendAfter: new Date('2026-10-07T20:00:00Z') },
      { id: newId('dig'), isoWeek: '2026-W44', status: 'sent', sendAfter: new Date('2026-10-07T20:00:00Z') },
    ]);
    const { run } = setup();
    expect(await run()).toMatchObject({ ok: true, sent: 1 });
  });
});

// ---- sending -------------------------------------------------------------------------------------

describe('runAlerts: gates and the lease (G8, G9)', () => {
  it("alertsMode 'off' (Vercel without a verified sender, or ALERTS_SENDING=0) claims and sends nothing, and takes no lease", async () => {
    await marked();
    await seedSub();
    const tr = fakeTransport();
    const clock = fakeClock(RUN);
    vi.stubEnv('VERCEL', '1');
    vi.stubEnv('RESEND_API_KEY', '');
    expect(await runAlerts({ db, now: clock.now, transport: tr.t })).toMatchObject({ ok: true, skipped: 'off', claimed: 0, sent: 0, failed: 0 });
    vi.stubEnv('RESEND_API_KEY', 're_test');
    vi.stubEnv('RESEND_FROM', "Victor's Picks <hi@mail.example.org>");
    vi.stubEnv('ALERTS_SENDING', '0');
    expect(await runAlerts({ db, now: clock.now, transport: tr.t })).toMatchObject({ ok: true, skipped: 'off' });
    expect(await runAlerts({ db, now: clock.now, transport: tr.t, mode: 'off' })).toMatchObject({ skipped: 'off' });
    expect(tr.calls).toHaveLength(0);
    expect(await rows()).toEqual([]);
    expect(await db.select().from(syncState)).toEqual([]);
  });

  it('sending off or no link secret still expires claims past 23 h, so they block neither deletion nor retention', async () => {
    await marked();
    const s = await seedSub();
    const { run, clock } = setup(RUN, () => err('internal_server_error', 500));
    await run({ budgetMs: 1 });
    expect(await rowOf(s)).toMatchObject({ resendId: null, error: null });
    vi.stubEnv('ALERTS_SENDING', '0');
    clock.advance(23 * HOUR - MIN);
    expect(await runAlerts({ db, now: clock.now, mode: 'off' })).toMatchObject({ skipped: 'off', failed: 0 });
    expect(await rowOf(s)).toMatchObject({ error: null });
    clock.advance(2 * MIN);
    expect(await runAlerts({ db, now: clock.now })).toMatchObject({ ok: true, skipped: 'off', failed: 1 });
    expect(await rowOf(s)).toMatchObject({ resendId: null, error: 'expired' });
    // The same without the secret (the expiry needs neither).
    const t = await seedSub();
    await db.insert(alertSends).values({ alertDay: TODAY, subscriberId: t.id, eventIds: ['evt_x'], variantKey: 'en:evt_x', claimedAt: RUN, batchKey: 'abk_x' });
    vi.stubEnv('ALERTS_SENDING', '');
    vi.stubEnv('SUBSCRIBER_LINK_SECRET', '');
    expect(await runAlerts({ db, now: clock.now, mode: 'live' })).toMatchObject({ ok: false, reason: 'no_link_secret', failed: 1 });
    expect(await rowOf(t)).toMatchObject({ error: 'expired' });
  });

  it('without the link secret nothing is claimed', async () => {
    await marked();
    await seedSub();
    vi.stubEnv('SUBSCRIBER_LINK_SECRET', '');
    expect(await runAlerts({ db, mode: 'live' })).toMatchObject({ ok: false, reason: 'no_link_secret', claimed: 0 });
    expect(await rows()).toEqual([]);
  });

  it("the digest's lease: a live one makes the alert run back off, an expired one is taken over, and it is released", async () => {
    await marked();
    await seedSub();
    const { run, clock } = setup();
    await db.insert(syncState).values({ source: LEASE, lastRunAt: new Date(clock.now().getTime() - MIN) });
    expect(await run()).toMatchObject({ ok: true, skipped: 'locked', claimed: 0 });
    await db.update(syncState).set({ lastRunAt: new Date(clock.now().getTime() - 6 * MIN) }).where(eq(syncState.source, LEASE));
    expect(await run()).toMatchObject({ ok: true, sent: 1 });
    expect((await db.select().from(syncState).where(eq(syncState.source, LEASE)))[0].lastRunAt).toBeNull();
  });

  it('while alerts are sending, the digest run is locked out (and the other way round)', async () => {
    await marked();
    await seedSub();
    const clock = fakeClock(RUN);
    const seen: string[] = [];
    const transport: BatchTransport = async (emails) => {
      const d = await runDigest({ db, now: clock.now, mode: 'live', transport: async () => err('x', 500) });
      seen.push(d.skipped ?? 'ran');
      return { ok: true, ids: emails.map(() => 're_x'), invalid: [], dailyUsed: null };
    };
    expect(await runAlerts({ db, now: clock.now, sleep: clock.sleep, transport, mode: 'live' })).toMatchObject({ sent: 1 });
    expect(seen).toEqual(['locked']);
    await db.update(syncState).set({ lastRunAt: clock.now() }).where(eq(syncState.source, LEASE));
    clock.advance(MIN);
    expect(await runAlerts({ db, now: clock.now, mode: 'live', transport })).toMatchObject({ skipped: 'locked' });
  });

  it("dev mode without an injected transport logs one masked line per batch and marks rows 'dev'", async () => {
    await marked();
    const s = await seedSub({ email: 'private.person@example.org' });
    const lines: string[] = [];
    vi.spyOn(console, 'info').mockImplementation((...a: unknown[]) => void lines.push(a.map(String).join(' ')));
    const clock = fakeClock(RUN);
    expect(await runAlerts({ db, now: clock.now, sleep: clock.sleep, mode: 'dev' })).toMatchObject({ ok: true, sent: 1 });
    expect((await rowOf(s))?.resendId).toBe('dev');
    expect(lines.join('\n')).toMatch(/^\[alert:dev\] batch n=1 mode=strict key=alert\/2026-10-07\/\S+ first=p\*\*\*@example\.org/m);
    expect(lines.join('\n')).not.toContain('private.person');
  });

  it('ALERT_DAILY_CAP defaults to 30', () => {
    expect(alertCapFromEnv(undefined)).toBe(30);
    expect(alertCapFromEnv('')).toBe(30);
    expect(alertCapFromEnv('abc')).toBe(30);
    expect(alertCapFromEnv('-1')).toBe(30);
    expect(alertCapFromEnv('12.7')).toBe(12);
    expect(alertCapFromEnv('0')).toBe(0);
  });
});

describe('runAlerts: the emails (A5, G10, G11, G14)', () => {
  it('own token, one-click scoped to going alerts, alert tags, X-Entity-Ref-ID per day; no placeholder survives', async () => {
    const a = await marked();
    const en = await seedSub();
    const zh = await seedSub({ locale: 'zh' });
    const { run, tr } = setup();
    await run();
    const byTo = Object.fromEntries(tr.sent().map((e) => [e.to, e]));
    for (const s of [en, zh]) {
      const e = byTo[s.email];
      const token = linkToken(s);
      expect(e.from).toBe("Victor's Picks <picks@mail.picks.test>");
      expect(e.headers).toEqual({
        'List-Unsubscribe': `<https://picks.test/api/unsubscribe?t=${token}&list=going>`,
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
        'X-Entity-Ref-ID': `alert/${TODAY}`,
      });
      expect(e.tags).toEqual([
        { name: 'kind', value: 'alert' },
        { name: 'day', value: TODAY },
        { name: 'sub', value: s.id },
      ]);
      // Resend tag values: ASCII letters, digits, _ and -.
      for (const t of e.tags) expect(t.value).toMatch(/^[A-Za-z0-9_-]+$/);
      const pre = s.locale === 'zh' ? 'https://picks.test/zh' : 'https://picks.test';
      expect(e.html.replaceAll('&amp;', '&')).toContain(`${pre}/unsubscribe?t=${token}&list=going`);
      expect(e.text).toContain(`${pre}/unsubscribe?t=${token}&list=going`);
      expect(e.text).toContain(`${pre}/prefs/${token}`);
      expect(e.html + e.text).not.toContain('__VP_TOKEN__');
      expect(e.subject).toBe(`${s.locale} · ${a}`);
    }
    expect(byTo[en.email].html).not.toContain(linkToken(zh));
  });

  it('packs up to 100 per call, renders each variant once, paces calls 1 s apart, payload sorted by subscriber', async () => {
    const a = await marked();
    const b = await marked({ category: 'vc' });
    await Promise.all(Array.from({ length: 150 }, (_, i) => seedSub({ locale: i % 2 ? 'zh' : 'en', categories: i % 3 ? ['ai'] : ['ai', 'vc'] })));
    const { run, tr, clock } = setup();
    expect(await run()).toMatchObject({ ok: true, claimed: 150, sent: 150, batches: 2 });
    expect(tr.calls.map((c) => c.emails.length)).toEqual([100, 50]);
    expect(new Set(tr.calls.map((c) => c.key)).size).toBe(2);
    expect(h.renders.sort()).toEqual([`en:${a}`, `en:${a},${b}`, `zh:${a}`, `zh:${a},${b}`].sort());
    expect(clock.sleep.mock.calls.map(([ms]) => ms)).toEqual([PACE_MS]);
    for (const c of tr.calls) {
      const ids = c.emails.map(subTag);
      expect(ids).toEqual([...ids].sort());
      const keys = new Set(await Promise.all(ids.map((id) => batchKeyOf(id))));
      expect(keys.size).toBe(1);
      expect(c.key).toBe(alertIdempotencyKey(TODAY, [...keys][0]));
    }
  });

  it('the idempotency key: the day and the batch key fixed at claim time, within Resend limits', () => {
    const k = alertIdempotencyKey(TODAY, 'abk_0123456789abcdef');
    expect(k).toBe('alert/2026-10-07/abk_0123456789abcdef');
    expect(k).not.toBe(alertIdempotencyKey('2026-10-08', 'abk_0123456789abcdef'));
    expect(k.length).toBeLessThanOrEqual(256);
  });

  it('A5 end to end with the real email: the day only (no clock time), never "invited", under 90 KB, three per-reader links', async () => {
    h.real = true;
    const one = await marked({ titleEn: 'Agent Builders Night', titleZh: 'Agent 开发者之夜', noteEn: 'Demos first.', noteZh: '先看演示。' });
    const two = await marked({ startAt: new Date(FRI.getTime() + DAY), going: 'hosting', titleEn: 'Hack Saturday', titleZh: '周六黑客松' });
    const en = await seedSub();
    const zh = await seedSub({ locale: 'zh' });
    const solo = await seedSub({ goingAlertsSince: new Date(MARKED.getTime() + MIN) });
    await db.update(goingMarks).set({ markedAt: new Date(MARKED.getTime() + HOUR) }).where(eq(goingMarks.eventId, two));
    const { run, tr } = setup();
    const r = await run();
    expect(r).toMatchObject({ ok: true, sent: 3, failed: 0 });
    expect(r.htmlMaxBytes).toBeGreaterThan(0);
    expect(r.htmlMaxBytes).toBeLessThanOrEqual(90_000);
    const byTo = Object.fromEntries(tr.sent().map((e) => [e.to, e]));
    expect(byTo[en.email].subject).toBe('Victor plans to go to 2 events');
    expect(byTo[zh.email].subject).toBe('Victor 打算去 2 场活动');
    expect(byTo[solo.email].subject).toBe('Victor plans to go: Hack Saturday');
    for (const s of [en, zh, solo]) {
      const e = byTo[s.email];
      const token = linkToken(s);
      for (const part of [e.subject, e.text]) {
        expect(part).not.toMatch(/\b\d{1,2}:\d{2}\b|\b[AP]M\b|上午|下午|晚上/);
        expect(part).not.toMatch(/invite|邀请/i);
      }
      expect(e.html).not.toMatch(/\b(6|18):30\b/);
      expect(e.html).not.toMatch(/invite/i);
      expect(e.html.split(token).length - 1).toBe(3);
      expect(e.text.split(token).length - 1).toBe(3);
      expect(Buffer.byteLength(e.html)).toBeLessThanOrEqual(90_000);
      expect(e.html).toContain(`https://picks.test${s.locale === 'zh' ? '/zh' : ''}/privacy`);
    }
    expect(byTo[en.email].text).toContain('Agent Builders Night');
    expect(byTo[zh.email].text).toContain('Agent 开发者之夜');
    expect(byTo[en.email].html).toContain(`https://picks.test/events/event-${one}`);
  });
});

describe('runAlerts: failures, replays, expiry', () => {
  it('a crash between send and mark: the next run replays the same key and the same bytes', async () => {
    await marked();
    await marked({ startAt: new Date(FRI.getTime() + DAY) });
    await Promise.all([seedSub(), seedSub({ locale: 'zh' }), seedSub({ categories: ['vc'] })]);
    const clock = fakeClock(RUN);
    const tr = fakeTransport(resendLike());
    const deps = { now: clock.now, sleep: clock.sleep, transport: tr.t, mode: 'live' as const, dailyCap: 1000, alertCap: 1000 };
    await expect(runAlerts({ ...deps, db: crashOnce(db, 'update alert_sends a set resend_id') })).rejects.toThrow('connection lost');
    expect(tr.calls).toHaveLength(1);
    expect((await rows()).every((r) => r.resendId === null && r.error === null)).toBe(true);
    // The crashed run released its lease on the way out; the next cron (an hour later) replays.
    clock.advance(HOUR);
    expect(await runAlerts({ ...deps, db })).toMatchObject({ ok: true, claimed: 0, sent: 0, replayed: 2 });
    expect(tr.calls).toHaveLength(2);
    expect(tr.calls[1].key).toBe(tr.calls[0].key);
    expect(tr.calls[1].json).toBe(tr.calls[0].json);
    expect((await rows()).every((r) => r.resendId?.startsWith('re_') && r.error === null)).toBe(true);
  });

  it('a replay drops members who turned going alerts off meanwhile (one-click): ineligible, never mailed', async () => {
    await marked();
    const stays = await seedSub();
    const leaves = await seedSub();
    const { run, tr, clock } = setup(RUN, (_c, i) => (i === 0 ? err('internal_server_error', 500) : undefined));
    expect(await run({ budgetMs: 1 })).toMatchObject({ ok: false, partial: true, claimed: 2, sent: 0 });
    await db.update(subscribers).set({ goingAlerts: false }).where(eq(subscribers.id, leaves.id));
    clock.advance(HOUR);
    expect(await run()).toMatchObject({ ok: true, replayed: 1, ineligible: 1 });
    expect(tr.calls[1].emails.map((e) => e.to)).toEqual([stays.email]);
    // The key fixed at claim time, whoever is still in the group.
    expect(tr.calls[1].key).toBe(tr.calls[0].key);
    expect(tr.calls[1].key).toBe(alertIdempotencyKey(TODAY, await batchKeyOf(stays.id)));
    expect((await rowOf(leaves))?.error).toBe('ineligible');
  });

  it('a group Resend already took, replayed after a member dropped out: same key, a 409, nobody gets a second copy', async () => {
    await marked();
    const [a, b, c] = [await seedSub(), await seedSub(), await seedSub()];
    const clock = fakeClock(RUN);
    const tr = fakeTransport(resendLike());
    const deps = { now: clock.now, sleep: clock.sleep, transport: tr.t, mode: 'live' as const, dailyCap: 1000, alertCap: 1000 };
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    // Accepted (all three delivered), then the mark fails; C turns alerts off from that very email.
    await expect(runAlerts({ ...deps, db: crashOnce(db, 'update alert_sends a set resend_id') })).rejects.toThrow('connection lost');
    await db.update(subscribers).set({ goingAlerts: false }).where(eq(subscribers.id, c.id));
    clock.advance(HOUR);
    expect(await runAlerts({ ...deps, db })).toMatchObject({ ok: true, replayed: 0, ineligible: 1, failed: 2 });
    expect(tr.calls).toHaveLength(2);
    expect(tr.calls[1].key).toBe(tr.calls[0].key);
    // Only the first call was accepted: one copy each.
    const accepted = tr.calls.slice(0, 1).flatMap((call) => call.emails.map((e) => e.to));
    expect(accepted.sort()).toEqual([a.email, b.email, c.email].sort());
    expect(Object.fromEntries((await rows()).map((r) => [r.subscriberId, r.error]))).toEqual({
      [a.id]: 'idem_conflict', [b.id]: 'idem_conflict', [c.id]: 'ineligible',
    });
  });

  it("a run retries what the run before it left, however soon it fires (stale = claimed before this run's start)", async () => {
    await marked();
    const s = await seedSub();
    let down = true;
    const { run, clock } = setup(new Date('2026-10-07T15:55:00Z'), () => (down ? err('internal_server_error', 500) : undefined));
    expect(await run({ budgetMs: 1 })).toMatchObject({ ok: false, claimed: 1, sent: 0 });
    down = false;
    clock.set(new Date('2026-10-07T16:03:00Z'));
    expect(await run()).toMatchObject({ ok: true, replayed: 1, claimed: 0 });
    expect((await rowOf(s))?.resendId).toMatch(/^re_/);
  });

  it("a definitive refusal on a group's first attempt frees its rows (refused:<name>): the events go in the next day's alert", async () => {
    const a = await marked();
    const s = await seedSub();
    let quota = true;
    const { run, tr, clock } = setup(RUN, () => (quota ? err('daily_quota_exceeded', 429) : undefined));
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await run()).toMatchObject({ ok: false, partial: true, reason: 'daily_quota_exceeded', claimed: 1, sent: 0, failed: 1 });
    expect(await rowOf(s)).toMatchObject({ resendId: null, error: 'refused:daily_quota_exceeded' });
    // The 16:00 run neither replays it nor claims the reader again today.
    quota = false;
    clock.advance(HOUR);
    expect(await run()).toMatchObject({ ok: true, claimed: 0, replayed: 0, batches: 0 });
    const b = await marked({ startAt: new Date(FRI.getTime() + DAY) }, new Date(RUN.getTime() + 3 * HOUR));
    clock.set(new Date(RUN.getTime() + DAY));
    expect(await run()).toMatchObject({ ok: true, claimed: 1, sent: 1 });
    expect((await rowOf(s, '2026-10-08'))?.eventIds).toEqual(sorted(a, b));
    expect(tr.calls).toHaveLength(2);
  });

  it('a refusal after an attempt that may have gone out (5xx first, or a replay) keeps the claim instead', async () => {
    await marked();
    const s = await seedSub();
    let i = 0;
    const { run, tr, clock } = setup(RUN, () => (i++ === 0 ? err('internal_server_error', 500) : err('daily_quota_exceeded', 429)));
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await run()).toMatchObject({ ok: false, reason: 'daily_quota_exceeded', claimed: 1, failed: 0 });
    expect(tr.calls).toHaveLength(2);
    expect(await rowOf(s)).toMatchObject({ resendId: null, error: null });
    clock.advance(HOUR);
    expect(await run()).toMatchObject({ ok: false, reason: 'daily_quota_exceeded', replayed: 0, failed: 0 });
    expect(tr.calls).toHaveLength(3);
    expect(await rowOf(s)).toMatchObject({ resendId: null, error: null });
  });

  it('claims older than 23 h expire instead of being replayed', async () => {
    await marked();
    const s = await seedSub();
    const { run, tr, clock } = setup(RUN, () => err('internal_server_error', 500));
    await run({ budgetMs: 1 });
    clock.advance(23 * HOUR + MIN);
    const r = await run();
    expect(r).toMatchObject({ failed: 1, replayed: 0 });
    expect(await rowOf(s)).toMatchObject({ error: 'expired', resendId: null });
    // The new day's pool still has the event, but a row that may have reached the reader holds it.
    expect(tr.calls).toHaveLength(1);
  });

  it('an idempotency conflict marks the group idem_conflict; the run goes on', async () => {
    await marked();
    await seedSub();
    const { run } = setup(RUN, () => err('invalid_idempotent_request', 409));
    expect(await run()).toMatchObject({ ok: true, sent: 0, failed: 1 });
    expect((await rows())[0].error).toBe('idem_conflict');
  });

  it('a payload error: strict, then permissive under a derived key; rejected rows become invalid', async () => {
    await marked();
    const subs = await Promise.all([seedSub(), seedSub(), seedSub()]);
    const { run, tr } = setup(RUN, (c) =>
      c.mode === 'strict' ? err('validation_error', 422) : { ok: true, ids: ['re_a', null, 're_c'], invalid: [1], dailyUsed: null },
    );
    expect(await run()).toMatchObject({ ok: true, sent: 2, failed: 1 });
    expect(tr.calls.map((c) => [c.mode, c.key.endsWith(':p')])).toEqual([['strict', false], ['permissive', true]]);
    const bad = tr.calls[1].emails[1];
    expect((await rowOf(subs.find((s) => s.email === bad.to)!))?.error).toBe('invalid');
  });

  it('a variant that cannot be built loses only its own rows, and fails the run (counts per variant)', async () => {
    const a = await marked();
    const b = await marked({ category: 'vc' });
    const c = await marked({ category: 'campus' });
    const fine = await seedSub();
    const broken = await seedSub({ categories: ['vc'] });
    const brokenToo = await seedSub({ categories: ['vc'] });
    const big = await seedSub({ categories: ['campus'] });
    h.failOn = b;
    h.hugeOn = c;
    const { run, tr } = setup();
    const r = await run();
    expect(r).toMatchObject({ ok: false, reason: 'render_failed', claimed: 4, sent: 1, failed: 3 });
    expect(tr.sent().map((e) => e.to)).toEqual([fine.email]);
    expect(r.buildFailures).toEqual({ [`en:${b}`]: { error: 'render_failed', rows: 2 }, [`en:${c}`]: { error: 'too_large', rows: 1 } });
    expect(h.renders.filter((v) => v === `en:${b}`)).toHaveLength(1); // rendered once per variant, failure included
    expect((await rowOf(broken))?.error).toBe('render_failed');
    expect((await rowOf(brokenToo))?.error).toBe('render_failed');
    expect((await rowOf(big))?.error).toBe('too_large');
    // Never built, so never delivered: those events are free again tomorrow; `a` is not resent.
    h.failOn = null;
    h.hugeOn = null;
    const { run: next, tr: nextTr } = setup(new Date(RUN.getTime() + DAY));
    expect(await next()).toMatchObject({ ok: true, sent: 3 });
    expect(nextTr.sent().map((e) => e.to).sort()).toEqual([broken.email, brokenToo.email, big.email].sort());
    expect(a).toBeTruthy();
  });

  it('results and logs never carry an address or a token', async () => {
    await marked();
    const s = await seedSub({ email: 'private.person@example.org' });
    const logs: string[] = [];
    for (const level of ['log', 'info', 'warn', 'error'] as const) {
      vi.spyOn(console, level).mockImplementation((...a: unknown[]) => void logs.push(a.map(String).join(' ')));
    }
    const { run } = setup(RUN, (_c, i) => (i === 0 ? err('rate_limit_exceeded', 429, 10) : undefined));
    const r = await run();
    expect(r).toMatchObject({ ok: true, sent: 1 });
    const all = JSON.stringify(r) + logs.join('\n');
    expect(all).not.toContain('private.person');
    expect(all).not.toContain(linkToken(s).split('.')[1]);
  });
});

// ---- the cron route ---------------------------------------------------------------------------------

describe('GET /api/cron/alerts', () => {
  const get = (auth?: string) => cronRoute.GET(new Request('http://localhost/api/cron/alerts', { headers: auth ? { authorization: auth } : {} }));
  const jobs = async () => (await db.select().from(jobsLog)).filter((j) => j.job === 'alerts');

  beforeEach(() => {
    vi.stubEnv('CRON_SECRET', 'cron-secret-for-tests');
    vi.stubEnv('VERCEL', '');
    vi.stubEnv('RESEND_API_KEY', '');
    vi.stubEnv('RESEND_FROM', '');
    vi.useFakeTimers({ now: RUN, toFake: ['Date'] });
  });

  it('allows the full 300 s and is scheduled at 15:00 and 16:00 UTC', () => {
    expect(cronRoute.maxDuration).toBe(300);
    const crons = (JSON.parse(readFileSync('vercel.json', 'utf8')) as { crons: { path: string; schedule: string }[] }).crons;
    expect(crons.filter((c) => c.path === '/api/cron/alerts').map((c) => c.schedule)).toEqual(['0 15 * * *', '0 16 * * *']);
  });

  it('401 without the cron secret; nothing is touched', async () => {
    h.db = noDb;
    expect((await get()).status).toBe(401);
    expect((await get('Bearer nope')).status).toBe(401);
  });

  it('production without a verified sender: skipped, no jobs_log row', async () => {
    vi.stubEnv('VERCEL', '1');
    await marked();
    await seedSub();
    const res = await get('Bearer cron-secret-for-tests');
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, job: 'alerts', skipped: 'off' });
    expect(await rows()).toEqual([]);
    expect(await jobs()).toEqual([]);
  });

  it('an idle run (nothing marked) writes no jobs_log row', async () => {
    await seedSub();
    const res = await get('Bearer cron-secret-for-tests');
    expect(await res.json()).toMatchObject({ ok: true, job: 'alerts', pool: 0, claimed: 0 });
    expect(await jobs()).toEqual([]);
  });

  it('a run (dev transport) is logged once, with counts and codes and no addresses', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => {});
    await marked();
    const s = await seedSub({ email: 'private.person@example.org' });
    const res = await get('Bearer cron-secret-for-tests');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, job: 'alerts', day: TODAY, pool: 1, claimed: 1, sent: 1 });
    const [job] = await jobs();
    expect(job).toMatchObject({ ok: true, detail: { day: TODAY, claimed: 1, sent: 1 } });
    const stored = JSON.stringify([body, job]);
    expect(stored).not.toContain('private.person');
    expect(stored).not.toContain(s.id);
  });

  it('a digest-day skip is logged (the admin card shows why no alert went out)', async () => {
    vi.useFakeTimers({ now: new Date('2026-10-11T15:00:00Z'), toFake: ['Date'] });
    await db.insert(digestIssues).values({ id: newId('dig'), isoWeek: '2026-W42', status: 'scheduled', sendAfter: new Date('2026-10-12T00:00:00Z') });
    expect(await (await get('Bearer cron-secret-for-tests')).json()).toMatchObject({ skipped: 'digest_day' });
    expect((await jobs()).map((j) => (j.detail as { skipped: string }).skipped)).toEqual(['digest_day']);
  });

  it('a failure is a 500 with a failed jobs_log row carrying only an error code', async () => {
    const errors: string[] = [];
    vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => void errors.push(a.map(String).join(' ')));
    await marked();
    await db.execute(sql`drop table alert_sends`);
    const res = await get('Bearer cron-secret-for-tests');
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ ok: false, job: 'alerts', reason: '42P01' });
    expect(await jobs()).toMatchObject([{ ok: false, detail: { ok: false, reason: '42P01', claimed: 0 } }]);
    expect(errors.join('\n')).toContain('[cron] alerts failed');
  });
});
