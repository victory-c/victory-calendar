import { eq } from 'drizzle-orm';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { testDb } from './helpers/pglite';

// /admin/subscribers (M3 week 15): the read queries in lib/subscribers/admin.ts, the lookup /
// suppress / delete action, the CSV export route (DESIGN D12, D14) and the retention step of
// /api/cron/sync (D3).
const h = vi.hoisted(() => ({ db: null as unknown, session: false, admin: true, refreshed: 0 }));
vi.mock('@/lib/db', async (orig) => ({ ...(await orig()), db: new Proxy({}, { get: (_t, p) => Reflect.get(h.db as object, p) }), hasDatabase: () => true }));
vi.mock('@/lib/admin-session', () => ({
  requireAdmin: async () => {
    if (!h.admin) throw new Error('NEXT_REDIRECT /admin/sign-in');
    return { user: { email: 'v@example.org' } };
  },
  adminSessionFrom: async (req: Request) => {
    if (req.headers.get('cookie') === 'broken') throw new Error('bad cookie');
    return h.session ? { user: { email: 'v@example.org' } } : null;
  },
}));
vi.mock('next/cache', () => ({ refresh: () => void h.refreshed++, revalidateTag: () => {}, updateTag: () => {} }));

const admin = await import('@/lib/subscribers/admin');
const { subscriberAction } = await import('@/app/admin/subscriber-actions');
const { SubscriberLookup } = await import('@/components/admin/SubscriberLookup');
const exportRoute = await import('@/app/admin/(app)/subscribers/export/route');
const cronRoute = await import('@/app/api/cron/sync/route');
const { audience } = await import('@/lib/digest/issues');
const { createToken } = await import('@/lib/api/tokens');
const { digestIssues, digestSends, jobsLog, subscribers } = await import('@/lib/db/schema');
const { newId } = await import('@/lib/ids');
const { linkToken } = await import('@/lib/subscribers/token');
const { subscriberLinks } = await import('@/lib/subscribers/links');
const { UNSUBSCRIBED_TTL_MS } = await import('@/lib/subscribers/service');
type DB = import('@/lib/db').DB;
type Subscriber = import('@/lib/subscribers/service').Subscriber;

const NOW = new Date('2026-10-05T12:00:00Z');
const DAY = 864e5;
const HOUR = 3600_000;
const ago = (ms: number) => new Date(NOW.getTime() - ms);
const db = () => h.db as DB;
const IP = '203.0.113.77';
const UA = 'Mozilla/5.0 (consent-ua-marker)';

