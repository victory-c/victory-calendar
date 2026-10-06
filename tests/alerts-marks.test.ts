import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { testDb } from './helpers/pglite';

// F20 going marks (design G1, G5): setGoing() and publish() record when an event becomes publicly
// going, on PGlite. The settings reads (attendance kill switch) go through the default db handle,
// so it points at the test's database.

const h = vi.hoisted(() => ({ db: null as unknown }));
vi.mock('@/lib/db', async (orig) => ({
  ...(await orig()),
  db: new Proxy({}, { get: (_t, p) => Reflect.get(h.db as object, p) }),
  hasDatabase: () => true,
}));

const { cancelEvent, getGoingMark, publish, setGoing, unpublish } = await import('@/lib/admin/events');
const { alertSeal, recordGoingMark } = await import('@/lib/alerts/marks');
const { alertSends, covers, digestIssues, events, goingMarks, settings, subscribers } = await import('@/lib/db/schema');
const { templateCoverRow } = await import('@/lib/covers/template');
type DB = import('@/lib/db').DB;
type NewEvent = import('@/lib/db/schema').NewEvent;

const HOUR = 3600_000;
const DAY = 864e5;
/** Tuesday 2026-10-06, 12:00 PDT. */
const NOW = new Date('2026-10-06T19:00:00Z');
/** Tuesday 2026-10-13, 18:30 PDT: a week out, well past the first day an alert can cover. */
const LATER = new Date('2026-10-14T01:30:00Z');

// Each test starts a fresh PGlite with every migration: slow on a busy machine.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

let db: DB;
let seq = 0;

beforeEach(async () => {
  db = (await testDb()).db as unknown as DB;
  h.db = db;
  vi.stubEnv('VERCEL', '');
  vi.stubEnv('RESEND_API_KEY', '');
  vi.stubEnv('ALERTS_SENDING', '');
  vi.stubEnv('DIGEST_SENDING', '');
  vi.stubEnv('SHOW_ATTENDANCE', '');
});
afterEach(() => vi.unstubAllEnvs());

/** A published, listed-platform, public-venue AI event a week out; Victor "interested" unless told otherwise. */
async function addEvent(over: Partial<NewEvent> = {}): Promise<string> {
  const id = over.id ?? `evt_${String(++seq).padStart(4, '0')}`;
  const coverId = `cov_${id.slice(4)}`;
  await db.insert(covers).values({ id: coverId, ...templateCoverRow('ai', null) });
  await db.insert(events).values({
    slug: `event-${id}`, status: 'published', sourceUrl: `https://luma.com/${id}`, titleEn: `Event ${id}`, noteEn: 'Worth it.',
    category: 'ai', startAt: LATER, tz: 'America/Los_Angeles', city: 'San Francisco', format: 'in_person', going: 'interested',
    goingVisibility: 'public', coverId, ...over, id,
  });
  return id;
}

const markOf = async (id: string) => (await db.select().from(goingMarks).where(eq(goingMarks.eventId, id)))[0];
const marks = () => db.select().from(goingMarks);

