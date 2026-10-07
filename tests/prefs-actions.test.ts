import { eq } from 'drizzle-orm';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { testDb } from './helpers/pglite';

// Preference center and /unsubscribe Server Actions (guide「偏好中心」「退订」): public endpoints, so
// every call re-checks the link token, validates its fields, and answers with a message key only.
const h = vi.hoisted(() => ({
  db: null as unknown,
  hasDb: true,
  refreshes: 0,
  sent: [] as { to: string; subject: string; text: string; html: string }[],
  sendError: null as Error | null,
  headers: new Headers(),
}));
vi.mock('@/lib/db', async (orig) => ({
  ...(await orig()),
  db: new Proxy({}, { get: (_t, p) => Reflect.get(h.db as object, p) }),
  hasDatabase: () => h.hasDb,
}));
vi.mock('next/cache', () => ({ refresh: () => void h.refreshes++, updateTag: () => {}, revalidateTag: () => {} }));
vi.mock('next/headers', () => ({ headers: async () => h.headers }));
vi.mock('@/lib/email/send', async (orig) => ({
  ...(await orig()),
  sendEmail: async (m: (typeof h.sent)[number]) => {
    if (h.sendError) throw h.sendError;
    h.sent.push(m);
    return { id: 'test' };
  },
}));

const { changeLanguage, changePause, changeSubscription, savePreferences, unsubscribeFrom } = await import('@/app/[locale]/prefs/actions');
const { PrefsForm } = await import('@/components/PrefsForm');
const { UnsubscribeButtons } = await import('@/components/UnsubscribeButtons');
const { hashToken } = await import('@/lib/api/token-hash');
const { subscribers } = await import('@/lib/db/schema');
const { newId } = await import('@/lib/ids');
const { _resetMemoryLimits, limit, LIMITS } = await import('@/lib/ratelimit');
const { inboxKey, PAUSE_MS } = await import('@/lib/subscribers/service');
const { linkToken, verifyToken } = await import('@/lib/subscribers/token');
type DB = import('@/lib/db').DB;
type Category = import('@/lib/taxonomy').Category;

const SECRET = 'test-secret-prefs-0123456789abcdef';
const EMAIL = 'reader@example.com';

beforeEach(async () => {
  vi.stubEnv('SUBSCRIBER_LINK_SECRET', SECRET);
  // F20: alerts in 'dev' mode (off Vercel), so the going-alerts box counts unless a test turns it off.
  vi.stubEnv('VERCEL', '');
  vi.stubEnv('ALERTS_SENDING', '');
  vi.stubEnv('DIGEST_SENDING', '');
  h.db = (await testDb()).db;
  h.hasDb = true;
  h.refreshes = 0;
  h.sent = [];
  h.sendError = null;
  h.headers = new Headers({ 'x-forwarded-for': '198.51.100.7, 10.0.0.1', 'user-agent': 'Mozilla/5.0 (prefs test)' });
  _resetMemoryLimits();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const db = () => h.db as DB;
const get = async (id: string) => (await db().select().from(subscribers).where(eq(subscribers.id, id)))[0];

async function seed(over: Partial<typeof subscribers.$inferInsert> = {}) {
  const now = new Date();
  const [row] = await db()
    .insert(subscribers)
    .values({
      id: newId('sub'),
      email: EMAIL,
      status: 'active',
      locale: 'en',
      categories: ['ai', 'hackathon', 'cycling'],
      consentAt: now,
      confirmedAt: now,
      consentSource: 'subscribe',
      ...over,
    })
    .returning();
  return { row, token: linkToken(row) };
}

function form(fields: Record<string, string | string[]> = {}) {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) for (const x of [v].flat()) f.append(k, x);
  return f;
}

/** One valid call per action, for the checks every action shares. */
const calls = {
  savePreferences: (t: string) => savePreferences(t, null, form({ locale: 'zh', c: 'ai' })),
  changeLanguage: (t: string) => changeLanguage(t, null, form({ locale: 'zh' })),
  changePause: (t: string) => changePause(t, null, form({ intent: 'pause' })),
  changeSubscription: (t: string) => changeSubscription(t, null, form({ intent: 'unsubscribe' })),
  unsubscribeFrom: (t: string) => unsubscribeFrom(t, null, form({ c: 'all' })),
};
const each = Object.entries(calls);

describe('token gate', () => {
  it.each(each)('%s refuses bad, forged, foreign and outdated tokens without touching the row', async (_name, call) => {
    const { row, token } = await seed();
    const otherSecret = (() => {
      vi.stubEnv('SUBSCRIBER_LINK_SECRET', 'some-other-secret');
      const t = linkToken(row);
      vi.stubEnv('SUBSCRIBER_LINK_SECRET', SECRET);
      return t;
    })();
    const sig = token.split('.')[1];
    const flipped = `${row.id}.${sig[0] === 'A' ? 'B' : 'A'}${sig.slice(1)}`;
    const unknown = linkToken({ id: newId('sub'), tokenVersion: 1 });
    const bad = ['', 'nope', row.id, `${row.id}.`, flipped, otherSecret, unknown, `${token}x`, 42 as unknown as string];
    for (const t of bad) expect(await call(t)).toEqual({ ok: false, key: 'prefs.linkExpired' });
    expect(h.refreshes).toBe(0);
    expect(await get(row.id)).toEqual(row);
  });

  it.each(each)('%s refuses a link voided by bumping token_version', async (_name, call) => {
    const { row, token } = await seed();
    await db().update(subscribers).set({ tokenVersion: 2 }).where(eq(subscribers.id, row.id));
    expect(await call(token)).toEqual({ ok: false, key: 'prefs.linkExpired' });
    expect((await get(row.id)).status).toBe('active');
  });

  it.each(each)('%s answers "unavailable" and never queries without the link secret or a database', async (_name, call) => {
    const { row, token } = await seed();
    const real = h.db;
    h.db = new Proxy({}, { get: () => { throw new Error('db touched'); } });
    vi.stubEnv('SUBSCRIBER_LINK_SECRET', '');
    expect(await call(token)).toEqual({ ok: false, key: 'link.unavailable' });
    vi.stubEnv('SUBSCRIBER_LINK_SECRET', SECRET);
    h.hasDb = false;
    expect(await call(token)).toEqual({ ok: false, key: 'link.unavailable' });
    h.db = real;
    expect(await get(row.id)).toEqual(row);
  });

  it.each(each)('%s leaves a suppressed row alone and re-renders the page as status only', async (_name, call) => {
    const { row, token } = await seed({ status: 'suppressed' });
    expect(await call(token)).toEqual({ ok: false, key: 'prefs.statusSuppressed' });
    expect(h.refreshes).toBe(1);
    expect(await get(row.id)).toEqual(row);
    expect(h.sent).toHaveLength(0);
  });

  it('a database failure becomes a generic error, logged without the address or the token', async () => {
    const { token } = await seed();
    const real = h.db as DB;
    h.db = new Proxy(real, {
      get: (t, p) => (p === 'update' ? () => { throw new Error(`write failed for ${EMAIL} via ${token}`); } : Reflect.get(t, p)),
    });
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await changePause(token, null, form({ intent: 'pause' }))).toEqual({ ok: false, key: 'state.error' });
    const logged = log.mock.calls.flat().join(' ');
    expect(logged).toContain('[prefs]');
    expect(logged).not.toContain(EMAIL);
    expect(logged).not.toContain(token);
    expect(logged).toContain('r***@example.com');
  });
});