let n = 0;
beforeEach(async () => {
  h.db = (await testDb()).db;
  h.session = false;
  h.admin = true;
  h.refreshed = 0;
  vi.stubEnv('SUBSCRIBER_LINK_SECRET', 'test-secret-subscribers-admin-0123');
  vi.stubEnv('PUBLIC_HOST', 'localhost:3100');
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

async function seed(over: Partial<typeof subscribers.$inferInsert> = {}): Promise<Subscriber> {
  const [row] = await db()
    .insert(subscribers)
    .values({
      id: newId('sub'), email: `reader${++n}@example.org`, status: 'active', locale: 'en', categories: ['ai', 'vc'],
      consentAt: ago(10 * DAY), consentIp: IP, consentUa: UA, consentSource: 'subscribe', confirmedAt: ago(9 * DAY), createdAt: ago(10 * DAY),
      ...over,
    })
    .returning();
  return row;
}
/** `count` confirmed, active subscribers in one insert (G3 needs 50 per issue). */
async function crowd(count: number): Promise<Subscriber[]> {
  return db()
    .insert(subscribers)
    .values(
      Array.from({ length: count }, () => ({
        id: newId('sub'), email: `reader${++n}@example.org`, status: 'active' as const, locale: 'en' as const, categories: ['ai'],
        consentAt: ago(10 * DAY), confirmedAt: ago(9 * DAY), createdAt: ago(10 * DAY),
      })),
    )
    .returning();
}
const reload = async (id: string) => (await db().select().from(subscribers).where(eq(subscribers.id, id)))[0];
const jobs = async (job: string) => db().select().from(jobsLog).where(eq(jobsLog.job, job));

let week = 0;
async function issue(over: Partial<typeof digestIssues.$inferInsert> = {}) {
  const [row] = await db()
    .insert(digestIssues)
    .values({ id: newId('dig'), isoWeek: `2026-W${String(10 + ++week).padStart(2, '0')}`, status: 'sent', ...over })
    .returning();
  return row;
}
type SendState = 'sent' | 'failed' | 'inFlight';
async function send(issueId: string, sub: Subscriber, state: SendState = 'sent', over: Partial<typeof digestSends.$inferInsert> = {}) {
  await db().insert(digestSends).values({
    issueId, subscriberId: sub.id, variantKey: 'en:ai', claimedAt: ago(2 * DAY),
    resendId: state === 'sent' ? 're_x' : null, sentAt: state === 'sent' ? ago(2 * DAY) : null, error: state === 'failed' ? 'failed:bounced' : null,
    ...over,
  });
}
/** One accepted digest per subscriber, in one insert. */
async function sendAll(issueId: string, subs: Subscriber[]) {
  await db()
    .insert(digestSends)
    .values(subs.map((s) => ({ issueId, subscriberId: s.id, variantKey: 'en:ai', claimedAt: ago(2 * DAY), resendId: 're_x', sentAt: ago(2 * DAY) })));
}
let svix = 0;
/** A DESIGN D11 webhook row. */
async function emailEvent(detail: { type: string; kind: string | null; issue: string | null; bounce?: string | null; svix?: string }) {
  await db().insert(jobsLog).values({
    job: 'email_event', ok: false,
    detail: { bounce: null, domain: 'example.org', svix: `msg_${++svix}`, ...detail },
  });
}

describe('statusCounts', () => {
  it('every status × language, zeros included, with totals', async () => {
    await seed();
    await seed({ locale: 'zh' });
    await seed({ locale: 'zh', status: 'paused' });
    await seed({ status: 'pending', confirmedAt: null });
    await seed({ locale: 'zh', status: 'suppressed' });
    const c = await admin.statusCounts({ db: db() });
    expect(c.rows).toEqual({
      pending: { en: 1, zh: 0, total: 1 },
      active: { en: 1, zh: 1, total: 2 },
      paused: { en: 0, zh: 1, total: 1 },
      unsubscribed: { en: 0, zh: 0, total: 0 },
      suppressed: { en: 0, zh: 1, total: 1 },
    });
    expect(c.total).toEqual({ en: 2, zh: 3, total: 5 });
  });
});

describe('categoryMatrix', () => {
  it('counts eligible subscribers per category and language, matching /admin/digest', async () => {
    await seed({ categories: ['ai', 'vc'] });
    await seed({ categories: ['ai'], locale: 'zh' });
    await seed({ categories: ['vc', 'ai', 'ai', 'bogus'], locale: 'zh' }); // repeats and unknown slugs count once / not at all
    await seed({ categories: ['cycling'], status: 'paused', pausedUntil: ago(DAY) }); // pause over: eligible
    await seed({ categories: ['social'], status: 'paused', pausedUntil: new Date(NOW.getTime() + DAY) }); // still paused
    await seed({ categories: ['bogus'] }); // no known category: never mailed
    await seed({ categories: ['campus'], status: 'pending', confirmedAt: null });
    await seed({ categories: ['campus'], status: 'unsubscribed' });
    await seed({ categories: ['campus'], status: 'suppressed' });
    const m = await admin.categoryMatrix({ db: db(), now: NOW });
    expect(m.rows.ai).toEqual({ en: 1, zh: 2, total: 3 });
    expect(m.rows.vc).toEqual({ en: 1, zh: 1, total: 2 });
    expect(m.rows.cycling).toEqual({ en: 1, zh: 0, total: 1 });
    for (const c of ['social', 'campus', 'hackathon', 'conference'] as const) expect(m.rows[c]).toEqual({ en: 0, zh: 0, total: 0 });
    expect(m.people).toEqual({ en: 2, zh: 2, total: 4 });
    // Same rule, same instant: People is /admin/digest's eligible count.
    const groups = await audience({ db: db(), now: NOW });
    expect(groups.reduce((s, g) => s + g.count, 0)).toBe(m.people.total);
  });
});

describe('facetMatrix (F19)', () => {
  it('event-language and online-only counts per language among the same readers as categoryMatrix', async () => {
    await seed({ categories: ['ai'] });
    await seed({ categories: ['ai'], evLangPref: ['zh'], locale: 'zh' });
    await seed({ categories: ['vc'], evLangPref: ['zh'], onlineOnly: true });
    await seed({ categories: ['ai'], evLangPref: ['en'], onlineOnly: true, locale: 'zh' });
    await seed({ categories: ['ai'], evLangPref: ['bilingual'] });
    await seed({ categories: ['ai'], evLangPref: ['en', 'zh'], onlineOnly: false }); // malformed: any
    await seed({ categories: ['ai'], evLangPref: ['zh'], status: 'unsubscribed' }); // not a reader
    await seed({ categories: ['bogus'], onlineOnly: true }); // never mailed
    const f = await admin.facetMatrix({ db: db(), now: NOW });
    expect(f.evLang).toEqual({
      any: { en: 2, zh: 0, total: 2 }, zh: { en: 1, zh: 1, total: 2 }, en: { en: 0, zh: 1, total: 1 }, bilingual: { en: 1, zh: 0, total: 1 },
    });
    expect(f.onlineOnly).toEqual({ en: 1, zh: 1, total: 2 });
    expect(f.people).toEqual({ en: 4, zh: 2, total: 6 });
    expect(f.people).toEqual((await admin.categoryMatrix({ db: db(), now: NOW })).people);
  });
});

describe('gateStatus (G3)', () => {
  it('confirmed now = active + paused; suppressed and unsubscribed rows that once confirmed do not count', async () => {
    await seed();
    await seed({ status: 'paused', pausedUntil: new Date(NOW.getTime() + DAY) });
    await seed({ status: 'suppressed' });
    await seed({ status: 'unsubscribed' });
    await seed({ status: 'pending', confirmedAt: null });
    const g = await admin.gateStatus({ db: db(), now: NOW });
    expect(g.confirmed).toBe(2);
    expect(g.issues).toEqual([]);
    expect(g).toMatchObject({ consecutive: false, twoInARow: false });
  });

  it('the last two issues that went out: digest sends only, on time within 3 h; rates count every delivered email', async () => {
    const subs = await Promise.all(Array.from({ length: 5 }, () => seed()));
    const older = await issue({ isoWeek: '2026-W38', sendAfter: ago(14 * DAY), sentAt: new Date(ago(14 * DAY).getTime() + 3 * HOUR) });
    const newer = await issue({ isoWeek: '2026-W39', sendAfter: ago(7 * DAY), sentAt: new Date(ago(7 * DAY).getTime() + 3 * HOUR + 1) });
    await issue({ isoWeek: '2026-W37', sendAfter: ago(21 * DAY), sentAt: ago(21 * DAY) }); // third: not shown
    await issue({ isoWeek: '2026-W41', status: 'scheduled', sendAfter: new Date(NOW.getTime() + DAY) }); // not out yet
    await issue({ isoWeek: '2026-W42', status: 'draft' });
    await send(older.id, subs[0]);
    await send(older.id, subs[1]);
    await send(older.id, subs[2], 'sent', { kind: 'empty' }); // the monthly notice is not a digest, but it was delivered
    await send(older.id, subs[3], 'failed');
    await send(older.id, subs[4], 'inFlight');
    await send(newer.id, subs[0]);
    await send(newer.id, subs[1], 'failed', { kind: 'empty' });
    const g = await admin.gateStatus({ db: db(), now: NOW });
    // sent (digests only) is G3's ≥ 50; delivered (empty notices too) divides the bounce and
    // complaint counts, whose webhook rows carry kind=digest for both kinds.
    expect(g.issues.map((i) => [i.isoWeek, i.sent, i.delivered, i.onTime])).toEqual([
      ['2026-W39', 1, 1, false],
      ['2026-W38', 2, 3, true],
    ]);
    expect(g).toMatchObject({ consecutive: true, twoInARow: false });
  });

  it('two in a row means back-to-back weeks: a missed week between the two newest fails G3', async () => {
    const subs = await crowd(admin.G3_CONFIRMED);
    const onTime = (days: number) => ({ sendAfter: ago(days * DAY), sentAt: new Date(ago(days * DAY).getTime() + HOUR) });
    const w38 = await issue({ isoWeek: '2026-W38', ...onTime(21) });
    // Missed: left 'scheduled' past the late limit, so it never shows among the issues that went out.
    const w39 = await issue({ isoWeek: '2026-W39', status: 'scheduled', sendAfter: ago(14 * DAY) });
    const w40 = await issue({ isoWeek: '2026-W40', ...onTime(7) });
    await sendAll(w38.id, subs);
    await sendAll(w40.id, subs);
    const gate = () => admin.gateStatus({ db: db(), now: NOW });

    let g = await gate();
    expect(g.issues.map((i) => [i.isoWeek, i.sent, i.onTime])).toEqual([
      ['2026-W40', 50, true],
      ['2026-W38', 50, true],
    ]);
    expect(g).toMatchObject({ consecutive: false, twoInARow: false });

    // W39 goes out after all, a day late: the two newest are now adjacent, but one is late.
    await db().update(digestIssues).set({ status: 'sent', sentAt: ago(13 * DAY) }).where(eq(digestIssues.id, w39.id));
    await sendAll(w39.id, subs);
    g = await gate();
    expect(g.issues.map((i) => i.isoWeek)).toEqual(['2026-W40', '2026-W39']);
    expect(g).toMatchObject({ consecutive: true, twoInARow: false });

    // On time, both to 50: met. One digest fewer in either issue: not met.
    await db().update(digestIssues).set({ sentAt: onTime(14).sentAt }).where(eq(digestIssues.id, w39.id));
    expect(await gate()).toMatchObject({ consecutive: true, twoInARow: true });
    await db().update(digestSends).set({ error: 'failed:other' }).where(eq(digestSends.subscriberId, subs[0].id));
    expect(await gate()).toMatchObject({ consecutive: true, twoInARow: false });
  });

  it('back-to-back across the new year follows ISO weeks (2026 has a W53)', async () => {
    const subs = await crowd(admin.G3_CONFIRMED);
    const last = await issue({ isoWeek: '2026-W53', sendAfter: ago(14 * DAY), sentAt: ago(14 * DAY) });
    const first = await issue({ isoWeek: '2027-W01', sendAfter: ago(7 * DAY), sentAt: ago(7 * DAY) });
    await sendAll(last.id, subs);
    await sendAll(first.id, subs);
    expect(await admin.gateStatus({ db: db(), now: NOW })).toMatchObject({ consecutive: true, twoInARow: true });
    await db().update(digestIssues).set({ isoWeek: '2026-W52' }).where(eq(digestIssues.id, last.id)); // W53 skipped
    expect(await admin.gateStatus({ db: db(), now: NOW })).toMatchObject({ consecutive: false, twoInARow: false });
  });

  it('a sending issue is unknown inside the window and late after it', async () => {
    await issue({ isoWeek: '2026-W40', status: 'sending', sendAfter: ago(2 * HOUR) });
    expect((await admin.gateStatus({ db: db(), now: NOW })).issues[0]).toMatchObject({ status: 'sending', onTime: null, sentAt: null });
    expect((await admin.gateStatus({ db: db(), now: new Date(NOW.getTime() + 2 * HOUR) })).issues[0].onTime).toBe(false);
  });

  it('bounces and complaints per issue from email_event rows, each svix id once; seed bounces apart', async () => {
    const a = await issue({ isoWeek: '2026-W39', sendAfter: ago(7 * DAY), sentAt: ago(7 * DAY) });
    const b = await issue({ isoWeek: '2026-W38', sendAfter: ago(14 * DAY), sentAt: ago(14 * DAY) });
    await emailEvent({ type: 'email.bounced', kind: 'digest', issue: a.id, bounce: 'Permanent', svix: 'msg_dup' });
    await emailEvent({ type: 'email.bounced', kind: 'digest', issue: a.id, bounce: 'Permanent', svix: 'msg_dup' }); // redelivery
    await emailEvent({ type: 'email.bounced', kind: 'digest', issue: a.id, bounce: null }); // unknown type counts as hard
    await emailEvent({ type: 'email.bounced', kind: 'digest', issue: a.id, bounce: 'Transient' }); // soft: retried by Resend
    await emailEvent({ type: 'email.complained', kind: 'digest', issue: a.id });
    await emailEvent({ type: 'email.suppressed', kind: 'digest', issue: a.id });
    await emailEvent({ type: 'email.bounced', kind: 'digest_seed', issue: a.id, bounce: 'Transient' });
    // A seed that bounced before is on Resend's list: later copies come back suppressed, not bounced.
    await emailEvent({ type: 'email.suppressed', kind: 'digest_seed', issue: a.id });
    await emailEvent({ type: 'email.failed', kind: 'digest_seed', issue: a.id });
    await emailEvent({ type: 'email.bounced', kind: 'digest_test', issue: a.id, bounce: 'Permanent' }); // the admin's own test
    await emailEvent({ type: 'email.suppressed', kind: 'digest_test', issue: a.id });
    await emailEvent({ type: 'email.bounced', kind: 'digest', issue: b.id, bounce: 'Permanent' });
    await emailEvent({ type: 'email.suppressed', kind: 'digest_seed', issue: b.id, svix: 'msg_seed_dup' });
    await emailEvent({ type: 'email.suppressed', kind: 'digest_seed', issue: b.id, svix: 'msg_seed_dup' }); // redelivery
    await emailEvent({ type: 'email.bounced', kind: null, issue: null, bounce: 'Permanent' }); // confirmation email
    await db().insert(jobsLog).values({ job: 'digest', ok: true, detail: { issue: a.id, type: 'email.bounced', kind: 'digest' } });
    const [ga, gb] = (await admin.gateStatus({ db: db(), now: NOW })).issues;
    expect(ga).toMatchObject({ id: a.id, hardBounces: 2, complaints: 1, seedBounces: 3 });
    expect(gb).toMatchObject({ id: b.id, hardBounces: 1, complaints: 0, seedBounces: 1 });
  });
});

describe('optInRate', () => {
  it('confirmed / (confirmed + purged + never-confirmed opt-outs); pending shown apart', async () => {
    expect((await admin.optInRate({ db: db() })).rate).toBeNull();
    await seed(); // confirmed, active
    await seed({ status: 'unsubscribed' }); // confirmed, left later: still a confirmation
    await seed({ status: 'suppressed' }); // confirmed, bounced later
    await seed({ status: 'unsubscribed', confirmedAt: null }); // opted out from the confirm email's prefs link
    await seed({ status: 'pending', confirmedAt: null });
    await seed({ status: 'pending', confirmedAt: null });
    await db().insert(jobsLog).values([
      { job: 'subscribers_purge', ok: true, detail: { deleted: 2, reverted: 1 } },
      { job: 'subscribers_purge', ok: true, detail: { deleted: 0, reverted: 0 } },
      { job: 'subscribers_purge', ok: false, detail: { error: '42P01' } },
    ]);
    expect(await admin.optInRate({ db: db() })).toEqual({ confirmed: 3, purged: 2, neverConfirmedOut: 1, pending: 2, rate: 3 / 6 });
  });
});

describe('parseLookup', () => {
  it('a whole address, normalised; anything partial is not a query', () => {
    expect(admin.parseLookup('  Reader1@Example.ORG ')).toEqual({ email: 'reader1@example.org' });
    for (const q of ['reader1', 'reader1@', '@example.org', 'example.org', '', '   ', null, 42, 'x'.repeat(3000)]) {
      expect(admin.parseLookup(q)).toBeNull();
    }
  });

  it('an id, a token, or a link pasted from one of our emails', async () => {
    const sub = await seed();
    const t = linkToken(sub);
    const links = subscriberLinks(sub);
    expect(admin.parseLookup(sub.id)).toEqual({ id: sub.id });
    expect(admin.parseLookup(t)).toEqual({ id: sub.id });
    for (const url of [links.prefs, links.confirm, links.unsubscribe, links.oneClick, `${links.prefs}?welcome=1`, `/zh/prefs/${t}`]) {
      expect(admin.parseLookup(url)).toEqual({ id: sub.id });
    }
    expect(admin.parseLookup('https://example.org/prefs/not-a-token')).toBeNull();
    expect(admin.parseLookup('sub_0123')).toBeNull();
  });
});

describe('subscriberDetail', () => {
  it('the listed fields and the last three sends; never consent IP, user agent or token version', async () => {
    const sub = await seed({ status: 'paused', pausedUntil: new Date(NOW.getTime() + 7 * DAY), categories: ['vc', 'bogus', 'ai'], locale: 'zh' });
    const weeks = await Promise.all(['2026-W30', '2026-W31', '2026-W32', '2026-W33'].map((isoWeek) => issue({ isoWeek })));
    for (const [i, w] of weeks.entries()) await send(w.id, sub, i === 1 ? 'failed' : 'sent', { claimedAt: ago((10 - i) * DAY), kind: i === 0 ? 'empty' : 'digest' });
    const d = await admin.subscriberDetail({ email: sub.email }, { db: db() });
    expect(d).toMatchObject({
      id: sub.id, email: sub.email, status: 'paused', locale: 'zh', categories: ['ai', 'vc'], consentSource: 'subscribe',
      createdAt: ago(10 * DAY).toISOString(), consentAt: ago(10 * DAY).toISOString(), confirmedAt: ago(9 * DAY).toISOString(),
      unsubscribedAt: null, pausedUntil: new Date(NOW.getTime() + 7 * DAY).toISOString(), inFlight: false,
    });
    expect(d!.sends.map((s) => [s.isoWeek, s.state, s.error])).toEqual([
      ['2026-W33', 'sent', null],
      ['2026-W32', 'sent', null],
      ['2026-W31', 'failed', 'failed:bounced'],
    ]);
    expect(d).toMatchObject({ evLang: null, onlineOnly: false });
    for (const k of ['consentIp', 'consentUa', 'tokenVersion', 'evLangPref']) expect(d).not.toHaveProperty(k);
    expect(JSON.stringify(d)).not.toContain(IP);
    expect(JSON.stringify(d)).not.toContain('consent-ua-marker');
    expect(await admin.subscriberDetail({ id: sub.id }, { db: db() })).toEqual(d);
  });

  it('F19: shows the facets as the digest reads them', async () => {
    const sub = await seed({ evLangPref: ['zh'], onlineOnly: true });
    expect(await admin.subscriberDetail({ id: sub.id }, { db: db() })).toMatchObject({ evLang: 'zh', onlineOnly: true });
    const odd = await seed({ evLangPref: ['xx'], onlineOnly: null });
    expect(await admin.subscriberDetail({ id: odd.id }, { db: db() })).toMatchObject({ evLang: null, onlineOnly: false });
  });

  it('flags a claim in flight, even one older than the last three sends', async () => {
    const sub = await seed();
    const first = await issue({ isoWeek: '2026-W20', status: 'sending' });
    await send(first.id, sub, 'inFlight', { claimedAt: ago(30 * DAY) });
    for (const isoWeek of ['2026-W21', '2026-W22', '2026-W23']) await send((await issue({ isoWeek })).id, sub);
    const d = await admin.subscriberDetail({ id: sub.id }, { db: db() });
    expect(d!.inFlight).toBe(true);
    expect(d!.sends.map((s) => s.isoWeek)).toEqual(['2026-W23', '2026-W22', '2026-W21']);
  });
});

describe('CSV helpers', () => {
  it('quotes every field, doubles quotes, and defuses formula cells', () => {
    expect(admin.csvCell('plain')).toBe('"plain"');
    expect(admin.csvCell('say "hi", ok')).toBe('"say ""hi"", ok"');
    expect(admin.csvCell('line\nbreak')).toBe('"line\nbreak"');
    for (const v of ['=1+1', '+1', '-1', '@SUM(A1)', '\tx', '\rx']) expect(admin.csvCell(v)).toBe(`"'${v}"`);
    expect(admin.csvCell('=HYPERLINK("http://x")')).toBe(`"'=HYPERLINK(""http://x"")"`);
    expect(admin.csvCell('')).toBe('""');
  });

  it('BOM, header and CRLF after every record', () => {
    expect(admin.toCsv(['a', 'b'], [['1', '2'], ['3', '']])).toBe('﻿"a","b"\r\n"1","2"\r\n"3",""\r\n');
  });
});

// ---- the action --------------------------------------------------------------------------------

const form = (fields: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
};
const act = (fields: Record<string, string>) => subscriberAction(null, form(fields));

describe('subscriberAction: find', () => {
  it('exact address only: case and spaces are forgiven, a partial address finds nothing', async () => {
    const sub = await seed({ email: 'someone.long@example.org' });
    // A match says so: the status line is the live region a screen reader hears.
    expect(await act({ _op: 'find', q: '  SOMEONE.long@Example.org ' })).toMatchObject({ ok: true, message: 'Found · 已找到', sub: { id: sub.id, email: sub.email } });
    for (const q of ['someone.long', 'someone.long@example', 'omeone.long@example.org', 'someone.long@example.or', '%@example.org']) {
      expect(await act({ _op: 'find', q })).toMatchObject({ ok: false, sub: null });
    }
    expect((await act({ _op: 'find', q: 'nobody@example.org' }))?.message).toContain('No subscriber');
    expect((await act({ _op: 'find', q: 'someone' }))?.message).toContain('whole email');
  });

  it('a pasted preferences link (or the bare id) resolves to its row', async () => {
    const sub = await seed({ locale: 'zh' });
    expect(await act({ _op: 'find', q: subscriberLinks(sub).prefs })).toMatchObject({ ok: true, sub: { id: sub.id } });
    expect(await act({ _op: 'find', q: sub.id })).toMatchObject({ ok: true, sub: { id: sub.id } });
  });

  it('the state sent to the browser carries no consent IP, user agent or token version', async () => {
    const sub = await seed();
    const state = await act({ _op: 'find', q: sub.email });
    const json = JSON.stringify(state);
    expect(json).not.toContain(IP);
    expect(json).not.toContain('consent-ua-marker');
    expect(json).not.toMatch(/tokenVersion|consentIp|consentUa/);
  });

  it('needs the admin session', async () => {
    h.admin = false;
    await expect(act({ _op: 'find', q: 'reader@example.org' })).rejects.toThrow('NEXT_REDIRECT');
  });
});

describe('subscriberAction: suppress', () => {
  it('by id only, idempotent, one id-only audit row', async () => {
    const sub = await seed({ status: 'paused', pausedUntil: new Date(NOW.getTime() + DAY) });
    const first = await act({ _op: 'suppress', id: sub.id, email: 'other@example.org' });
    expect(first).toMatchObject({ ok: true, sub: { id: sub.id, status: 'suppressed', pausedUntil: null } });
    expect(first?.message).toContain('Suppressed');
    expect(h.refreshed).toBe(1);
    const second = await act({ _op: 'suppress', id: sub.id });
    expect(second).toMatchObject({ ok: true, sub: { status: 'suppressed' } });
    expect(second?.message).toContain('Already suppressed');
    const audit = await jobs('admin_suppress');
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ ok: true, detail: { id: sub.id } });
    expect(JSON.stringify(audit[0].detail)).not.toContain('@');
    expect(h.refreshed).toBe(1);
  });

  it('an address in the id field, or an unknown id, changes nothing', async () => {
    const sub = await seed();
    expect(await act({ _op: 'suppress', id: sub.email })).toMatchObject({ ok: false, sub: null });
    expect(await act({ _op: 'suppress', id: 'sub_0000000000000000' })).toMatchObject({ ok: false, sub: null });
    expect(await act({ _op: 'suppress' })).toMatchObject({ ok: false, sub: null });
    expect((await reload(sub.id)).status).toBe('active');
    expect(await jobs('admin_suppress')).toEqual([]);
  });

  it('needs the admin session', async () => {
    const sub = await seed();
    h.admin = false;
    await expect(act({ _op: 'suppress', id: sub.id })).rejects.toThrow('NEXT_REDIRECT');
    expect((await reload(sub.id)).status).toBe('active');
  });
});