describe('setGoing records a mark when an event becomes publicly going', () => {
  it.each(['going', 'hosting', 'speaking'] as const)('%s, public, published: marked now with the alert on, queued', async (going) => {
    const id = await addEvent();
    const r = await setGoing(id, going, 'public', db, { now: NOW });
    expect(r).toEqual({ going, visibility: 'public', reason: null, alert: 'queued', startAt: expect.any(Date) });
    expect(await markOf(id)).toEqual({ eventId: id, markedAt: NOW, alert: true });
  });

  it('interested, none, after_event and hidden are not publicly going: no mark', async () => {
    const id = await addEvent();
    for (const [going, vis] of [['interested', 'public'], ['none', 'public'], ['going', 'after_event'], ['going', 'hidden'], ['hosting', 'hidden']] as const) {
      expect((await setGoing(id, going, vis, db, { now: NOW })).alert).toBe('none');
    }
    expect(await marks()).toEqual([]);
  });

  it('a going auto-downgraded to after_event (private venue, unlisted platform, recurring) is not marked', async () => {
    const venue = await addEvent({ privateVenue: true });
    const party = await addEvent({ sourceUrl: 'https://example.org/party' });
    const weekly = await addEvent({ hostName: 'Example Labs', venueName: 'Example Labs' });
    await addEvent({ hostName: 'Example Labs', venueName: 'Example Labs', startAt: new Date(LATER.getTime() + 7 * DAY) });
    expect(await setGoing(venue, 'going', 'public', db, { now: NOW })).toEqual({ going: 'going', visibility: 'after_event', reason: 'private_venue', alert: 'none', startAt: expect.any(Date) });
    expect(await setGoing(party, 'going', 'public', db, { now: NOW })).toMatchObject({ reason: 'not_on_listed_platform', alert: 'none' });
    expect(await setGoing(weekly, 'going', 'public', db, { now: NOW })).toMatchObject({ reason: 'recurring', alert: 'none' });
    expect(await marks()).toEqual([]);
  });

  it('never for cycling, even hosting (attendance is never shown for cycling)', async () => {
    const id = await addEvent({ category: 'cycling' });
    expect((await setGoing(id, 'hosting', 'public', db, { now: NOW })).alert).toBe('none');
    expect((await setGoing(id, 'going', 'public', db, { now: NOW })).reason).toBe('cycling');
    expect(await marks()).toEqual([]);
  });

  it('drafts, cancelled and archived events are not public: no mark', async () => {
    const draft = await addEvent({ status: 'draft' });
    const cancelled = await addEvent({ status: 'cancelled' });
    const archived = await addEvent({ status: 'archived' });
    for (const id of [draft, cancelled, archived]) expect((await setGoing(id, 'going', 'public', db, { now: NOW })).alert).toBe('none');
    expect(await marks()).toEqual([]);
  });

  it('an event that already ended shows "went", never an alert', async () => {
    const id = await addEvent({ startAt: new Date(NOW.getTime() - 5 * HOUR), endAt: new Date(NOW.getTime() - 2 * HOUR) });
    expect((await setGoing(id, 'going', 'public', db, { now: NOW })).alert).toBe('none');
    expect(await marks()).toEqual([]);
  });

  it('saving it again, or going → hosting, adds nothing: the first mark stays', async () => {
    const id = await addEvent();
    await setGoing(id, 'going', 'public', db, { now: NOW });
    expect((await setGoing(id, 'going', 'public', db, { now: new Date(NOW.getTime() + HOUR) })).alert).toBe('none');
    expect((await setGoing(id, 'hosting', 'public', db, { now: new Date(NOW.getTime() + 2 * HOUR) })).alert).toBe('none');
    expect(await markOf(id)).toEqual({ eventId: id, markedAt: NOW, alert: true });
  });

  it('unmarking writes nothing (the cron re-checks live); marking again starts a new mark', async () => {
    const id = await addEvent();
    await setGoing(id, 'going', 'public', db, { now: NOW });
    await setGoing(id, 'interested', 'public', db, { now: new Date(NOW.getTime() + HOUR) });
    expect(await markOf(id)).toEqual({ eventId: id, markedAt: NOW, alert: true });
    const again = new Date(NOW.getTime() + 2 * HOUR);
    expect((await setGoing(id, 'going', 'public', db, { now: again })).alert).toBe('queued');
    expect(await markOf(id)).toEqual({ eventId: id, markedAt: again, alert: true });
  });
});