describe('savePreferences', () => {
  it('saves language and categories, keeping only known slugs in canonical order', async () => {
    const { row, token } = await seed();
    const r = await savePreferences(token, null, form({ locale: 'zh', c: ['social', 'ai', 'ai', 'bogus'] }));
    expect(r).toEqual({ ok: true, key: 'prefs.saved' });
    expect(h.refreshes).toBe(1);
    const after = await get(row.id);
    expect(after).toMatchObject({ status: 'active', locale: 'zh', categories: ['ai', 'social'] });
    expect(after.tokenVersion).toBe(row.tokenVersion); // the emailed links keep working
  });

  it('works for pending and paused rows without changing their status', async () => {
    const until = new Date(Date.now() + 5 * 864e5);
    const pending = await seed({ status: 'pending', confirmedAt: null });
    const paused = await seed({ email: 'paused@example.com', status: 'paused', pausedUntil: until });
    expect(await savePreferences(pending.token, null, form({ locale: 'en', c: 'vc' }))).toEqual({ ok: true, key: 'prefs.saved' });
    expect(await savePreferences(paused.token, null, form({ locale: 'zh', c: ['vc', 'campus'] }))).toEqual({ ok: true, key: 'prefs.saved' });
    expect(await get(pending.row.id)).toMatchObject({ status: 'pending', categories: ['vc'] });
    expect(await get(paused.row.id)).toMatchObject({ status: 'paused', pausedUntil: until, locale: 'zh', categories: ['vc', 'campus'] });
  });

  it('an empty selection unsubscribes', async () => {
    const { row, token } = await seed();
    expect(await savePreferences(token, null, form({ locale: 'en' }))).toEqual({ ok: true, key: 'prefs.unsubscribed' });
    const after = await get(row.id);
    expect(after.status).toBe('unsubscribed');
    expect(after.unsubscribedAt).toBeInstanceOf(Date);
    expect(h.refreshes).toBe(1);
  });

  it.each([
    ['a missing language', { c: 'ai' }],
    ['an unknown language', { locale: 'fr', c: 'ai' }],
    ['only forged categories', { locale: 'en', c: ['bogus', 'AI'] }],
  ])('rejects %s without changing anything', async (_label, fields) => {
    const { row, token } = await seed();
    expect(await savePreferences(token, null, form(fields))).toEqual({ ok: false, key: 'state.error' });
    expect(await get(row.id)).toEqual(row);
    expect(h.refreshes).toBe(0);
  });

  it('F19: saves the event-language and online facets, and clears them', async () => {
    const { row, token } = await seed();
    const facets = { locale: 'en', c: 'ai', facets_present: '1' };
    expect(await savePreferences(token, null, form({ ...facets, ev_lang: 'zh', online: '1' }))).toEqual({ ok: true, key: 'prefs.saved' });
    expect(await get(row.id)).toMatchObject({ evLangPref: ['zh'], onlineOnly: true, categories: ['ai'] });
    // "Bilingual only" isn't offered on the page but is a valid stored choice (it can come from a feed link).
    await savePreferences(token, null, form({ ...facets, ev_lang: 'bilingual' }));
    expect(await get(row.id)).toMatchObject({ evLangPref: ['bilingual'], onlineOnly: null });
    await savePreferences(token, null, form({ ...facets, ev_lang: '', online: '1' }));
    expect(await get(row.id)).toMatchObject({ evLangPref: null, onlineOnly: true });
    await savePreferences(token, null, form(facets)); // "Any" unchecked radio posts nothing: no facets
    expect(await get(row.id)).toMatchObject({ evLangPref: null, onlineOnly: null });
  });

  it('F19: a form without the facet section (a page from before F19) keeps the stored facets', async () => {
    const { row, token } = await seed({ evLangPref: ['zh'], onlineOnly: true });
    expect(await savePreferences(token, null, form({ locale: 'zh', c: ['ai', 'vc'] }))).toEqual({ ok: true, key: 'prefs.saved' });
    expect(await get(row.id)).toMatchObject({ locale: 'zh', categories: ['ai', 'vc'], evLangPref: ['zh'], onlineOnly: true });
  });

  it.each([
    ['an unknown event language', { ev_lang: 'fr' }],
    ['an upper-case one', { ev_lang: 'ZH' }],
    ['a forged online value', { online: 'yes' }],
    ['online posted twice', { online: ['1', '1'] }],
  ])('F19: rejects %s without changing anything', async (_label, extra: Record<string, string | string[]>) => {
    const { row, token } = await seed({ evLangPref: ['en'] });
    expect(await savePreferences(token, null, form({ locale: 'en', c: 'ai', facets_present: '1', ...extra }))).toEqual({ ok: false, key: 'state.error' });
    expect(await get(row.id)).toEqual(row);
    expect(h.refreshes).toBe(0);
  });

  it('a stale page cannot resubscribe an unsubscribed row by saving', async () => {
    const { row, token } = await seed({ status: 'unsubscribed', unsubscribedAt: new Date() });
    expect(await savePreferences(token, null, form({ locale: 'en', c: 'ai' }))).toEqual({ ok: false, key: 'state.error' });
    expect(await get(row.id)).toEqual(row);
    expect(h.refreshes).toBe(1); // re-render shows "Subscribe again" instead
  });
});