describe('subscriberAction: delete', () => {
  it('deletes the row and its history, with an audit row; then reports not found', async () => {
    const sub = await seed();
    await send((await issue()).id, sub);
    const r = await act({ _op: 'delete', id: sub.id });
    expect(r).toMatchObject({ ok: true, sub: null });
    expect(r?.message).toContain('1 send record');
    expect(r?.message).not.toContain('Resend'); // never on a do-not-send list: nothing to clean up there
    expect(await reload(sub.id)).toBeUndefined();
    expect(await jobs('admin_delete')).toMatchObject([{ ok: true, detail: { id: sub.id } }]);
    expect(h.refreshed).toBe(1);
    expect(await act({ _op: 'delete', id: sub.id })).toMatchObject({ ok: false, sub: null });
  });

  it('refuses while a send is in flight', async () => {
    const sub = await seed();
    await send((await issue({ status: 'sending' })).id, sub, 'inFlight');
    const r = await act({ _op: 'delete', id: sub.id });
    expect(r).toMatchObject({ ok: false, sub: { id: sub.id, inFlight: true } });
    expect(r?.message).toContain('try again after this send finishes');
    expect(await reload(sub.id)).toBeDefined();
    expect(await jobs('admin_delete')).toEqual([]);
  });

  it('a suppressed row is deleted only with the acknowledgement the stronger confirm adds', async () => {
    const sub = await seed({ status: 'suppressed' });
    const r = await act({ _op: 'delete', id: sub.id });
    expect(r).toMatchObject({ ok: false, sub: { status: 'suppressed' } });
    expect(r?.message).toContain('do-not-send');
    expect(await reload(sub.id)).toBeDefined();
    // Resend keeps its own suppression entry, which our delete doesn't touch: both messages say so.
    expect(r?.message).toContain('Resend Dashboard → Suppressions');
    const done = await act({ _op: 'delete', id: sub.id, ack: 'suppressed' });
    expect(done).toMatchObject({ ok: true, sub: null });
    expect(done?.message).toContain('Resend Dashboard → Suppressions');
    expect(done?.message).toContain('Resend 后台 → Suppressions');
    expect(await reload(sub.id)).toBeUndefined();
  });

  it('needs the admin session', async () => {
    const sub = await seed();
    h.admin = false;
    await expect(act({ _op: 'delete', id: sub.id })).rejects.toThrow('NEXT_REDIRECT');
    expect(await reload(sub.id)).toBeDefined();
  });
});