describe("Victor's per-mark switch (G5)", () => {
  it('off: the mark is stored with alert = false and nothing is queued', async () => {
    const id = await addEvent();
    expect(await setGoing(id, 'going', 'public', db, { now: NOW, alert: false })).toMatchObject({ visibility: 'public', alert: 'none' });
    expect(await markOf(id)).toEqual({ eventId: id, markedAt: NOW, alert: false });
  });

  it('a later save with the switch off cancels a pending alert; a save without the switch never turns a declined one back on', async () => {
    const id = await addEvent();
    await setGoing(id, 'going', 'public', db, { now: NOW });
    await setGoing(id, 'hosting', 'public', db, { now: new Date(NOW.getTime() + HOUR), alert: false });
    expect(await markOf(id)).toEqual({ eventId: id, markedAt: NOW, alert: false });
    expect((await setGoing(id, 'hosting', 'public', db, { now: new Date(NOW.getTime() + 2 * HOUR) })).alert).toBe('none');
    expect(await markOf(id)).toEqual({ eventId: id, markedAt: NOW, alert: false });
  });

  it('re-ticking the switch on an event that is still publicly going turns a declined alert back on (same mark time)', async () => {
    const id = await addEvent();
    await setGoing(id, 'going', 'public', db, { now: NOW, alert: false });
    expect(await getGoingMark(id, db)).toEqual({ alert: false });
    const r = await setGoing(id, 'going', 'public', db, { now: new Date(NOW.getTime() + HOUR), alert: true });
    expect(r).toEqual({ going: 'going', visibility: 'public', reason: null, alert: 'queued', startAt: expect.any(Date) });
    expect(await markOf(id)).toEqual({ eventId: id, markedAt: NOW, alert: true });
    expect(await getGoingMark(id, db)).toEqual({ alert: true });
    // Saving it on again is no new alert.
    expect((await setGoing(id, 'going', 'public', db, { now: new Date(NOW.getTime() + 2 * HOUR), alert: true })).alert).toBe('none');
  });

  it('a decline is not turned back on once the next run would no longer pick the mark up (7-day lookback)', async () => {
    const old = await addEvent();
    const recent = await addEvent();
    // The next run (Wed Oct 7, before 10:00 PT) looks back to Sep 30 ~17:00 UTC at the latest.
    await setGoing(old, 'going', 'public', db, { now: new Date('2026-09-30T16:00:00Z'), alert: false });
    await setGoing(recent, 'going', 'public', db, { now: new Date('2026-09-30T18:00:00Z'), alert: false });
    expect((await setGoing(old, 'going', 'public', db, { now: NOW, alert: true })).alert).toBe('none');
    expect((await markOf(old)).alert).toBe(false);
    expect((await setGoing(recent, 'going', 'public', db, { now: NOW, alert: true })).alert).toBe('queued');
    expect((await markOf(recent)).alert).toBe(true);
  });

  it('a decline is not turned back on once an alert row holds the event (a reader may have it)', async () => {
    const id = await addEvent();
    await setGoing(id, 'going', 'public', db, { now: NOW, alert: false });
    await db.insert(subscribers).values({ id: 'sub_r', email: 'r@example.org', status: 'active', categories: ['ai'], goingAlerts: true });
    await db.insert(alertSends).values({ alertDay: '2026-10-06', subscriberId: 'sub_r', eventIds: [id], variantKey: `en:${id}`, error: 'failed:bounce' });
    expect((await setGoing(id, 'going', 'public', db, { now: new Date(NOW.getTime() + HOUR), alert: true })).alert).toBe('none');
    expect(await markOf(id)).toEqual({ eventId: id, markedAt: NOW, alert: false });
  });

  it('getGoingMark: null until the event is marked publicly going', async () => {
    const id = await addEvent();
    expect(await getGoingMark(id, db)).toBeNull();
    await setGoing(id, 'going', 'public', db, { now: NOW });
    expect(await getGoingMark(id, db)).toEqual({ alert: true });
  });

  it('defaults to on (the Live and Drafts quick actions pass no switch)', async () => {
    const id = await addEvent();
    vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
    try {
      expect((await setGoing(id, 'going', 'public', db)).alert).toBe('queued');
    } finally {
      vi.useRealTimers();
    }
    expect(await markOf(id)).toEqual({ eventId: id, markedAt: NOW, alert: true });
  });
});