describe('savePreferences: going alerts (F20)', () => {
  const save = (token: string, extra: Record<string, string | string[]> = {}) =>
    savePreferences(token, null, form({ locale: 'en', c: 'ai', ...extra }));

  it('ticking the box turns alerts on from now, saving again keeps that time, unticking clears it', async () => {
    const { row, token } = await seed();
    const before = Date.now();
    expect(await save(token, { alerts_present: '1', alerts: '1' })).toEqual({ ok: true, key: 'prefs.saved' });
    const on = await get(row.id);
    expect(on.goingAlerts).toBe(true);
    expect(on.goingAlertsSince!.getTime()).toBeGreaterThanOrEqual(before - 1000);
    await save(token, { alerts_present: '1', alerts: '1' });
    expect((await get(row.id)).goingAlertsSince).toEqual(on.goingAlertsSince);
    // The section was on the page and the box is unticked: off.
    expect(await save(token, { alerts_present: '1' })).toEqual({ ok: true, key: 'prefs.saved' });
    expect(await get(row.id)).toMatchObject({ goingAlerts: false, goingAlertsSince: null, categories: ['ai'] });
  });

  it('a form without the box (alerts off when the page rendered) keeps the stored choice', async () => {
    const since = new Date(Date.now() - 864e5);
    const { row, token } = await seed({ goingAlerts: true, goingAlertsSince: since });
    expect(await save(token)).toEqual({ ok: true, key: 'prefs.saved' });
    expect(await get(row.id)).toMatchObject({ goingAlerts: true, goingAlertsSince: since });
  });

  it.each([
    ['ALERTS_SENDING=0', { ALERTS_SENDING: '0' }],
    ['Vercel without a verified sender', { VERCEL: '1', RESEND_API_KEY: '', RESEND_FROM: '' }],
  ])('with alerts off here (%s) the box is ignored: a stale page can change neither way', async (_label, env: Record<string, string>) => {
    for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
    const on = await seed({ goingAlerts: true, goingAlertsSince: new Date(Date.now() - 864e5) });
    expect(await save(on.token, { alerts_present: '1' })).toEqual({ ok: true, key: 'prefs.saved' });
    expect(await get(on.row.id)).toMatchObject({ goingAlerts: true, goingAlertsSince: on.row.goingAlertsSince, categories: ['ai'] });
    const off = await seed({ email: 'off@example.com' });
    await save(off.token, { alerts_present: '1', alerts: '1' });
    expect(await get(off.row.id)).toMatchObject({ goingAlerts: false, goingAlertsSince: null });
  });

  it.each([
    ['a forged value', { alerts: 'yes' }],
    ['the box posted twice', { alerts: ['1', '1'] }],
  ])('rejects %s without changing anything', async (_label, extra: Record<string, string | string[]>) => {
    const { row, token } = await seed();
    expect(await save(token, { alerts_present: '1', ...extra })).toEqual({ ok: false, key: 'state.error' });
    expect(await get(row.id)).toEqual(row);
    expect(h.refreshes).toBe(0);
  });

  it('no category and the box unticked: unsubscribed with alerts off, so "Subscribe again" brings back only the weekly email', async () => {
    const { row, token } = await seed({ goingAlerts: true, goingAlertsSince: new Date(Date.now() - 864e5) });
    expect(await savePreferences(token, null, form({ locale: 'en', alerts_present: '1' }))).toEqual({ ok: true, key: 'prefs.unsubscribed' });
    expect(await get(row.id)).toMatchObject({ status: 'unsubscribed', goingAlerts: false, goingAlertsSince: null });
    expect(await changeSubscription(token, null, form({ intent: 'resubscribe' }))).toEqual({ ok: true, key: 'prefs.resubscribed' });
    expect(await get(row.id)).toMatchObject({ status: 'active', goingAlerts: false, goingAlertsSince: null });
  });

  it('the one-tap language switch never touches alerts, whatever the post carries', async () => {
    const since = new Date(Date.now() - 864e5);
    const { row, token } = await seed({ goingAlerts: true, goingAlertsSince: since });
    expect(await changeLanguage(token, null, form({ locale: 'zh', alerts_present: '1' }))).toEqual({ ok: true, key: 'prefs.langSwitchedZh' });
    expect(await get(row.id)).toMatchObject({ locale: 'zh', goingAlerts: true, goingAlertsSince: since });
  });
});