describe('SubscriberLookup', () => {
  it('a controlled query field (React resets the form after each action) and a status line that can take focus', () => {
    const html = renderToStaticMarkup(createElement(SubscriberLookup));
    expect(html).toMatch(/<input[^>]*id="subscriber-q"[^>]*value=""/);
    expect(html).toMatch(/<p[^>]*role="status"[^>]*tabindex="-1"/);
  });
});

// ---- CSV export route --------------------------------------------------------------------------

describe('GET /admin/subscribers/export', () => {
  const get = (headers: Record<string, string> = {}) =>
    exportRoute.GET(new Request('http://localhost/admin/subscribers/export', { headers }));

  it('401 without a session, and no audit row', async () => {
    await seed();
    const res = await get();
    expect(res.status).toBe(401);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.text()).toBe('');
    expect(await jobs('subscribers_export')).toEqual([]);
  });

  it('401 with only a Bearer token, even one with every scope (tokens never read subscribers)', async () => {
    await seed();
    const { token } = await createToken('phone', ['ingest', 'publish', 'candidates']);
    const res = await get({ authorization: `Bearer ${token}` });
    expect(res.status).toBe(401);
    expect(await res.text()).toBe('');
  });

  it('401 when the session check throws (forged cookie)', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    h.session = true;
    expect((await get({ cookie: 'broken' })).status).toBe(401);
  });

  it('403 for a cross-site request, even with a session', async () => {
    h.session = true;
    expect((await get({ 'sec-fetch-site': 'cross-site' })).status).toBe(403);
    expect((await get({ 'sec-fetch-site': 'same-origin' })).status).toBe(200);
  });

  it('every status, no IP or user agent, RFC 4180 with BOM, injection-safe, never cached', async () => {
    h.session = true;
    const statuses = ['pending', 'active', 'paused', 'unsubscribed', 'suppressed'] as const;
    for (const [i, status] of statuses.entries()) {
      await seed({ status, createdAt: ago((20 - i) * DAY), unsubscribedAt: status === 'unsubscribed' ? ago(DAY) : null, locale: i % 2 ? 'zh' : 'en' });
    }
    await seed({ email: '=cmd@example.org', consentSource: 'say "hi", -1', createdAt: ago(DAY), categories: ['ai', 'cycling'], evLangPref: ['zh'], onlineOnly: true });
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/csv; charset=utf-8');
    expect(res.headers.get('content-disposition')).toMatch(/^attachment; filename="subscribers-\d{4}-\d{2}-\d{2}\.csv"$/);
    expect(res.headers.get('cache-control')).toBe('no-store, private');
    expect(res.headers.get('x-robots-tag')).toBe('noindex');
    const bytes = new Uint8Array(await res.clone().arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const body = await res.text();
    expect(body.endsWith('\r\n')).toBe(true);
    const lines = body.replace(/^﻿/, '').split('\r\n').slice(0, -1);
    expect(lines[0]).toBe(
      '"id","email","status","locale","categories","created_at","consent_at","consent_source","confirmed_at","unsubscribed_at","paused_until","ev_lang_pref","online_only"',
    );
    expect(lines).toHaveLength(7);
    expect(lines.slice(1, 6).map((l) => l.split(',')[2])).toEqual(statuses.map((s) => `"${s}"`));
    expect(lines[6]).toContain(`"'=cmd@example.org"`);
    expect(lines[6]).toContain(`"say ""hi"", -1"`);
    expect(lines[6]).toContain('"ai;cycling"');
    // F19 facets last, as the digest reads them: the language or empty, online true / false.
    expect(lines[6].endsWith(',"zh","true"')).toBe(true);
    expect(lines.slice(1, 6).every((l) => l.endsWith(',"","false"'))).toBe(true);
    expect(body).not.toContain(IP);
    expect(body).not.toContain('consent-ua-marker');
    expect(body).not.toMatch(/consent_ip|consent_ua|token_version/);
    expect(await jobs('subscribers_export')).toMatchObject([{ ok: true, detail: { rows: 6 } }]);
  });

  it('a database failure is a 500 with nothing in it', async () => {
    h.session = true;
    const logs: unknown[] = [];
    vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => void logs.push(a));
    await seed({ email: 'private.person@example.org' });
    const real = h.db as DB;
    h.db = new Proxy(real, { get: (t, p) => (p === 'insert' ? () => { throw new Error('insert failed for private.person@example.org'); } : Reflect.get(t, p)) });
    const res = await get();
    h.db = real;
    expect(res.status).toBe(500);
    expect(await res.text()).toBe('');
    expect(JSON.stringify(logs)).not.toContain('private.person');
  });
});