describe('publish makes an already-marked event publicly going', () => {
  it('a draft marked going: no mark until publish, then one with the alert on', async () => {
    const id = await addEvent({ status: 'draft' });
    await setGoing(id, 'going', 'public', db, { now: NOW });
    expect(await marks()).toEqual([]);
    const at = new Date(NOW.getTime() + HOUR);
    expect(await publish(id, at, db)).toEqual({ ok: true, blockers: [], alert: 'queued' });
    expect(await markOf(id)).toEqual({ eventId: id, markedAt: at, alert: true });
    // Publishing again is not a transition.
    expect((await publish(id, new Date(at.getTime() + HOUR), db)).alert).toBe('none');
    expect((await markOf(id)).markedAt).toEqual(at);
  });

  it('a draft that is only interested, or downgraded, publishes without a mark', async () => {
    const plain = await addEvent({ status: 'draft' });
    const venue = await addEvent({ status: 'draft', privateVenue: true });
    await setGoing(venue, 'going', 'public', db, { now: NOW });
    expect((await publish(plain, NOW, db)).alert).toBe('none');
    expect((await publish(venue, NOW, db)).alert).toBe('none');
    expect(await marks()).toEqual([]);
  });

  it('restoring a cancelled going event, or republishing an archived one, marks it again', async () => {
    const id = await addEvent({ going: 'going' });
    await cancelEvent(id, db);
    expect((await publish(id, NOW, db)).alert).toBe('queued');
    await unpublish(id, db);
    const at = new Date(NOW.getTime() + DAY);
    expect((await publish(id, at, db)).alert).toBe('queued');
    expect(await markOf(id)).toEqual({ eventId: id, markedAt: at, alert: true });
  });

  it('restoring keeps an alert Victor declined off (cancel → publish, take down → republish)', async () => {
    const id = await addEvent();
    await setGoing(id, 'going', 'public', db, { now: NOW, alert: false });
    await cancelEvent(id, db);
    const restored = new Date(NOW.getTime() + HOUR);
    expect(await publish(id, restored, db)).toEqual({ ok: true, blockers: [], alert: 'none' });
    expect(await markOf(id)).toEqual({ eventId: id, markedAt: restored, alert: false });
    await unpublish(id, db);
    const republished = new Date(NOW.getTime() + 2 * HOUR);
    expect((await publish(id, republished, db)).alert).toBe('none');
    expect(await markOf(id)).toEqual({ eventId: id, markedAt: republished, alert: false });
  });
});