describe('changeLanguage', () => {
  it('switches only the edition language; categories come from the row, not the post', async () => {
    const { row, token } = await seed();
    expect(await changeLanguage(token, null, form({ locale: 'zh', c: 'social' }))).toEqual({ ok: true, key: 'prefs.langSwitchedZh' });
    expect(h.refreshes).toBe(1);
    const after = await get(row.id);
    expect(after).toMatchObject({ status: 'active', locale: 'zh', categories: ['ai', 'hackathon', 'cycling'] });
    expect(after.tokenVersion).toBe(row.tokenVersion);
    // Pressing it again (double click, a second tab) is still a success.
    expect(await changeLanguage(token, null, form({ locale: 'zh' }))).toEqual({ ok: true, key: 'prefs.langSwitchedZh' });
    expect(await changeLanguage(token, null, form({ locale: 'en' }))).toEqual({ ok: true, key: 'prefs.langSwitchedEn' });
    expect((await get(row.id)).locale).toBe('en');
  });

  it('F19: leaves the facets alone, whatever the post carries', async () => {
    const { row, token } = await seed({ evLangPref: ['zh'], onlineOnly: true });
    expect(await changeLanguage(token, null, form({ locale: 'zh', facets_present: '1', ev_lang: '' }))).toEqual({ ok: true, key: 'prefs.langSwitchedZh' });
    expect(await get(row.id)).toMatchObject({ locale: 'zh', evLangPref: ['zh'], onlineOnly: true });
  });

  it('works for pending and paused rows without changing their status', async () => {
    const until = new Date(Date.now() + 5 * 864e5);
    const pending = await seed({ status: 'pending', confirmedAt: null });
    const paused = await seed({ email: 'paused@example.com', status: 'paused', pausedUntil: until });
    expect(await changeLanguage(pending.token, null, form({ locale: 'zh' }))).toMatchObject({ ok: true });
    expect(await changeLanguage(paused.token, null, form({ locale: 'zh' }))).toMatchObject({ ok: true });
    expect(await get(pending.row.id)).toMatchObject({ status: 'pending', locale: 'zh' });
    expect(await get(paused.row.id)).toMatchObject({ status: 'paused', pausedUntil: until, locale: 'zh' });
  });

  it.each([[{}], [{ locale: 'fr' }], [{ locale: 'ZH' }]])('rejects a missing or unknown language %j', async (fields: Record<string, string>) => {
    const { row, token } = await seed();
    expect(await changeLanguage(token, null, form(fields))).toEqual({ ok: false, key: 'state.error' });
    expect(await get(row.id)).toEqual(row);
    expect(h.refreshes).toBe(0);
  });

  it('a stale page cannot change an unsubscribed row, and never unsubscribes a row without categories', async () => {
    const gone = await seed({ status: 'unsubscribed', unsubscribedAt: new Date() });
    expect(await changeLanguage(gone.token, null, form({ locale: 'zh' }))).toEqual({ ok: false, key: 'state.error' });
    expect(await get(gone.row.id)).toEqual(gone.row);
    const empty = await seed({ email: 'empty@example.com', categories: [] });
    expect(await changeLanguage(empty.token, null, form({ locale: 'zh' }))).toEqual({ ok: false, key: 'state.error' });
    expect(await get(empty.row.id)).toEqual(empty.row);
    expect(h.refreshes).toBe(2); // re-render without the offer
  });
});

describe('changePause', () => {
  it('pauses an active row for 4 weeks, and a second press keeps it paused', async () => {
    const { row, token } = await seed();
    const before = Date.now();
    expect(await changePause(token, null, form({ intent: 'pause' }))).toEqual({ ok: true, key: 'prefs.paused' });
    const after = await get(row.id);
    expect(after.status).toBe('paused');
    expect(after.pausedUntil!.getTime()).toBeGreaterThanOrEqual(before + PAUSE_MS);
    expect(after.pausedUntil!.getTime()).toBeLessThanOrEqual(Date.now() + PAUSE_MS);
    expect(await changePause(token, null, form({ intent: 'pause' }))).toEqual({ ok: true, key: 'prefs.paused' });
    expect((await get(row.id)).status).toBe('paused');
    expect(h.refreshes).toBe(2);
  });

  it('resumes a paused row, and resuming an active row is a no-op', async () => {
    const { row, token } = await seed({ status: 'paused', pausedUntil: new Date(Date.now() + 864e5) });
    expect(await changePause(token, null, form({ intent: 'resume' }))).toEqual({ ok: true, key: 'prefs.resumed' });
    expect(await get(row.id)).toMatchObject({ status: 'active', pausedUntil: null });
    expect(await changePause(token, null, form({ intent: 'resume' }))).toEqual({ ok: true, key: 'prefs.resumed' });
    expect(await get(row.id)).toMatchObject({ status: 'active', pausedUntil: null });
  });

  it.each([
    ['pending', { intent: 'pause' }, { status: 'pending' as const, confirmedAt: null }],
    ['unsubscribed', { intent: 'pause' }, { status: 'unsubscribed' as const }],
    ['unsubscribed', { intent: 'resume' }, { status: 'unsubscribed' as const }],
    ['active', { intent: 'toggle' }, {}],
    ['active', {}, {}],
  ])('refuses on a %s row with %o', async (_status, fields, over) => {
    const { row, token } = await seed(over);
    expect(await changePause(token, null, form(fields))).toEqual({ ok: false, key: 'state.error' });
    expect(await get(row.id)).toEqual(row);
  });
});