// ---- retention in /api/cron/sync (DESIGN D3) ----------------------------------------------------

describe('GET /api/cron/sync: unsubscribed retention', () => {
  beforeEach(() => {
    vi.stubEnv('CRON_SECRET', 'cron-secret');
    for (const k of ['GCAL_SECRET_ICS_URL', 'LUMA_PERSONAL_ICS_URL', 'PARTIFUL_ICS_URL']) vi.stubEnv(k, '');
  });
  const run = () => cronRoute.GET(new Request('http://localhost/api/cron/sync', { headers: { authorization: 'Bearer cron-secret' } }));
  const yearAgo = (extra: number) => new Date(Date.now() - UNSUBSCRIBED_TTL_MS - extra);

  it('deletes rows unsubscribed over a year ago with their history, reports unsubscribed_purged, logs subscribers_retention', async () => {
    const old = await seed({ status: 'unsubscribed', unsubscribedAt: yearAgo(DAY) });
    const recent = await seed({ status: 'unsubscribed', unsubscribedAt: yearAgo(-DAY) });
    const blocked = await seed({ status: 'suppressed', unsubscribedAt: yearAgo(DAY) });
    await send((await issue()).id, old);
    const res = await run();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, job: 'sync', pending_purged: 0, pending_reverted: 0, unsubscribed_purged: 1 });
    expect(await reload(old.id)).toBeUndefined();
    expect(await reload(recent.id)).toBeDefined();
    expect(await reload(blocked.id)).toBeDefined();
    const [job, ...more] = await jobs('subscribers_retention');
    expect(more).toEqual([]);
    expect(job).toMatchObject({ ok: true, detail: { deleted: 1 } });
    expect(job.finishedAt).toBeInstanceOf(Date);
    expect(await jobs('subscribers_purge')).toHaveLength(1); // the pending purge keeps its own row
    expect(await (await run()).json()).toMatchObject({ ok: true, unsubscribed_purged: 0 });
  });

  it('a retention failure: ok false, its count null, a failed row with the error name; the pending purge still runs', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const stale = await seed({ status: 'pending', confirmedAt: null, consentAt: new Date(Date.now() - 8 * DAY) });
    const real = h.db as DB;
    h.db = new Proxy(real, { get: (t, p) => (p === 'execute' ? () => { throw new TypeError('driver went away'); } : Reflect.get(t, p)) });
    const body = await (await run()).json();
    h.db = real;
    expect(body).toMatchObject({ ok: false, pending_purged: 1, unsubscribed_purged: null });
    expect(await reload(stale.id)).toBeUndefined();
    expect(await jobs('subscribers_retention')).toMatchObject([{ ok: false, detail: { error: 'TypeError' } }]);
    expect(await jobs('subscribers_purge')).toMatchObject([{ ok: true, detail: { deleted: 1 } }]);
  });
});