describe("'queued' only when tomorrow's run will send it", () => {
  it('an event too soon for the next run (tomorrow PT, or today) is marked but not queued', async () => {
    const tomorrow = await addEvent({ startAt: new Date('2026-10-08T01:30:00Z') }); // Wed Oct 7 18:30 PDT
    const twoDays = await addEvent({ startAt: new Date('2026-10-08T07:00:00Z') }); // Thu Oct 8 00:00 PDT
    expect((await setGoing(tomorrow, 'going', 'public', db, { now: NOW })).alert).toBe('none');
    expect((await setGoing(twoDays, 'going', 'public', db, { now: NOW })).alert).toBe('queued');
    expect((await marks()).map((m) => m.eventId).sort()).toEqual([tomorrow, twoDays].sort());
  });

  it('the boundary is a Pacific midnight across the fall-back DST change', async () => {
    // Saturday 2026-10-31 12:00 PDT; the first alertable day is Monday Nov 2, which starts at 08:00Z (PST).
    const sat = new Date('2026-10-31T19:00:00Z');
    const sunNight = await addEvent({ startAt: new Date('2026-11-02T07:59:00Z') }); // Sun Nov 1 23:59 PST
    const monday = await addEvent({ startAt: new Date('2026-11-02T08:00:00Z') }); // Mon Nov 2 00:00 PST
    expect((await setGoing(sunNight, 'going', 'public', db, { now: sat })).alert).toBe('none');
    expect((await setGoing(monday, 'going', 'public', db, { now: sat })).alert).toBe('queued');
  });

  it("'digest' when tomorrow is a digest day and the event starts the day after (Sunday's digest carries it)", async () => {
    // Saturday 2026-10-10 11:00 PDT; the W42 issue goes out Sunday 17:00 PDT (00:00Z Monday).
    const sat = new Date('2026-10-10T18:00:00Z');
    const issue = 'dig_w42';
    await db.insert(digestIssues).values({ id: issue, isoWeek: '2026-W42', status: 'scheduled', sendAfter: new Date('2026-10-12T00:00:00Z') });
    const sunday = await addEvent({ startAt: new Date('2026-10-12T03:00:00Z') }); // Sun 20:00 PDT: too soon either way
    const monday = await addEvent({ startAt: new Date('2026-10-13T01:00:00Z') }); // Mon 18:00 PDT
    const tuesday = await addEvent({ startAt: new Date('2026-10-13T07:00:00Z') }); // Tue 00:00 PDT: still the digest's week
    const nextWeek = await addEvent({ startAt: new Date('2026-10-20T01:00:00Z') }); // Mon 10-19: after W42, Monday's run alerts it
    expect((await setGoing(sunday, 'going', 'public', db, { now: sat })).alert).toBe('none');
    expect((await setGoing(monday, 'going', 'public', db, { now: sat })).alert).toBe('digest');
    // The whole covered week rides in Sunday's digest (the next alert run then skips it for its readers).
    expect((await setGoing(tuesday, 'going', 'public', db, { now: sat })).alert).toBe('digest');
    expect((await setGoing(nextWeek, 'going', 'public', db, { now: sat })).alert).toBe('queued');
    // An issue already sending is frozen and won't carry a new seal: no 'digest' promise (and Monday's
    // run only reaches Tuesday on), so 'none'. A draft or an already sent one doesn't hold alerts back.
    const mondayToo = await addEvent({ startAt: new Date('2026-10-13T01:00:00Z') });
    await db.update(digestIssues).set({ status: 'sending' });
    expect((await setGoing(mondayToo, 'going', 'public', db, { now: sat })).alert).toBe('none');
    for (const status of ['draft', 'sent'] as const) {
      const again = await addEvent({ startAt: new Date('2026-10-13T01:00:00Z') });
      await db.update(digestIssues).set({ status });
      expect((await setGoing(again, 'going', 'public', db, { now: sat })).alert).toBe('queued');
    }
    // Publishing reports it the same way.
    await db.update(digestIssues).set({ status: 'scheduled' });
    const draft = await addEvent({ status: 'draft', going: 'going', startAt: new Date('2026-10-13T01:00:00Z') });
    expect((await publish(draft, sat, db)).alert).toBe('digest');
    // Sunday morning, before the digest freezes at 17:00 PDT: it still carries a mark made now.
    const sunMorning = new Date('2026-10-11T17:00:00Z'); // Sun 10:00 PDT
    const wed = await addEvent({ startAt: new Date('2026-10-15T01:00:00Z') }); // Wed 10-14 18:00 PDT
    expect((await setGoing(wed, 'going', 'public', db, { now: sunMorning })).alert).toBe('digest');
  });

  it('with attendance hidden (kill switch) or alert sending off, the mark is kept but nothing is queued', async () => {
    const a = await addEvent();
    const b = await addEvent();
    const c = await addEvent();
    await db.insert(settings).values({ key: 'show_attendance', value: { on: false } });
    expect((await setGoing(a, 'going', 'public', db, { now: NOW })).alert).toBe('none');
    await db.delete(settings);
    vi.stubEnv('SHOW_ATTENDANCE', 'false');
    expect((await setGoing(b, 'going', 'public', db, { now: NOW })).alert).toBe('none');
    vi.stubEnv('SHOW_ATTENDANCE', '');
    vi.stubEnv('VERCEL', '1'); // production without a verified sender: alertsMode() is off
    expect((await setGoing(c, 'going', 'public', db, { now: NOW })).alert).toBe('none');
    expect((await marks()).filter((m) => m.alert).map((m) => m.eventId).sort()).toEqual([a, b, c].sort());
  });
});

describe('alertSeal / recordGoingMark directly', () => {
  const base = {
    id: 'evt_x', status: 'published' as const, going: 'going' as const, goingVisibility: 'public' as const, category: 'ai' as const,
    format: 'in_person' as const, privateVenue: false, sourceUrl: 'https://lu.ma/x', startAt: LATER, endAt: null,
  };

  it('is the public seal, never went or interested', () => {
    expect(alertSeal(base, NOW)).toBe('going');
    expect(alertSeal({ ...base, going: 'speaking' }, NOW)).toBe('speaking');
    expect(alertSeal({ ...base, going: 'interested' }, NOW)).toBeNull();
    expect(alertSeal({ ...base, startAt: new Date(NOW.getTime() - DAY) }, NOW)).toBeNull();
    expect(alertSeal({ ...base, startAt: null }, NOW)).toBeNull();
    expect(alertSeal({ ...base, category: null }, NOW)).toBeNull();
    expect(alertSeal({ ...base, format: 'online', privateVenue: true }, NOW)).toBe('going');
  });

  it('a failed write surfaces (the admin action shows an error; no alert is assumed)', async () => {
    const broken = new Proxy(db, { get: (t, p) => (p === 'insert' ? () => { throw new Error('write failed'); } : Reflect.get(t, p)) });
    await expect(recordGoingMark(broken, { ...base, going: 'interested' }, base, NOW, { alert: true })).rejects.toThrow('write failed');
  });
});