describe('changeSubscription', () => {
  it('unsubscribes; repeating it still succeeds and the link keeps working for "Subscribe again"', async () => {
    const { row, token } = await seed({ status: 'paused', pausedUntil: new Date(Date.now() + 864e5) });
    expect(await changeSubscription(token, null, form({ intent: 'unsubscribe' }))).toEqual({ ok: true, key: 'prefs.unsubscribed' });
    const after = await get(row.id);
    expect(after).toMatchObject({ status: 'unsubscribed', pausedUntil: null, categories: row.categories });
    expect(verifyToken(token, after)).toBe(true);
    expect(await changeSubscription(token, null, form({ intent: 'unsubscribe' }))).toEqual({ ok: true, key: 'prefs.unsubscribed' });
    expect(await get(row.id)).toEqual(after);
    expect(h.refreshes).toBe(2);
  });

  it('a pending row can unsubscribe too', async () => {
    const { row, token } = await seed({ status: 'pending', confirmedAt: null });
    expect(await changeSubscription(token, null, form({ intent: 'unsubscribe' }))).toEqual({ ok: true, key: 'prefs.unsubscribed' });
    expect((await get(row.id)).status).toBe('unsubscribed');
  });

  it('a previously confirmed address comes straight back, with no email', async () => {
    const unsubscribedAt = new Date(Date.now() - 864e5);
    const { row, token } = await seed({ status: 'unsubscribed', unsubscribedAt });
    expect(await changeSubscription(token, null, form({ intent: 'resubscribe' }))).toEqual({ ok: true, key: 'prefs.resubscribed' });
    // The earlier opt-out stays on record next to the new consent.
    expect(await get(row.id)).toMatchObject({ status: 'active', unsubscribedAt, confirmedAt: row.confirmedAt, categories: row.categories });
    expect(h.sent).toHaveLength(0);
    // Double click: already back.
    expect(await changeSubscription(token, null, form({ intent: 'resubscribe' }))).toEqual({ ok: true, key: 'prefs.resubscribed' });
    expect(h.sent).toHaveLength(0);
  });

  it('a never-confirmed address goes back to pending and gets one confirmation email', async () => {
    const old = new Date(Date.now() - 3 * 864e5);
    const { row, token } = await seed({ status: 'unsubscribed', confirmedAt: null, consentAt: old, unsubscribedAt: old, locale: 'zh' });
    expect(await changeSubscription(token, null, form({ intent: 'resubscribe' }))).toEqual({ ok: true, key: 'prefs.resubscribePending' });
    const after = await get(row.id);
    expect(after.status).toBe('pending');
    expect(after.consentAt!.getTime()).toBeGreaterThan(old.getTime());
    expect(h.sent).toHaveLength(1);
    expect(h.sent[0].to).toBe(EMAIL);
    const link = /https?:\/\/\S+\/zh\/confirm\/(\S+)/.exec(h.sent[0].text);
    expect(link).not.toBeNull();
    expect(verifyToken(link![1], after)).toBe(true);
    // A second press doesn't send another one.
    expect(await changeSubscription(token, null, form({ intent: 'resubscribe' }))).toEqual({ ok: true, key: 'prefs.resubscribePending' });
    expect(h.sent).toHaveLength(1);
  });

  it('F20: the confirmation for a comeback names going alerts when they come back on, and only then', async () => {
    const old = new Date(Date.now() - 3 * 864e5);
    const on = await seed({ status: 'unsubscribed', confirmedAt: null, consentAt: old, unsubscribedAt: old, goingAlerts: true, goingAlertsSince: old });
    expect(await changeSubscription(on.token, null, form({ intent: 'resubscribe' }))).toEqual({ ok: true, key: 'prefs.resubscribePending' });
    const off = await seed({ email: 'off@example.com', status: 'unsubscribed', confirmedAt: null, consentAt: old, unsubscribedAt: old });
    expect(await changeSubscription(off.token, null, form({ intent: 'resubscribe' }))).toEqual({ ok: true, key: 'prefs.resubscribePending' });
    expect(h.sent.map((m) => m.to)).toEqual([EMAIL, 'off@example.com']);
    const line = { en: 'Going alerts are on too: at most one email a day when Victor marks an event as going.', zh: '会去提醒也已打开：Victor 标记会去的活动时，每天最多一封。' };
    for (const l of [line.en, line.zh]) {
      expect(h.sent[0].text).toContain(l);
      expect(h.sent[0].html).toContain(l);
      expect(h.sent[1].text).not.toContain(l);
    }
  });

  it('coming back records a new consent: time, IP, user agent and the prefs page', async () => {
    const old = new Date(Date.now() - 30 * 864e5);
    const { row, token } = await seed({
      status: 'unsubscribed', unsubscribedAt: old, consentAt: old, consentIp: '203.0.113.7', consentUa: 'old browser', consentSource: 'subscribe',
    });
    const before = Date.now();
    expect(await changeSubscription(token, null, form({ intent: 'resubscribe' }))).toEqual({ ok: true, key: 'prefs.resubscribed' });
    const after = await get(row.id);
    expect(after).toMatchObject({ consentIp: '198.51.100.7', consentUa: 'Mozilla/5.0 (prefs test)', consentSource: 'prefs' });
    expect(after.consentAt!.getTime()).toBeGreaterThanOrEqual(before - 1000);

    // x-real-ip (set by Vercel) wins over x-forwarded-for; a never-confirmed row records it too.
    h.headers = new Headers({ 'x-real-ip': '2001:db8::7', 'x-forwarded-for': '198.51.100.7', 'user-agent': 'second' });
    const p = await seed({ email: 'p@example.com', status: 'unsubscribed', confirmedAt: null, unsubscribedAt: old });
    expect(await changeSubscription(p.token, null, form({ intent: 'resubscribe' }))).toEqual({ ok: true, key: 'prefs.resubscribePending' });
    expect(await get(p.row.id)).toMatchObject({ status: 'pending', consentIp: '2001:db8::7', consentUa: 'second', consentSource: 'prefs', unsubscribedAt: old });
  });

  it('no usable IP or user agent is stored as null, not as junk', async () => {
    h.headers = new Headers({ 'x-forwarded-for': 'unknown' });
    const { row, token } = await seed({ status: 'unsubscribed', unsubscribedAt: new Date(), consentIp: '203.0.113.7', consentUa: 'old' });
    expect(await changeSubscription(token, null, form({ intent: 'resubscribe' }))).toEqual({ ok: true, key: 'prefs.resubscribed' });
    expect(await get(row.id)).toMatchObject({ status: 'active', consentIp: null, consentUa: null, consentSource: 'prefs' });
  });

  it('resubscribe emails share the per-address budget with the subscribe form', async () => {
    const { row, token } = await seed({ status: 'unsubscribed', confirmedAt: null });
    for (let i = 0; i < 3; i++) await limit('subscribeEmail', hashToken(EMAIL));
    expect(await changeSubscription(token, null, form({ intent: 'resubscribe' }))).toEqual({ ok: true, key: 'prefs.resubscribePending' });
    expect((await get(row.id)).status).toBe('pending');
    expect(h.sent).toHaveLength(0);
  });

  it('the per-address budget is per inbox: a plus-tagged row shares the bucket the form used for the plain address', async () => {
    const tagged = 'reader+news@example.com';
    expect(inboxKey(tagged)).toBe(EMAIL);
    const { row, token } = await seed({ email: tagged, status: 'unsubscribed', confirmedAt: null });
    for (let i = 0; i < 3; i++) await limit('subscribeEmail', hashToken(inboxKey(EMAIL)));
    expect(await changeSubscription(token, null, form({ intent: 'resubscribe' }))).toEqual({ ok: true, key: 'prefs.resubscribePending' });
    expect((await get(row.id)).status).toBe('pending');
    expect(h.sent).toHaveLength(0);
  });

  it('with the daily send budget spent: no email, still pending (the earlier confirmation link stays valid)', async () => {
    for (let i = 0; i < LIMITS.subscribeSend.max; i++) await limit('subscribeSend', 'all');
    const { row, token } = await seed({ status: 'unsubscribed', confirmedAt: null });
    expect(await changeSubscription(token, null, form({ intent: 'resubscribe' }))).toEqual({ ok: true, key: 'prefs.resubscribePending' });
    const after = await get(row.id);
    expect(after.status).toBe('pending');
    expect(after.tokenVersion).toBe(row.tokenVersion);
    expect(h.sent).toHaveLength(0);
    expect(h.refreshes).toBe(1);
  });

  it('a resubscribe email spends one unit of the daily budget; a confirmed comeback spends none', async () => {
    for (let i = 0; i < LIMITS.subscribeSend.max - 1; i++) await limit('subscribeSend', 'all');
    const back = await seed({ email: 'back@example.com', status: 'unsubscribed', unsubscribedAt: new Date() });
    expect(await changeSubscription(back.token, null, form({ intent: 'resubscribe' }))).toEqual({ ok: true, key: 'prefs.resubscribed' });
    const a = await seed({ email: 'a@example.com', status: 'unsubscribed', confirmedAt: null });
    expect(await changeSubscription(a.token, null, form({ intent: 'resubscribe' }))).toEqual({ ok: true, key: 'prefs.resubscribePending' });
    expect(h.sent.map((m) => m.to)).toEqual(['a@example.com']);
    const b = await seed({ email: 'b@example.com', status: 'unsubscribed', confirmedAt: null });
    expect(await changeSubscription(b.token, null, form({ intent: 'resubscribe' }))).toEqual({ ok: true, key: 'prefs.resubscribePending' });
    expect(h.sent.map((m) => m.to)).toEqual(['a@example.com']);
    expect((await get(b.row.id)).status).toBe('pending');
  });

  it('a failed send is an error, logged without the address', async () => {
    const { row, token } = await seed({ status: 'unsubscribed', confirmedAt: null });
    h.sendError = new Error(`resend: validation_error: cannot send to ${EMAIL}\nto: ${EMAIL}`);
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await changeSubscription(token, null, form({ intent: 'resubscribe' }))).toEqual({ ok: false, key: 'state.error' });
    const logged = log.mock.calls.flat().join(' ');
    expect(logged).toContain('[prefs] action failed');
    expect(logged).toContain('r***@example.com');
    expect(logged).not.toContain(EMAIL);
    expect(logged).not.toContain('to: '); // first line of each error only
    expect((await get(row.id)).status).toBe('pending');
    expect(h.refreshes).toBe(1); // the row did change
  });

  it('active rows and unknown intents', async () => {
    const { row, token } = await seed();
    expect(await changeSubscription(token, null, form({ intent: 'resubscribe' }))).toEqual({ ok: true, key: 'prefs.resubscribed' });
    expect(await changeSubscription(token, null, form({ intent: 'delete' }))).toEqual({ ok: false, key: 'state.error' });
    expect(await changeSubscription(token, null, form())).toEqual({ ok: false, key: 'state.error' });
    expect(await get(row.id)).toEqual(row);
    expect(h.sent).toHaveLength(0);
  });
});

describe('unsubscribeFrom', () => {
  it('stops one category; pressing it again changes nothing', async () => {
    const { row, token } = await seed();
    expect(await unsubscribeFrom(token, null, form({ c: 'hackathon' }))).toEqual({ ok: true, key: 'unsubscribe.stopped', category: 'hackathon' });
    expect(await get(row.id)).toMatchObject({ status: 'active', categories: ['ai', 'cycling'] });
    expect(await unsubscribeFrom(token, null, form({ c: 'hackathon' }))).toEqual({ ok: true, key: 'unsubscribe.stopped', category: 'hackathon' });
    expect(await get(row.id)).toMatchObject({ status: 'active', categories: ['ai', 'cycling'] });
    expect(h.refreshes).toBe(2);
  });

  it('stopping the last category unsubscribes', async () => {
    const { row, token } = await seed({ categories: ['cycling'] });
    expect(await unsubscribeFrom(token, null, form({ c: 'cycling' }))).toEqual({ ok: true, key: 'unsubscribe.done' });
    expect((await get(row.id)).status).toBe('unsubscribed');
  });

  it('a paused row stays paused when it drops a category', async () => {
    const { row, token } = await seed({ status: 'paused', pausedUntil: new Date(Date.now() + 864e5) });
    expect(await unsubscribeFrom(token, null, form({ c: 'ai' }))).toEqual({ ok: true, key: 'unsubscribe.stopped', category: 'ai' });
    expect(await get(row.id)).toMatchObject({ status: 'paused', categories: ['hackathon', 'cycling'] });
  });

  it('"all" unsubscribes, idempotently, and later category presses report done', async () => {
    const { row, token } = await seed();
    expect(await unsubscribeFrom(token, null, form({ c: 'all' }))).toEqual({ ok: true, key: 'unsubscribe.done' });
    const after = await get(row.id);
    expect(after.status).toBe('unsubscribed');
    expect(await unsubscribeFrom(token, null, form({ c: 'all' }))).toEqual({ ok: true, key: 'unsubscribe.done' });
    expect(await unsubscribeFrom(token, null, form({ c: 'ai' }))).toEqual({ ok: true, key: 'unsubscribe.done' });
    expect(await get(row.id)).toEqual(after);
  });

  it('F20 "going" turns off going alerts only; again is harmless; status, categories and language stay', async () => {
    const { row, token } = await seed({ goingAlerts: true, goingAlertsSince: new Date(Date.now() - 864e5), locale: 'zh' });
    expect(await unsubscribeFrom(token, null, form({ c: 'going' }))).toEqual({ ok: true, key: 'unsubscribe.alertsOff' });
    const after = await get(row.id);
    expect(after).toEqual({ ...row, goingAlerts: false, goingAlertsSince: null });
    expect(await unsubscribeFrom(token, null, form({ c: 'going' }))).toEqual({ ok: true, key: 'unsubscribe.alertsOff' });
    expect(await get(row.id)).toEqual(after);
    expect(h.refreshes).toBe(2);
  });

  it('F20 "going" works whatever the alert mode (an opt-out always works), and on an unsubscribed row', async () => {
    vi.stubEnv('ALERTS_SENDING', '0');
    const { row, token } = await seed({ status: 'unsubscribed', unsubscribedAt: new Date(), goingAlerts: true, goingAlertsSince: new Date() });
    expect(await unsubscribeFrom(token, null, form({ c: 'going' }))).toEqual({ ok: true, key: 'unsubscribe.alertsOff' });
    expect(await get(row.id)).toMatchObject({ status: 'unsubscribed', goingAlerts: false, goingAlertsSince: null });
  });

  it.each([[{ c: 'bogus' }], [{ c: '' }], [{}]])('rejects %o', async (fields) => {
    const { row, token } = await seed();
    expect(await unsubscribeFrom(token, null, form(fields))).toEqual({ ok: false, key: 'state.error' });
    expect(await get(row.id)).toEqual(row);
    expect(h.refreshes).toBe(0);
  });
});

describe('mail-app Unsubscribe hints (no-JS fallback, broken link)', () => {
  it('say that on a going alert the mail app\'s button turns off only the alerts (DESIGN-F20 G11), en and zh', async () => {
    const en = (await import('../messages/en.json')).default.Newsletter;
    const zh = (await import('../messages/zh.json')).default.Newsletter;
    for (const hint of [en.link.unsubscribeHint, en.noscript.links]) {
      expect(hint).toContain('Unsubscribe button your mail app shows on a Sunday email');
      expect(hint).toContain('on a going alert, that button turns off only the alerts');
      expect(hint).not.toContain('for this newsletter');
    }
    for (const hint of [zh.link.unsubscribeHint, zh.noscript.links]) {
      expect(hint).toContain('邮件 App 在周报上显示的「退订」按钮');
      expect(hint).toContain('在会去提醒上，这个按钮只关闭提醒');
    }
  });
});

describe('privacy', () => {
  it('answers are small plain objects that never carry the address or the token', async () => {
    const { token } = await seed({ status: 'unsubscribed', confirmedAt: null });
    const results = [
      await changeSubscription(token, null, form({ intent: 'resubscribe' })),
      await savePreferences(token, null, form({ locale: 'zh', c: ['ai', 'vc'] })),
      await changeLanguage(token, null, form({ locale: 'en' })),
      await unsubscribeFrom(token, null, form({ c: 'vc' })),
      await changeSubscription(token, null, form({ intent: 'unsubscribe' })),
      await changePause(`${token}x`, null, form({ intent: 'pause' })),
    ];
    for (const r of results) {
      expect(Object.keys(r!).every((k) => ['ok', 'key', 'category'].includes(k))).toBe(true);
      const s = JSON.stringify(r);
      expect(s).not.toContain(EMAIL);
      expect(s).not.toContain(token.split('.')[1]);
    }
  });
});

describe('markup', () => {
  const noop = async () => null;
  /** Whether the input with this name and value renders checked (attribute order isn't fixed). */
  const checked = (html: string, name: string, value: string) => {
    const tag = [...html.matchAll(/<input[^>]*>/g)].map((m) => m[0]).find((i) => i.includes(`name="${name}"`) && i.includes(`value="${value}"`));
    if (!tag) throw new Error(`no input ${name}=${value}`);
    return tag.includes('checked=""');
  };
  const text = {
    language: 'Email language', en: 'English', zh: '中文', categories: 'Categories', save: 'Save', saving: 'Saving…',
    evLang: 'Event language', evLangAny: 'Any', evLangZh: 'Chinese or bilingual', evLangEn: 'English or bilingual',
    evLangBilingual: 'Bilingual only', onlineOnly: 'Online events only (incl. hybrid)', goingAlerts: 'Email me when Victor marks an event as going',
    pauseTitle: 'Take a break', pause: 'Pause for 4 weeks', resume: 'Resume now', leaveTitle: 'Unsubscribe',
    unsubscribeAll: 'Unsubscribe from everything', resubscribe: 'Subscribe again',
  };
  const messages = Object.fromEntries(
    ['prefs.saved', 'prefs.unsubscribed', 'prefs.paused', 'prefs.resumed', 'prefs.resubscribed', 'prefs.resubscribePending', 'prefs.linkExpired', 'prefs.statusSuppressed', 'link.unavailable', 'state.error', 'prefs.langSwitchedEn', 'prefs.langSwitchedZh'].map((k) => [k, k]),
  ) as Parameters<typeof PrefsForm>[0]['messages'];
  type Props = Parameters<typeof PrefsForm>[0];
  const prefs = (
    status: Props['status'],
    language?: Props['language'],
    facets: Props['facets'] = { evLang: null, onlineOnly: false },
    goingAlerts?: boolean,
  ) =>
    renderToStaticMarkup(
      createElement(PrefsForm, {
        locale: 'en', status, emailLocale: 'zh', categories: ['ai', 'cycling'], facets, goingAlerts,
        actions: { save: noop, pause: noop, leave: noop }, text, messages, language,
      }),
    );
  const offer = (locale: 'en' | 'zh'): Props['language'] => ({
    locale, action: noop, text: { now: "You're getting the Chinese edition.", button: 'Switch to English' },
  });

  it('?lang= naming the other edition offers a one-tap switch above the preferences', () => {
    const html = prefs('active', offer('en'));
    const at = html.indexOf('You&#x27;re getting the Chinese edition.');
    expect(at).toBeGreaterThan(-1);
    expect(at).toBeLessThan(html.indexOf('Email language'));
    const form = html.match(/<form[^>]*>[\s\S]*?<\/form>/)![0];
    expect(form).toContain('<input type="hidden" name="locale" value="en"/>');
    expect(form).toContain('Switch to English');
    // The preferences keep showing the saved language, not the one the link asks for.
    expect(checked(html, 'locale', 'zh')).toBe(true);
  });

  it('no offer when the link names the current edition, or once unsubscribed', () => {
    for (const html of [prefs('active', offer('zh')), prefs('unsubscribed', offer('en')), prefs('active')]) {
      expect(html).not.toContain('getting the Chinese edition');
      expect(html).not.toContain('Switch to English');
    }
    expect(prefs('pending', offer('en'))).toContain('Switch to English');
    expect(prefs('paused', offer('en'))).toContain('Switch to English');
  });

  it('an active row gets preferences, pause and unsubscribe; values come from the row', () => {
    const html = prefs('active');
    expect(html).toContain('Save');
    expect(html).toContain('Pause for 4 weeks');
    expect(html).not.toContain('Resume now');
    expect(html).toContain('Unsubscribe from everything');
    expect(checked(html, 'locale', 'zh')).toBe(true);
    expect(checked(html, 'locale', 'en')).toBe(false);
    expect(checked(html, 'c', 'ai')).toBe(true);
    expect(checked(html, 'c', 'cycling')).toBe(true);
    expect(checked(html, 'c', 'hackathon')).toBe(false);
    expect(html).toContain('<span lang="zh-Hans">中文</span>');
    expect(html).toContain('name="intent" value="pause"');
  });

  it('F19: one event-language radio group and an online checkbox in the preferences form, showing the stored choice', () => {
    const html = prefs('active');
    const form = html.match(/<form[^>]*>[\s\S]*?<\/form>/g)!.find((f) => f.includes('name="c"'))!;
    expect(form).toContain('<input type="hidden" name="facets_present" value="1"/>');
    expect(form).toContain('Event language');
    expect([checked(html, 'ev_lang', ''), checked(html, 'ev_lang', 'zh'), checked(html, 'ev_lang', 'en')]).toEqual([true, false, false]);
    expect(html).not.toContain('value="bilingual"'); // not offered unless it is the stored choice
    expect(checked(html, 'online', '1')).toBe(false);
    for (const label of ['Any', 'Chinese or bilingual', 'English or bilingual', 'Online events only (incl. hybrid)']) {
      expect(form).toMatch(new RegExp(`<label class="[^"]*\\bmin-h-11\\b[^"]*">(?:(?!</label>).)*${label.replace(/[()]/g, '\\$&')}`));
    }
    const zh = prefs('active', undefined, { evLang: 'zh', onlineOnly: true });
    expect([checked(zh, 'ev_lang', ''), checked(zh, 'ev_lang', 'zh')]).toEqual([false, true]);
    expect(checked(zh, 'online', '1')).toBe(true);
    const bi = prefs('paused', undefined, { evLang: 'bilingual', onlineOnly: false });
    expect(checked(bi, 'ev_lang', 'bilingual')).toBe(true);
    expect(bi).toContain('Bilingual only');
    expect(prefs('unsubscribed')).not.toContain('name="ev_lang"');
  });

  it('F20: the going-alerts box sits in the preferences form showing the stored choice, and only when given one', () => {
    const on = prefs('active', undefined, undefined, true);
    const form = on.match(/<form[^>]*>[\s\S]*?<\/form>/g)!.find((f) => f.includes('name="c"'))!;
    expect(form).toContain('<input type="hidden" name="alerts_present" value="1"/>');
    expect(form).toContain('Email me when Victor marks an event as going');
    expect(form).toMatch(/<label class="[^"]*\bmin-h-11\b[^"]*">(?:(?!<\/label>).)*Email me when Victor/);
    expect(checked(on, 'alerts', '1')).toBe(true);
    expect(checked(prefs('pending', undefined, undefined, false), 'alerts', '1')).toBe(false);
    // Alerts off on this deployment: no control at all, so the save can't touch the stored value.
    for (const html of [prefs('active'), prefs('unsubscribed', undefined, undefined, true)]) {
      expect(html).not.toContain('name="alerts"');
      expect(html).not.toContain('alerts_present');
    }
  });

  it('paused rows get Resume; pending rows get no pause section; unsubscribed rows only Subscribe again', () => {
    expect(prefs('paused')).toContain('Resume now');
    expect(prefs('paused')).toContain('name="intent" value="resume"');
    const pending = prefs('pending');
    expect(pending).toContain('Save');
    expect(pending).not.toContain('Take a break');
    expect(pending).toContain('Unsubscribe from everything');
    const gone = prefs('unsubscribed');
    expect(gone).not.toContain('Save');
    expect(gone).not.toContain('Take a break');
    expect(gone).toContain('Subscribe again');
    expect(gone).toContain('name="intent" value="resubscribe"');
  });

  const buttons = (done: boolean, categories: { slug: 'ai' | 'vc'; label: string }[], going?: 'offer' | 'off' | null) =>
    renderToStaticMarkup(
      createElement(UnsubscribeButtons, {
        action: noop, done, categories, going,
        text: {
          all: 'Unsubscribe from everything', done: 'You are unsubscribed.', stopped: {} as Record<Category, string>,
          going: 'Turn off going alerts', alertsOff: 'Going alerts are off.',
        },
        messages: {
          'unsubscribe.done': 'done', 'unsubscribe.alertsOff': 'x', 'prefs.linkExpired': 'x', 'prefs.statusSuppressed': 'x', 'link.unavailable': 'x',
          'state.error': 'x',
        },
      }),
    );
  /** Each form's `c`, and whether its button is the filled (primary) one. */
  const choices = (html: string) =>
    [...html.matchAll(/<form[^>]*>[\s\S]*?<\/form>/g)].map((m) => [/name="c" value="([^"]*)"/.exec(m[0])![1], m[0].includes('bg-ink')]);

  it('the unsubscribe page has one form per category plus everything, and only the confirmation once done', () => {
    const html = buttons(false, [{ slug: 'ai', label: 'Stop AI & Tech' }, { slug: 'vc', label: 'Stop VC & Founders' }]);
    expect(html.match(/<form/g)).toHaveLength(3);
    expect(html).toContain('name="c" value="ai"');
    expect(html).toContain('name="c" value="vc"');
    expect(html).toContain('name="c" value="all"');
    expect(html).toContain('Stop AI &amp; Tech');
    const done = buttons(true, []);
    expect(done).not.toContain('<form');
    expect(done).toContain('You are unsubscribed.');
  });

  it('F20 from an alert: "Turn off going alerts" first and filled, everything second; once off, a note instead', () => {
    expect(choices(buttons(false, [{ slug: 'ai', label: 'Stop AI & Tech' }]))).toEqual([['ai', false], ['all', true]]);
    const offer = buttons(false, [], 'offer');
    expect(choices(offer)).toEqual([['going', true], ['all', false]]);
    expect(offer).toContain('Turn off going alerts');
    expect(offer).not.toContain('Going alerts are off.');
    const off = buttons(false, [], 'off');
    expect(choices(off)).toEqual([['all', true]]);
    expect(off).toMatch(/role="status"[^>]*>Going alerts are off\.</);
    expect(buttons(true, [], 'offer')).not.toContain('<form');
  });
});
