import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clientIp } from '@/lib/client-ip';
import type { DB } from '@/lib/db';
import { alertSends, digestIssues, digestSends, jobsLog, subscribers } from '@/lib/db/schema';
import { EXPIRE_MS } from '@/lib/digest/claim';
import { newId } from '@/lib/ids';
import { subscriberLinks } from '@/lib/subscribers/links';
import {
  cleanCategories, confirmSubscription, deleteSubscriber, disableGoingAlerts, inboxKey, normalizeEmail, PAUSE_MS, PENDING_TTL_MS, pauseSubscription,
  purgeOldUnsubscribed, purgeStalePending, requestSubscription, resubscribe, resumeSubscription, subscriberFromToken, suppressEmails,
  UNSUBSCRIBED_TTL_MS, unsubscribeAll, unsubscribeCategory, updatePreferences, viewOf, type Consent, type SubscribeInput, type Subscriber,
} from '@/lib/subscribers/service';
import { linkToken, tokenId, verifyToken } from '@/lib/subscribers/token';
import { CATEGORY_SLUGS } from '@/lib/taxonomy';
import { testDb } from './helpers/pglite';

// Subscriber links and every state change in service.ts's header diagram (guide「订阅到退订的流程」):
//   pending ──confirm──▶ active ◀──resume── paused, pause, unsubscribe, resubscribe, suppress, purge.

const NOW = new Date('2026-10-04T12:00:00Z');
const DAY = 864e5;
const ago = (ms: number) => new Date(NOW.getTime() - ms);
const TOKEN = /^sub_[0-9a-hjkmnp-tv-z]{16}\.[A-Za-z0-9_-]{43}$/;

let db: DB;
let n = 0;
beforeEach(async () => {
  db = (await testDb()).db as unknown as DB;
  vi.stubEnv('SUBSCRIBER_LINK_SECRET', 'test-secret-subscribers-0123456789');
  vi.stubEnv('PUBLIC_HOST', 'localhost:3100');
});
afterEach(() => vi.unstubAllEnvs());

const opts = (now = NOW) => ({ db, now });
const input = (over: Partial<SubscribeInput> = {}): SubscribeInput => ({
  email: 'reader@example.org', locale: 'en', categories: ['ai', 'vc'], ip: '203.0.113.7', ua: 'vitest', source: 'subscribe', ...over,
});

const PREFS_CONSENT: Consent = { ip: '198.51.100.20', ua: 'Mozilla/5.0 (prefs)', source: 'prefs' };

/** A row in any state, written directly. Defaults to a confirmed, active subscriber. */
async function seed(over: Partial<typeof subscribers.$inferInsert> = {}): Promise<Subscriber> {
  const [row] = await db
    .insert(subscribers)
    .values({
      id: newId('sub'), email: `reader${++n}@example.org`, status: 'active', locale: 'en', categories: ['ai', 'vc'],
      consentAt: ago(10 * DAY), confirmedAt: ago(9 * DAY), createdAt: ago(10 * DAY), ...over,
    })
    .returning();
  return row;
}
const reload = async (id: string) => (await db.select().from(subscribers).where(eq(subscribers.id, id)))[0];

describe('link tokens', () => {
  const sub = { id: 'sub_0123456789abcdef', tokenVersion: 1 };

  it('are <id>.<43 base64url chars>, stable for one id and version', () => {
    const t = linkToken(sub);
    expect(t).toMatch(TOKEN);
    expect(t.startsWith(`${sub.id}.`)).toBe(true);
    expect(linkToken(sub)).toBe(t);
    expect(linkToken({ ...sub, tokenVersion: 2 })).not.toBe(t);
  });

  it('only sign subscriber ids', () => {
    expect(() => linkToken({ id: 'evt_0123456789abcdef', tokenVersion: 1 })).toThrow(/not a subscriber id/);
    expect(() => linkToken({ id: 'sub_short', tokenVersion: 1 })).toThrow();
    // Crockford base32 has no i, l, o or u.
    expect(() => linkToken({ id: 'sub_0123456789abcdei', tokenVersion: 1 })).toThrow();
  });

  it('tokenId reads the id from well-formed tokens only', () => {
    const t = linkToken(sub);
    expect(tokenId(t)).toBe(sub.id);
    for (const bad of [null, undefined, '', 'nope', 'sub_x.y', `${t}x`, ` ${t}`, t.slice(0, -1), `${sub.id}.${'a'.repeat(42)}+`]) {
      expect(tokenId(bad)).toBeNull();
    }
  });

  it('verifyToken accepts only the exact signature for the row and its current version', () => {
    const t = linkToken(sub);
    expect(verifyToken(t, sub)).toBe(true);
    expect(verifyToken(t, { ...sub, tokenVersion: 2 })).toBe(false);
    expect(verifyToken(t, { id: 'sub_fedcba9876543210', tokenVersion: 1 })).toBe(false);
    const sig = t.split('.')[1];
    const flipped = `${sub.id}.${sig[0] === 'A' ? 'B' : 'A'}${sig.slice(1)}`;
    expect(verifyToken(flipped, sub)).toBe(false);
    expect(verifyToken('garbage', sub)).toBe(false);
    vi.stubEnv('SUBSCRIBER_LINK_SECRET', 'another-secret');
    expect(verifyToken(t, sub)).toBe(false);
  });

  it('refuse to sign or verify without SUBSCRIBER_LINK_SECRET', () => {
    const t = linkToken(sub);
    vi.stubEnv('SUBSCRIBER_LINK_SECRET', '');
    expect(() => linkToken(sub)).toThrow(/SUBSCRIBER_LINK_SECRET/);
    expect(() => verifyToken(t, sub)).toThrow(/SUBSCRIBER_LINK_SECRET/);
  });

  it('links carry the token and the subscriber language, never an address', () => {
    const en = subscriberLinks({ ...sub, locale: 'en' });
    const t = linkToken(sub);
    expect(en).toEqual({
      confirm: `http://localhost:3100/confirm/${t}`,
      prefs: `http://localhost:3100/prefs/${t}`,
      unsubscribe: `http://localhost:3100/unsubscribe?t=${t}`,
      oneClick: `http://localhost:3100/api/unsubscribe?t=${t}`,
    });
    const zh = subscriberLinks({ ...sub, locale: 'zh' });
    expect(zh.confirm).toBe(`http://localhost:3100/zh/confirm/${t}`);
    expect(zh.prefs).toBe(`http://localhost:3100/zh/prefs/${t}`);
    expect(zh.unsubscribe).toBe(`http://localhost:3100/zh/unsubscribe?t=${t}`);
    // The RFC 8058 target is one URL for both languages.
    expect(zh.oneClick).toBe(en.oneClick);
  });
});

describe('normalizeEmail and cleanCategories', () => {
  it('trims and lowercases addresses, rejects everything else', () => {
    expect(normalizeEmail('  Reader@Example.ORG ')).toBe('reader@example.org');
    for (const bad of ['', 'nope', 'a@', '@b.c', 'a b@c.d', `${'a'.repeat(250)}@b.co`, null, undefined, 42, ['a@b.c']]) {
      expect(normalizeEmail(bad)).toBeNull();
    }
  });

  it('inboxKey: one limit bucket per inbox, not per spelling', () => {
    // A '+tag' is dropped for every domain.
    expect(inboxKey('victim+1@example.org')).toBe('victim@example.org');
    expect(inboxKey('victim+a+b@example.org')).toBe('victim@example.org');
    expect(inboxKey('victim+@example.org')).toBe('victim@example.org');
    // Gmail ignores dots; googlemail.com is the same mailbox.
    expect(inboxKey('v.ic.tim@gmail.com')).toBe('victim@gmail.com');
    expect(inboxKey('v.ictim+news@gmail.com')).toBe('victim@gmail.com');
    expect(inboxKey('v.ictim@googlemail.com')).toBe('victim@gmail.com');
    expect(inboxKey('victim+x@googlemail.com')).toBe('victim@gmail.com');
    // Dots elsewhere are part of the address.
    expect(inboxKey('first.last@example.org')).toBe('first.last@example.org');
    expect(inboxKey('first.last+tag@example.edu')).toBe('first.last@example.edu');
    expect(inboxKey('plain@example.org')).toBe('plain@example.org');
    // Not an address: passed through unchanged.
    expect(inboxKey('no-at-sign')).toBe('no-at-sign');
    expect(inboxKey('@example.org')).toBe('@example.org');
    // Nothing before the '+': the local part is kept whole rather than emptied.
    expect(inboxKey('+tag@example.org')).toBe('+tag@example.org');
    expect(inboxKey('')).toBe('');
  });

  it('keeps known slugs in canonical order without duplicates', () => {
    expect(cleanCategories(['social', 'ai', 'bogus', 'ai', 7, null, 'VC'])).toEqual(['ai', 'social']);
    expect(cleanCategories([...CATEGORY_SLUGS].reverse())).toEqual([...CATEGORY_SLUGS]);
    expect(cleanCategories([])).toEqual([]);
  });
});

describe('clientIp (consent_ip is inet, so the caller must hand over a valid address or null)', () => {
  it('reads x-real-ip, then the first x-forwarded-for hop', () => {
    expect(clientIp(new Headers({ 'x-real-ip': '203.0.113.7', 'x-forwarded-for': '198.51.100.1' }))).toBe('203.0.113.7');
    expect(clientIp(new Headers({ 'x-forwarded-for': '198.51.100.1, 10.0.0.1' }))).toBe('198.51.100.1');
    expect(clientIp(new Headers({ 'x-real-ip': '::ffff:203.0.113.9' }))).toBe('203.0.113.9');
    expect(clientIp(new Headers({ 'x-real-ip': '2001:db8::1' }))).toBe('2001:db8::1');
  });

  it('returns null for anything that is not an address', () => {
    for (const v of ['unknown', 'not-an-ip', '999.1.1.1', '<script>', '']) expect(clientIp(new Headers({ 'x-real-ip': v }))).toBeNull();
    expect(clientIp(new Headers())).toBeNull();
  });

  it('a null ip is stored as null; a raw invalid string would fail the insert', async () => {
    const ip = clientIp(new Headers({ 'x-forwarded-for': 'garbage' }));
    const r = await requestSubscription(input({ ip }), opts());
    expect(r.kind).toBe('confirm');
    expect((await reload((r as { sub: Subscriber }).sub.id)).consentIp).toBeNull();
    await expect(requestSubscription(input({ email: 'other@example.org', ip: 'garbage' }), opts())).rejects.toThrow();
    const v6 = await requestSubscription(input({ email: 'v6@example.org', ip: '2001:db8::1' }), opts());
    expect((v6 as { sub: Subscriber }).sub.consentIp).toBe('2001:db8::1');
  });
});

describe('requestSubscription', () => {
  it('a new address becomes pending with the consent record', async () => {
    const r = await requestSubscription(input({ locale: 'zh', ua: 'x'.repeat(600), source: `zh/subscribe${'!'.repeat(80)}` }), opts());
    expect(r.kind).toBe('confirm');
    const { sub } = r as { sub: Subscriber };
    expect(sub.id).toMatch(/^sub_[0-9a-hjkmnp-tv-z]{16}$/);
    expect(sub).toMatchObject({
      email: 'reader@example.org', status: 'pending', locale: 'zh', categories: ['ai', 'vc'], tokenVersion: 1,
      consentIp: '203.0.113.7', confirmedAt: null, unsubscribedAt: null, pausedUntil: null,
    });
    expect(sub.consentAt).toEqual(NOW);
    expect(sub.createdAt).toEqual(NOW);
    expect(sub.consentUa).toHaveLength(512);
    expect(sub.consentSource).toHaveLength(64);
    expect(sub.consentSource!.startsWith('zh/subscribe')).toBe(true);
  });

  it('F19: stores the facets on insert (NULL when off) and replaces them on re-arm', async () => {
    const r = (await requestSubscription(input({ facets: { evLang: 'zh', onlineOnly: true } }), opts(ago(DAY)))) as { sub: Subscriber };
    expect(r.sub).toMatchObject({ evLangPref: ['zh'], onlineOnly: true });
    const plain = (await requestSubscription(input({ email: 'plain@example.org' }), opts())) as { sub: Subscriber };
    expect(plain.sub).toMatchObject({ evLangPref: null, onlineOnly: null });
    // Re-armed with the new choices: these facets, or none.
    await requestSubscription(input({ facets: { evLang: 'bilingual', onlineOnly: false } }), opts());
    expect(await reload(r.sub.id)).toMatchObject({ evLangPref: ['bilingual'], onlineOnly: null });
    await requestSubscription(input(), opts());
    expect(await reload(r.sub.id)).toMatchObject({ evLangPref: null, onlineOnly: null });
  });

  it('asking again while pending re-arms the same row with the new choices', async () => {
    const first = (await requestSubscription(input(), opts(ago(2 * DAY)))) as { sub: Subscriber };
    const again = await requestSubscription(input({ locale: 'zh', categories: ['cycling'], ip: null, ua: null, source: 'zh/subscribe' }), opts());
    expect(again.kind).toBe('confirm');
    const row = await reload(first.sub.id);
    expect(row).toMatchObject({ status: 'pending', locale: 'zh', categories: ['cycling'], consentIp: null, consentUa: null, consentSource: 'zh/subscribe' });
    expect(row.consentAt).toEqual(NOW);
    expect(row.createdAt).toEqual(ago(2 * DAY));
    expect(await db.select().from(subscribers)).toHaveLength(1);
  });

  it('addresses are one row regardless of case once normalised', async () => {
    const a = (await requestSubscription(input({ email: normalizeEmail('  Reader@Example.ORG ')! }), opts())) as { sub: Subscriber };
    const b = (await requestSubscription(input({ email: normalizeEmail('READER@example.org')! }), opts())) as { sub: Subscriber };
    expect(b.sub.id).toBe(a.sub.id);
    expect(await db.select().from(subscribers)).toHaveLength(1);
  });

  it('active and paused rows are left alone ("already")', async () => {
    for (const status of ['active', 'paused'] as const) {
      const sub = await seed({ status, pausedUntil: status === 'paused' ? new Date(NOW.getTime() + DAY) : null });
      const r = await requestSubscription(input({ email: sub.email, categories: ['social'], locale: 'zh' }), opts());
      expect(r.kind).toBe('already');
      expect((r as { sub: Subscriber }).sub.id).toBe(sub.id);
      expect(await reload(sub.id)).toEqual(sub);
    }
  });

  it('an unsubscribed row goes back to pending with a fresh consent record, keeping its history', async () => {
    const sub = await seed({ status: 'unsubscribed', unsubscribedAt: ago(DAY) });
    const r = await requestSubscription(input({ email: sub.email, categories: ['hackathon'], ip: '198.51.100.4', ua: 'again' }), opts());
    expect(r.kind).toBe('confirm');
    const row = await reload(sub.id);
    expect(row).toMatchObject({
      status: 'pending', categories: ['hackathon'], pausedUntil: null, consentIp: '198.51.100.4', consentUa: 'again', consentSource: 'subscribe',
    });
    expect(row.consentAt).toEqual(NOW);
    // An unconfirmed re-request must not erase that this address once confirmed and later opted out.
    expect(row.confirmedAt).toEqual(sub.confirmedAt);
    expect(row.unsubscribedAt).toEqual(ago(DAY));
    expect(row.createdAt).toEqual(sub.createdAt);
  });

  it('re-arming a pending row keeps confirmed_at and unsubscribed_at as they were', async () => {
    // A former subscriber who already re-requested once (pending, history intact) asks again.
    const sub = await seed({ status: 'pending', confirmedAt: ago(40 * DAY), unsubscribedAt: ago(20 * DAY), consentAt: ago(2 * DAY) });
    expect((await requestSubscription(input({ email: sub.email, categories: ['vc'] }), opts())).kind).toBe('confirm');
    const row = await reload(sub.id);
    expect(row).toMatchObject({ status: 'pending', categories: ['vc'] });
    expect(row.consentAt).toEqual(NOW);
    expect(row.confirmedAt).toEqual(ago(40 * DAY));
    expect(row.unsubscribedAt).toEqual(ago(20 * DAY));
  });

  it('a suppressed row is never touched or mailed ("none")', async () => {
    const sub = await seed({ status: 'suppressed' });
    expect(await requestSubscription(input({ email: sub.email }), opts())).toEqual({ kind: 'none' });
    expect(await reload(sub.id)).toEqual(sub);
  });
});

describe('subscriberFromToken', () => {
  it('finds the row only for a valid token at the current token_version', async () => {
    const sub = await seed();
    const t = linkToken(sub);
    expect((await subscriberFromToken(t, { db }))?.id).toBe(sub.id);
    for (const bad of [null, undefined, '', 'nope', `${sub.id}.${'A'.repeat(43)}`]) expect(await subscriberFromToken(bad, { db })).toBeNull();
    // Well-formed and correctly signed, but no such row.
    expect(await subscriberFromToken(linkToken({ id: 'sub_0000000000000000', tokenVersion: 1 }), { db })).toBeNull();
    // Bumping token_version voids every link already sent.
    await db.update(subscribers).set({ tokenVersion: 2 }).where(eq(subscribers.id, sub.id));
    expect(await subscriberFromToken(t, { db })).toBeNull();
    expect((await subscriberFromToken(linkToken({ id: sub.id, tokenVersion: 2 }), { db }))?.id).toBe(sub.id);
  });
});

describe('confirmSubscription', () => {
  const pending = (consentAgo = DAY) => seed({ status: 'pending', confirmedAt: null, consentAt: ago(consentAgo) });

  it('pending → active once; repeating it says "already" and changes nothing', async () => {
    const sub = await pending();
    const r = await confirmSubscription(linkToken(sub), opts());
    expect(r.result).toBe('confirmed');
    expect(r.sub).toMatchObject({ id: sub.id, status: 'active' });
    expect(r.sub!.confirmedAt).toEqual(NOW);
    const later = new Date(NOW.getTime() + DAY);
    const again = await confirmSubscription(linkToken(sub), opts(later));
    expect(again.result).toBe('already');
    expect((await reload(sub.id)).confirmedAt).toEqual(NOW);
  });

  it('a double click confirms once', async () => {
    const sub = await pending();
    const t = linkToken(sub);
    const results = await Promise.all([confirmSubscription(t, opts()), confirmSubscription(t, opts())]);
    expect(results.map((r) => r.result).sort()).toEqual(['already', 'confirmed']);
    expect((await reload(sub.id)).status).toBe('active');
  });

  it('paused counts as already confirmed', async () => {
    const sub = await seed({ status: 'paused', pausedUntil: new Date(NOW.getTime() + DAY) });
    expect((await confirmSubscription(linkToken(sub), opts())).result).toBe('already');
    expect((await reload(sub.id)).status).toBe('paused');
  });

  it('a link older than 7 days is expired and leaves the row pending', async () => {
    const stale = await pending(PENDING_TTL_MS + 1);
    expect(await confirmSubscription(linkToken(stale), opts())).toMatchObject({ result: 'expired', sub: { id: stale.id } });
    expect((await reload(stale.id)).status).toBe('pending');
    const edge = await pending(PENDING_TTL_MS);
    expect((await confirmSubscription(linkToken(edge), opts())).result).toBe('expired');
    const fresh = await pending(PENDING_TTL_MS - 60_000);
    expect((await confirmSubscription(linkToken(fresh), opts())).result).toBe('confirmed');
  });

  it('asking again re-arms an expired request: the new email\'s link confirms, the old one no longer does', async () => {
    const stale = await pending(8 * DAY);
    const r = (await requestSubscription(input({ email: stale.email }), opts())) as { sub: Subscriber };
    expect(await confirmSubscription(linkToken(stale), opts())).toEqual({ result: 'invalid', sub: null });
    expect((await confirmSubscription(linkToken(r.sub), opts())).result).toBe('confirmed');
  });

  it('confirming a re-armed former subscriber restamps confirmed_at and keeps the last opt-out time', async () => {
    const sub = await seed({ status: 'unsubscribed', confirmedAt: ago(40 * DAY), unsubscribedAt: ago(20 * DAY) });
    await requestSubscription(input({ email: sub.email, categories: ['social'] }), opts(ago(DAY)));
    const r = await confirmSubscription(linkToken(sub), opts());
    expect(r.result).toBe('confirmed');
    const row = await reload(sub.id);
    expect(row).toMatchObject({ status: 'active', categories: ['social'], unsubscribedAt: ago(20 * DAY) });
    expect(row.confirmedAt).toEqual(NOW);
  });

  it('an unsubscribed row is expired: an old confirm link never re-subscribes anyone', async () => {
    const sub = await seed({ status: 'unsubscribed', unsubscribedAt: ago(DAY) });
    expect((await confirmSubscription(linkToken(sub), opts())).result).toBe('expired');
    expect((await reload(sub.id)).status).toBe('unsubscribed');
  });

  it('suppressed rows and bad tokens are invalid', async () => {
    const sub = await seed({ status: 'suppressed' });
    expect(await confirmSubscription(linkToken(sub), opts())).toEqual({ result: 'invalid', sub: null });
    expect((await reload(sub.id)).status).toBe('suppressed');
    const p = await pending();
    expect(await confirmSubscription(`${p.id}.${'A'.repeat(43)}`, opts())).toEqual({ result: 'invalid', sub: null });
    expect(await confirmSubscription('nope', opts())).toEqual({ result: 'invalid', sub: null });
    expect((await reload(p.id)).status).toBe('pending');
  });
});

describe('preferences, pause and resume', () => {
  it('updatePreferences changes language and categories for pending, active and paused rows', async () => {
    for (const status of ['pending', 'active', 'paused'] as const) {
      const sub = await seed({ status, pausedUntil: status === 'paused' ? new Date(NOW.getTime() + DAY) : null });
      const row = await updatePreferences(sub, { locale: 'zh', categories: ['campus', 'social'] }, opts());
      expect(row).toMatchObject({ status, locale: 'zh', categories: ['campus', 'social'] });
      expect(await reload(sub.id)).toEqual(row);
    }
  });

  it('F19: updatePreferences writes facets when given, and leaves them alone when not', async () => {
    const sub = await seed({ evLangPref: ['en'], onlineOnly: true });
    const kept = await updatePreferences(sub, { locale: 'zh', categories: ['ai'] }, opts());
    expect(kept).toMatchObject({ locale: 'zh', evLangPref: ['en'], onlineOnly: true });
    const set = await updatePreferences(kept, { locale: 'zh', categories: ['ai'], facets: { evLang: 'zh', onlineOnly: false } }, opts());
    expect(set).toMatchObject({ evLangPref: ['zh'], onlineOnly: null });
    const cleared = await updatePreferences(set, { locale: 'zh', categories: ['ai'], facets: { evLang: null, onlineOnly: false } }, opts());
    expect(cleared).toMatchObject({ evLangPref: null, onlineOnly: null });
    expect(await reload(sub.id)).toEqual(cleared);
  });

  it('updatePreferences with no category unsubscribes', async () => {
    const sub = await seed();
    const row = await updatePreferences(sub, { locale: 'zh', categories: [] }, opts());
    expect(row).toMatchObject({ status: 'unsubscribed', categories: ['ai', 'vc'] });
    expect(row.unsubscribedAt).toEqual(NOW);
  });

  it('updatePreferences leaves unsubscribed and suppressed rows alone', async () => {
    for (const status of ['unsubscribed', 'suppressed'] as const) {
      const sub = await seed({ status });
      expect(await updatePreferences(sub, { locale: 'zh', categories: ['cycling'] }, opts())).toEqual(sub);
      expect(await reload(sub.id)).toEqual(sub);
    }
  });

  it('active → paused for 28 days; pausing again restarts the 28 days', async () => {
    const sub = await seed();
    const row = await pauseSubscription(sub, opts());
    expect(row.status).toBe('paused');
    expect(row.pausedUntil).toEqual(new Date(NOW.getTime() + PAUSE_MS));
    const later = new Date(NOW.getTime() + 3 * DAY);
    expect((await pauseSubscription(row, opts(later))).pausedUntil).toEqual(new Date(later.getTime() + PAUSE_MS));
  });

  it('pending, unsubscribed and suppressed rows cannot be paused', async () => {
    for (const status of ['pending', 'unsubscribed', 'suppressed'] as const) {
      const sub = await seed({ status });
      expect(await pauseSubscription(sub, opts())).toEqual(sub);
      expect(await reload(sub.id)).toEqual(sub);
    }
  });

  it('paused → active clears paused_until; resuming an active row changes nothing', async () => {
    const sub = await seed({ status: 'paused', pausedUntil: new Date(NOW.getTime() + DAY) });
    expect(await resumeSubscription(sub, opts())).toMatchObject({ status: 'active', pausedUntil: null });
    const active = await reload(sub.id);
    expect(await resumeSubscription(active, opts())).toEqual(active);
    const unsub = await seed({ status: 'unsubscribed' });
    expect(await resumeSubscription(unsub, opts())).toEqual(unsub);
    expect((await reload(unsub.id)).status).toBe('unsubscribed');
  });
});

describe('unsubscribe and resubscribe', () => {
  it('pending, active and paused → unsubscribed; repeating it changes nothing', async () => {
    for (const status of ['pending', 'active', 'paused'] as const) {
      const sub = await seed({ status, pausedUntil: status === 'paused' ? new Date(NOW.getTime() + DAY) : null });
      const row = await unsubscribeAll(sub, opts());
      expect(row).toMatchObject({ status: 'unsubscribed', pausedUntil: null, categories: ['ai', 'vc'] });
      expect(row.unsubscribedAt).toEqual(NOW);
      // A second one-click a day later (stale object, as a retried request would have).
      await unsubscribeAll(sub, opts(new Date(NOW.getTime() + DAY)));
      expect((await reload(sub.id)).unsubscribedAt).toEqual(NOW);
    }
  });

  it('a suppressed row stays suppressed', async () => {
    const sub = await seed({ status: 'suppressed' });
    expect(await unsubscribeAll(sub, opts())).toEqual(sub);
    expect((await reload(sub.id)).status).toBe('suppressed');
  });

  it('unsubscribeCategory drops one category; the last one unsubscribes and is kept', async () => {
    const sub = await seed({ categories: ['ai', 'vc'] });
    const one = await unsubscribeCategory(sub, 'vc', opts());
    expect(one).toMatchObject({ status: 'active', categories: ['ai'] });
    // Not subscribed to it: nothing to do.
    expect(await unsubscribeCategory(one, 'cycling', opts())).toEqual(one);
    const none = await unsubscribeCategory(one, 'ai', opts());
    expect(none).toMatchObject({ status: 'unsubscribed', categories: ['ai'] });
    expect(none.unsubscribedAt).toEqual(NOW);
  });

  it('unsubscribeCategory from two tabs at once (same stale row): never active with a stopped category', async () => {
    // Both requests read the row before either wrote; each drops one of the two categories.
    const both = await seed({ categories: ['ai', 'vc'] });
    await Promise.all([unsubscribeCategory(both, 'ai', opts()), unsubscribeCategory(both, 'vc', opts())]);
    const a = await reload(both.id);
    expect(a.status).toBe('unsubscribed');
    expect(a.unsubscribedAt).toEqual(NOW);
    expect(a.categories).toHaveLength(1); // the last one is kept for "Subscribe again"
    expect(['ai', 'vc']).toContain(a.categories[0]);

    // Three categories, two stopped at once: the third is all that is left, still active.
    const three = await seed({ categories: ['ai', 'vc', 'social'] });
    await Promise.all([unsubscribeCategory(three, 'ai', opts()), unsubscribeCategory(three, 'vc', opts())]);
    expect(await reload(three.id)).toMatchObject({ status: 'active', categories: ['social'], unsubscribedAt: null });

    // A paused row keeps its pause while categories remain.
    const until = new Date(NOW.getTime() + DAY);
    const paused = await seed({ status: 'paused', pausedUntil: until, categories: ['ai', 'vc', 'campus'] });
    await Promise.all([unsubscribeCategory(paused, 'campus', opts()), unsubscribeCategory(paused, 'ai', opts())]);
    expect(await reload(paused.id)).toMatchObject({ status: 'paused', pausedUntil: until, categories: ['vc'] });
  });

  it('unsubscribeCategory from a stale row after an unsubscribe elsewhere changes nothing', async () => {
    const sub = await seed({ categories: ['ai', 'vc'] });
    await unsubscribeAll(sub, opts(ago(DAY)));
    const gone = await reload(sub.id);
    expect(await unsubscribeCategory(sub, 'vc', opts())).toEqual(sub);
    expect(await reload(sub.id)).toEqual(gone);
  });

  it('unsubscribeCategory changes nothing on an unsubscribed row', async () => {
    const sub = await seed({ status: 'unsubscribed', categories: ['ai', 'vc'] });
    await unsubscribeCategory(sub, 'vc', opts());
    expect(await reload(sub.id)).toEqual(sub);
  });

  it('unsubscribed → active when the address was confirmed before, with a new consent record', async () => {
    const sub = await seed({
      status: 'unsubscribed', unsubscribedAt: ago(DAY), categories: ['vc'], consentIp: '203.0.113.7', consentUa: 'old', consentSource: 'subscribe',
    });
    const r = await resubscribe(sub, PREFS_CONSENT, opts());
    expect(r.needsConfirm).toBe(false);
    expect(r.sub).toMatchObject({
      status: 'active', categories: ['vc'], consentIp: '198.51.100.20', consentUa: 'Mozilla/5.0 (prefs)', consentSource: 'prefs',
    });
    expect(r.sub.consentAt).toEqual(NOW);
    // The opt-out that came before stays on the row; confirmed_at is the original confirmation.
    expect(r.sub.unsubscribedAt).toEqual(ago(DAY));
    expect(r.sub.confirmedAt).toEqual(sub.confirmedAt);
    expect(await reload(sub.id)).toEqual(r.sub);
  });

  it('unsubscribed → pending (with a fresh 7 days) when it never confirmed', async () => {
    const sub = await seed({ status: 'unsubscribed', confirmedAt: null, unsubscribedAt: ago(DAY), consentAt: ago(30 * DAY) });
    const r = await resubscribe(sub, PREFS_CONSENT, opts());
    expect(r.needsConfirm).toBe(true);
    expect(r.sub).toMatchObject({ status: 'pending', consentIp: '198.51.100.20', consentUa: 'Mozilla/5.0 (prefs)', consentSource: 'prefs' });
    expect(r.sub.unsubscribedAt).toEqual(ago(DAY));
    expect(r.sub.consentAt).toEqual(NOW);
    expect((await confirmSubscription(linkToken(sub), opts())).result).toBe('confirmed');
    expect((await reload(sub.id)).status).toBe('active'); // unsubscribed_at stays as the last opt-out time
  });

  it('resubscribe stores a missing IP and user agent as null, and caps the user agent and source', async () => {
    const sub = await seed({ status: 'unsubscribed', unsubscribedAt: ago(DAY), consentIp: '203.0.113.7', consentUa: 'old' });
    const r = await resubscribe(sub, { ip: null, ua: null, source: 'prefs' }, opts());
    expect(r.sub).toMatchObject({ status: 'active', consentIp: null, consentUa: null, consentSource: 'prefs' });
    const long = await seed({ status: 'unsubscribed', unsubscribedAt: ago(DAY) });
    const l = await resubscribe(long, { ip: '2001:db8::1', ua: 'u'.repeat(600), source: 's'.repeat(80) }, opts());
    expect(l.sub.consentIp).toBe('2001:db8::1');
    expect(l.sub.consentUa).toHaveLength(512);
    expect(l.sub.consentSource).toHaveLength(64);
  });

  it('a row with no categories left comes back with all of them', async () => {
    const sub = await seed({ status: 'unsubscribed', categories: [] });
    expect((await resubscribe(sub, PREFS_CONSENT, opts())).sub.categories).toEqual([...CATEGORY_SLUGS]);
  });

  it('only unsubscribed rows can resubscribe; nothing (consent included) changes otherwise', async () => {
    for (const status of ['pending', 'active', 'paused', 'suppressed'] as const) {
      const sub = await seed({ status, confirmedAt: status === 'pending' ? null : ago(DAY) });
      expect(await resubscribe(sub, PREFS_CONSENT, opts())).toEqual({ sub, needsConfirm: false });
      expect(await reload(sub.id)).toEqual(sub);
    }
  });
});

describe('suppressEmails', () => {
  it('any state → suppressed, matched on the normalised address', async () => {
    const rows = await Promise.all(
      (['pending', 'active', 'paused', 'unsubscribed'] as const).map((status) =>
        seed({ status, pausedUntil: status === 'paused' ? new Date(NOW.getTime() + DAY) : null }),
      ),
    );
    const count = await suppressEmails(
      rows.map((r, i) => (i % 2 ? `  ${r.email.toUpperCase()} ` : r.email)).concat(['not-an-address', 'nobody@example.org', rows[0].email]),
      opts(),
    );
    expect(count).toBe(4);
    for (const r of rows) expect(await reload(r.id)).toMatchObject({ status: 'suppressed', pausedUntil: null });
  });

  it('is idempotent and counts only rows it changed', async () => {
    const sub = await seed();
    expect(await suppressEmails([sub.email], opts())).toBe(1);
    expect(await suppressEmails([sub.email], opts())).toBe(0);
    expect(await suppressEmails([], opts())).toBe(0);
    expect(await suppressEmails(['bad'], opts())).toBe(0);
  });

  it('suppressed is terminal: no form, confirm, pause or resubscribe brings it back', async () => {
    const sub = await seed({ status: 'pending', confirmedAt: null, consentAt: ago(DAY) });
    await suppressEmails([sub.email], opts());
    const row = await reload(sub.id);
    expect((await requestSubscription(input({ email: sub.email }), opts())).kind).toBe('none');
    expect((await confirmSubscription(linkToken(sub), opts())).result).toBe('invalid');
    await pauseSubscription(row, opts());
    await resubscribe(row, PREFS_CONSENT, opts());
    await updatePreferences(row, { locale: 'zh', categories: ['ai'] }, opts());
    expect(await reload(sub.id)).toEqual(row);
  });
});

describe('purgeStalePending', () => {
  const ids = async () => (await db.select({ id: subscribers.id }).from(subscribers)).map((r) => r.id).sort();
  let week = 0;
  /** A digest issue that went to these subscribers (digest_sends references subscribers.id). */
  async function mailed(...subs: Subscriber[]) {
    const [issue] = await db
      .insert(digestIssues)
      .values({ id: newId('dig'), isoWeek: `2026-W${String(30 + ++week).padStart(2, '0')}`, status: 'sent', sentAt: ago(30 * DAY) })
      .returning();
    await db.insert(digestSends).values(subs.map((s) => ({ issueId: issue.id, subscriberId: s.id, variantKey: 'en:ai', sentAt: ago(30 * DAY) })));
  }

  it('deletes only sign-ups unconfirmed for more than 7 days', async () => {
    const stale = await seed({ status: 'pending', confirmedAt: null, consentAt: ago(PENDING_TTL_MS + 1) });
    const veryStale = await seed({ status: 'pending', confirmedAt: null, consentAt: ago(30 * DAY) });
    const edge = await seed({ status: 'pending', confirmedAt: null, consentAt: ago(PENDING_TTL_MS) });
    const fresh = await seed({ status: 'pending', confirmedAt: null, consentAt: ago(DAY) });
    const kept = await Promise.all(
      (['active', 'paused', 'unsubscribed', 'suppressed'] as const).map((status) => seed({ status, consentAt: ago(60 * DAY) })),
    );
    expect(await purgeStalePending(opts())).toEqual({ deleted: 2, reverted: 0 });
    const left = await ids();
    expect(left).toEqual([edge.id, fresh.id, ...kept.map((r) => r.id)].sort());
    expect(left).not.toContain(stale.id);
    expect(left).not.toContain(veryStale.id);
    expect(await purgeStalePending(opts())).toEqual({ deleted: 0, reverted: 0 });
  });

  it('a former subscriber whose re-request went unconfirmed goes back to unsubscribed, digest history intact', async () => {
    // Confirmed, got a digest, unsubscribed, then asked again through the form and never clicked.
    const former = await seed({ status: 'unsubscribed', confirmedAt: ago(60 * DAY), unsubscribedAt: ago(20 * DAY), categories: ['ai'] });
    await mailed(former);
    await requestSubscription(input({ email: former.email, categories: ['vc'] }), opts(ago(8 * DAY)));
    expect((await reload(former.id)).status).toBe('pending');
    // A stranger's sign-up that went stale in the same window: the old single DELETE hit the
    // digest_sends foreign key on the row above and took this one down with it.
    const stranger = await seed({ status: 'pending', confirmedAt: null, consentAt: ago(9 * DAY) });

    expect(await purgeStalePending(opts())).toEqual({ deleted: 1, reverted: 1 });
    const row = await reload(former.id);
    expect(row).toMatchObject({ status: 'unsubscribed', categories: ['vc'] });
    expect(row.confirmedAt).toEqual(ago(60 * DAY));
    expect(row.unsubscribedAt).toEqual(ago(20 * DAY)); // the original opt-out, not the purge time
    expect(await db.select().from(digestSends).where(eq(digestSends.subscriberId, former.id))).toHaveLength(1);
    expect(await reload(stranger.id)).toBeUndefined();
    // Idempotent: nothing left to do.
    expect(await purgeStalePending(opts())).toEqual({ deleted: 0, reverted: 0 });
    expect((await reload(former.id)).status).toBe('unsubscribed');
  });

  it('a stale confirmed row with no opt-out on record is stamped unsubscribed now', async () => {
    const legacy = await seed({ status: 'pending', confirmedAt: ago(60 * DAY), unsubscribedAt: null, consentAt: ago(10 * DAY) });
    expect(await purgeStalePending(opts())).toEqual({ deleted: 0, reverted: 1 });
    const row = await reload(legacy.id);
    expect(row.status).toBe('unsubscribed');
    expect(row.unsubscribedAt).toEqual(NOW);
  });

  it('leaves fresh pending rows alone, re-armed former subscribers included', async () => {
    const former = await seed({ status: 'unsubscribed', confirmedAt: ago(60 * DAY), unsubscribedAt: ago(20 * DAY) });
    await mailed(former);
    await requestSubscription(input({ email: former.email }), opts(ago(2 * DAY)));
    const edge = await seed({ status: 'pending', confirmedAt: ago(60 * DAY), unsubscribedAt: ago(20 * DAY), consentAt: ago(PENDING_TTL_MS) });
    const fresh = await seed({ status: 'pending', confirmedAt: null, consentAt: ago(DAY) });
    const before = await Promise.all([former, edge, fresh].map((r) => reload(r.id)));
    expect(await purgeStalePending(opts())).toEqual({ deleted: 0, reverted: 0 });
    expect(await Promise.all([former, edge, fresh].map((r) => reload(r.id)))).toEqual(before);
  });

  it('a never-confirmed stale row that somehow has digest_sends is left alone, without throwing', async () => {
    const odd = await seed({ status: 'pending', confirmedAt: null, consentAt: ago(10 * DAY) });
    await mailed(odd);
    const stranger = await seed({ status: 'pending', confirmedAt: null, consentAt: ago(10 * DAY) });
    expect(await purgeStalePending(opts())).toEqual({ deleted: 1, reverted: 0 });
    expect(await reload(odd.id)).toMatchObject({ status: 'pending', confirmedAt: null });
    expect(await reload(stranger.id)).toBeUndefined();
    expect(await purgeStalePending(opts())).toEqual({ deleted: 0, reverted: 0 });
  });
});

describe('viewOf', () => {
  it('never carries the address; categories are cleaned and dates are ISO', async () => {
    const until = new Date(NOW.getTime() + PAUSE_MS);
    const sub = await seed({ status: 'paused', locale: 'zh', categories: ['vc', 'bogus', 'ai'], pausedUntil: until });
    const view = viewOf(sub);
    expect(view).toEqual({
      status: 'paused', locale: 'zh', categories: ['ai', 'vc'], evLang: null, onlineOnly: false, goingAlerts: false, pausedUntil: until.toISOString(),
    });
    expect(JSON.stringify(view)).not.toContain('@');
    expect(viewOf(await seed()).pausedUntil).toBeNull();
    // F19: facets as the digest reads them; a malformed stored value is no preference.
    expect(viewOf(await seed({ evLangPref: ['zh'], onlineOnly: true }))).toMatchObject({ evLang: 'zh', onlineOnly: true });
    expect(viewOf(await seed({ evLangPref: ['zh', 'en'], onlineOnly: false }))).toMatchObject({ evLang: null, onlineOnly: false });
    // F20: the going-alerts choice, never when it was made.
    const alerts = viewOf(await seed({ goingAlerts: true, goingAlertsSince: ago(DAY) }));
    expect(alerts.goingAlerts).toBe(true);
    expect(JSON.stringify(alerts)).not.toContain(ago(DAY).toISOString());
  });
});

// ---- week 15: admin Delete (DESIGN D2) and retention (D3) ---------------------------------------

let issueWeek = 0;
const HOUR = 3600_000;
/**
 * A digest_sends row for `sub` in a new sent issue; `inFlight` leaves it claimed but unresolved
 * (an hour ago by default: young enough to still be sent, see EXPIRE_MS).
 */
async function sendRow(sub: Subscriber, state: 'sent' | 'failed' | 'inFlight' = 'sent', claimedAt = ago(state === 'inFlight' ? HOUR : DAY)) {
  const [issue] = await db
    .insert(digestIssues)
    .values({ id: newId('dig'), isoWeek: `2025-W${String(10 + ++issueWeek).padStart(2, '0')}`, status: state === 'inFlight' ? 'sending' : 'sent' })
    .returning();
  await db.insert(digestSends).values({
    issueId: issue.id, subscriberId: sub.id, variantKey: 'en:ai', claimedAt,
    resendId: state === 'sent' ? 're_1' : null, sentAt: state === 'sent' ? ago(DAY) : null, error: state === 'failed' ? 'failed:bounced' : null,
  });
  return issue;
}
const sendsOf = async (id: string) => db.select().from(digestSends).where(eq(digestSends.subscriberId, id));
const audits = async (job: string) => db.select().from(jobsLog).where(eq(jobsLog.job, job));

describe('deleteSubscriber', () => {
  it('deletes the row and its send history in one statement, with an id-only audit row', async () => {
    const sub = await seed({ consentIp: '203.0.113.9', consentUa: 'Mozilla/5.0 (audit)' });
    const other = await seed();
    await sendRow(sub, 'sent');
    await sendRow(sub, 'failed');
    await sendRow(other, 'sent');
    expect(await deleteSubscriber(sub.id, opts())).toEqual({ result: 'deleted', sends: 2 });
    expect(await reload(sub.id)).toBeUndefined();
    expect(await sendsOf(sub.id)).toEqual([]);
    expect(await sendsOf(other.id)).toHaveLength(1);
    expect(await reload(other.id)).toBeDefined();
    const [audit, ...more] = await audits('admin_delete');
    expect(more).toEqual([]);
    expect(audit).toMatchObject({ ok: true, detail: { id: sub.id }, startedAt: NOW, finishedAt: NOW });
    expect(JSON.stringify(audit)).not.toMatch(/@|203\.0\.113\.9|Mozilla/);
    // Idempotent: the second press finds nothing and writes no second audit row.
    expect(await deleteSubscriber(sub.id, opts())).toEqual({ result: 'not_found', sends: 0 });
    expect(await audits('admin_delete')).toHaveLength(1);
  });

  it('passes the NO ACTION foreign key only because both deletes share one statement', async () => {
    const sub = await seed();
    await sendRow(sub);
    // A plain DELETE still trips the foreign key: the constraint is there and enforced.
    await expect(db.delete(subscribers).where(eq(subscribers.id, sub.id))).rejects.toMatchObject({ cause: { code: '23503' } });
    expect(await deleteSubscriber(sub.id, opts())).toEqual({ result: 'deleted', sends: 1 });
  });

  it('a subscriber with no history is deleted too', async () => {
    const sub = await seed({ status: 'pending', confirmedAt: null });
    expect(await deleteSubscriber(sub.id, opts())).toEqual({ result: 'deleted', sends: 0 });
    expect(await reload(sub.id)).toBeUndefined();
  });

  it('is refused while a claim is in flight, and works once the send resolves', async () => {
    const sub = await seed();
    await sendRow(sub, 'sent');
    const issue = await sendRow(sub, 'inFlight');
    expect(await deleteSubscriber(sub.id, opts())).toEqual({ result: 'in_flight', sends: 0 });
    expect(await reload(sub.id)).toBeDefined();
    expect(await sendsOf(sub.id)).toHaveLength(2);
    expect(await audits('admin_delete')).toEqual([]);
    await db.update(digestSends).set({ resendId: 're_2', sentAt: NOW }).where(eq(digestSends.issueId, issue.id));
    expect(await deleteSubscriber(sub.id, opts())).toEqual({ result: 'deleted', sends: 2 });
  });

  it('a suppressed row needs allowSuppressed: deleting it drops the do-not-send block', async () => {
    const sub = await seed({ status: 'suppressed' });
    await sendRow(sub);
    expect(await deleteSubscriber(sub.id, opts())).toEqual({ result: 'suppressed', sends: 0 });
    expect(await reload(sub.id)).toMatchObject({ status: 'suppressed' });
    expect(await deleteSubscriber(sub.id, { ...opts(), allowSuppressed: true })).toEqual({ result: 'deleted', sends: 1 });
    expect(await reload(sub.id)).toBeUndefined();
  });

  it('in flight wins over suppressed, so the message is the one that can be acted on', async () => {
    const sub = await seed({ status: 'suppressed' });
    await sendRow(sub, 'inFlight');
    expect((await deleteSubscriber(sub.id, opts())).result).toBe('in_flight');
    expect((await deleteSubscriber(sub.id, { ...opts(), allowSuppressed: true })).result).toBe('in_flight');
  });

  it('unknown or malformed ids touch nothing', async () => {
    const sub = await seed();
    for (const id of ['sub_0000000000000000', 'nope', sub.email, `${sub.id}' or '1'='1`]) {
      expect(await deleteSubscriber(id, opts())).toEqual({ result: 'not_found', sends: 0 });
    }
    expect(await reload(sub.id)).toBeDefined();
  });

  it('a claim that lands mid-statement (foreign key violation) reads as in flight', async () => {
    const sub = await seed();
    const fk = Object.assign(new Error('Failed query'), { cause: Object.assign(new Error('violates foreign key constraint'), { code: '23503' }) });
    const racing = new Proxy(db, { get: (t, p) => (p === 'execute' ? async () => { throw fk; } : Reflect.get(t, p)) });
    expect(await deleteSubscriber(sub.id, { db: racing, now: NOW })).toEqual({ result: 'in_flight', sends: 0 });
    const other = Object.assign(new Error('boom'), { code: '57014' });
    const failing = new Proxy(db, { get: (t, p) => (p === 'execute' ? async () => { throw other; } : Reflect.get(t, p)) });
    await expect(deleteSubscriber(sub.id, { db: failing, now: NOW })).rejects.toBe(other);
  });
});

describe('purgeOldUnsubscribed', () => {
  it('deletes rows unsubscribed more than 365 days ago with their history; the boundary row stays', async () => {
    const old = await seed({ status: 'unsubscribed', unsubscribedAt: ago(UNSUBSCRIBED_TTL_MS + 1) });
    const ancient = await seed({ status: 'unsubscribed', unsubscribedAt: ago(3 * UNSUBSCRIBED_TTL_MS), confirmedAt: null });
    const edge = await seed({ status: 'unsubscribed', unsubscribedAt: ago(UNSUBSCRIBED_TTL_MS) });
    const recent = await seed({ status: 'unsubscribed', unsubscribedAt: ago(30 * DAY) });
    await sendRow(old);
    await sendRow(old, 'failed');
    await sendRow(edge);
    expect(await purgeOldUnsubscribed(opts())).toEqual({ deleted: 2 });
    expect(await reload(old.id)).toBeUndefined();
    expect(await reload(ancient.id)).toBeUndefined();
    expect(await sendsOf(old.id)).toEqual([]);
    expect(await reload(edge.id)).toBeDefined();
    expect(await sendsOf(edge.id)).toHaveLength(1);
    expect(await reload(recent.id)).toBeDefined();
    expect(await purgeOldUnsubscribed(opts())).toEqual({ deleted: 0 });
  });

  it('keeps suppressed rows (the do-not-send list) and everyone subscribed now, however old the opt-out', async () => {
    const longAgo = ago(2 * UNSUBSCRIBED_TTL_MS);
    const kept = await Promise.all(
      (['suppressed', 'active', 'paused', 'pending'] as const).map((status) => seed({ status, unsubscribedAt: longAgo })),
    );
    const never = await seed({ status: 'unsubscribed', unsubscribedAt: null }); // legacy row with no date: not provably old
    await sendRow(kept[0]);
    expect(await purgeOldUnsubscribed(opts())).toEqual({ deleted: 0 });
    for (const r of [...kept, never]) expect(await reload(r.id)).toBeDefined();
    expect(await sendsOf(kept[0].id)).toHaveLength(1);
  });

  it('a row with a claim in flight waits for the next run, and does not block the others', async () => {
    const busy = await seed({ status: 'unsubscribed', unsubscribedAt: ago(UNSUBSCRIBED_TTL_MS + DAY) });
    const idle = await seed({ status: 'unsubscribed', unsubscribedAt: ago(UNSUBSCRIBED_TTL_MS + DAY) });
    const issue = await sendRow(busy, 'inFlight');
    expect(await purgeOldUnsubscribed(opts())).toEqual({ deleted: 1 });
    expect(await reload(busy.id)).toBeDefined();
    expect(await reload(idle.id)).toBeUndefined();
    await db.update(digestSends).set({ error: 'ineligible' }).where(eq(digestSends.issueId, issue.id));
    expect(await purgeOldUnsubscribed(opts())).toEqual({ deleted: 1 });
    expect(await reload(busy.id)).toBeUndefined();
  });
});

// ---- F20 going alerts: the opt-in, its start time, and the send history it leaves ----------------

/** going_alerts and going_alerts_since as stored. */
const alertsOf = async (id: string) => {
  const row = await reload(id);
  return { on: row.goingAlerts, since: row.goingAlertsSince };
};

describe('going alerts: requestSubscription', () => {
  it('a new row stores the checkbox, stamped now when ticked; unticked or not shown is off with no time', async () => {
    const on = (await requestSubscription(input({ goingAlerts: true }), opts())) as { sub: Subscriber };
    expect(await alertsOf(on.sub.id)).toEqual({ on: true, since: NOW });
    const off = (await requestSubscription(input({ email: 'off@example.org', goingAlerts: false }), opts())) as { sub: Subscriber };
    expect(await alertsOf(off.sub.id)).toEqual({ on: false, since: null });
    const hidden = (await requestSubscription(input({ email: 'hidden@example.org' }), opts())) as { sub: Subscriber };
    expect(await alertsOf(hidden.sub.id)).toEqual({ on: false, since: null });
  });

  it('a re-request is a new opt-in: ticked restarts the clock, unticked turns alerts off', async () => {
    const sub = await seed({ status: 'unsubscribed', unsubscribedAt: ago(5 * DAY), goingAlerts: true, goingAlertsSince: ago(90 * DAY) });
    await requestSubscription(input({ email: sub.email, goingAlerts: true }), opts());
    expect(await alertsOf(sub.id)).toEqual({ on: true, since: NOW });
    await requestSubscription(input({ email: sub.email, goingAlerts: false }), opts(new Date(NOW.getTime() + 60_000)));
    expect(await alertsOf(sub.id)).toEqual({ on: false, since: null });
  });

  it('without the checkbox (alerts off here) a re-request keeps the stored choice, restarted from now', async () => {
    const on = await seed({ status: 'pending', confirmedAt: null, consentAt: ago(2 * DAY), goingAlerts: true, goingAlertsSince: ago(2 * DAY) });
    await requestSubscription(input({ email: on.email, categories: ['vc'] }), opts());
    expect(await reload(on.id)).toMatchObject({ categories: ['vc'], goingAlerts: true, goingAlertsSince: NOW });
    const off = await seed({ status: 'unsubscribed', unsubscribedAt: ago(DAY) });
    await requestSubscription(input({ email: off.email }), opts());
    expect(await alertsOf(off.id)).toEqual({ on: false, since: null });
  });

  it('a re-request on a still-pending row voids the earlier confirm link: it cannot confirm choices its email never described', async () => {
    // Someone who knows the address asks again with alerts ticked; the owner then clicks the first email's link.
    const first = (await requestSubscription(input({ goingAlerts: false }), opts(ago(DAY)))) as { sub: Subscriber };
    const again = (await requestSubscription(input({ categories: ['vc'], goingAlerts: true }), opts())) as { sub: Subscriber };
    expect(again.sub.id).toBe(first.sub.id);
    expect(again.sub.tokenVersion).toBe(first.sub.tokenVersion + 1);
    expect(await confirmSubscription(linkToken(first.sub), opts())).toEqual({ result: 'invalid', sub: null });
    expect(await reload(first.sub.id)).toMatchObject({ status: 'pending', confirmedAt: null });
    // The new email's link (built from the returned row) confirms what that email described.
    expect((await confirmSubscription(linkToken(again.sub), opts())).sub).toMatchObject({
      status: 'active', categories: ['vc'], goingAlerts: true, goingAlertsSince: NOW,
    });
  });

  it('re-arming an unsubscribed row keeps token_version, so the links in its past emails keep working', async () => {
    const sub = await seed({ status: 'unsubscribed', unsubscribedAt: ago(DAY) });
    const r = (await requestSubscription(input({ email: sub.email }), opts())) as { sub: Subscriber };
    expect(r.sub.tokenVersion).toBe(sub.tokenVersion);
    expect(await subscriberFromToken(linkToken(sub), { db })).toMatchObject({ id: sub.id, status: 'pending' });
    // Asking again while that request is pending re-arms a pending row: now the version moves on.
    const again = (await requestSubscription(input({ email: sub.email }), opts())) as { sub: Subscriber };
    expect(again.sub.tokenVersion).toBe(sub.tokenVersion + 1);
  });

  it('active, paused and suppressed rows keep their alerts whatever the form says', async () => {
    for (const status of ['active', 'paused', 'suppressed'] as const) {
      const sub = await seed({ status, goingAlerts: false, pausedUntil: status === 'paused' ? new Date(NOW.getTime() + DAY) : null });
      await requestSubscription(input({ email: sub.email, goingAlerts: true }), opts());
      expect(await reload(sub.id)).toEqual(sub);
    }
  });
});

describe('going alerts: updatePreferences', () => {
  const prefs = { locale: 'en' as const, categories: ['ai' as const] };

  it('off → on stamps now; saving again with them on keeps the first time, even from a stale row', async () => {
    const sub = await seed();
    const on = await updatePreferences(sub, { ...prefs, goingAlerts: true }, opts());
    expect(on).toMatchObject({ goingAlerts: true, goingAlertsSince: NOW });
    const later = new Date(NOW.getTime() + 3 * DAY);
    // `sub` still says off: the statement reads the row as it is now, so the start doesn't move.
    await updatePreferences(sub, { ...prefs, goingAlerts: true }, opts(later));
    expect(await alertsOf(sub.id)).toEqual({ on: true, since: NOW });
  });

  it('on → off clears the time; switching on again starts over', async () => {
    const sub = await seed({ goingAlerts: true, goingAlertsSince: ago(30 * DAY) });
    expect(await updatePreferences(sub, { ...prefs, goingAlerts: false }, opts())).toMatchObject({ goingAlerts: false, goingAlertsSince: null });
    await updatePreferences(sub, { ...prefs, goingAlerts: true }, opts());
    expect(await alertsOf(sub.id)).toEqual({ on: true, since: NOW });
  });

  it('left undefined (language switch, or the box not shown) the stored choice and time stay', async () => {
    const sub = await seed({ goingAlerts: true, goingAlertsSince: ago(30 * DAY) });
    expect(await updatePreferences(sub, { locale: 'zh', categories: ['vc'] }, opts())).toMatchObject({
      locale: 'zh', categories: ['vc'], goingAlerts: true, goingAlertsSince: ago(30 * DAY),
    });
  });

  it('no category with alerts unticked: unsubscribed and alerts off in the same save, so "Subscribe again" doesn\'t bring them back', async () => {
    const sub = await seed({ goingAlerts: true, goingAlertsSince: ago(30 * DAY) });
    const row = await updatePreferences(sub, { locale: 'en', categories: [], goingAlerts: false }, opts());
    expect(row).toMatchObject({ status: 'unsubscribed', unsubscribedAt: NOW, categories: ['ai', 'vc'], goingAlerts: false, goingAlertsSince: null });
    expect(await reload(sub.id)).toEqual(row);
    expect((await resubscribe(row, PREFS_CONSENT, opts())).sub).toMatchObject({ status: 'active', goingAlerts: false, goingAlertsSince: null });
  });

  it('no category with alerts ticked, or the box not shown: unsubscribed, the stored alerts choice left as it was', async () => {
    const off = await seed();
    expect(await updatePreferences(off, { locale: 'en', categories: [], goingAlerts: true }, opts())).toMatchObject({
      status: 'unsubscribed', goingAlerts: false, goingAlertsSince: null,
    });
    const on = await seed({ goingAlerts: true, goingAlertsSince: ago(30 * DAY) });
    expect(await updatePreferences(on, { locale: 'en', categories: [] }, opts())).toMatchObject({
      status: 'unsubscribed', goingAlerts: true, goingAlertsSince: ago(30 * DAY),
    });
    // An unsubscribed row is not editable: an empty save from a stale page changes nothing.
    const gone = await seed({ status: 'unsubscribed', unsubscribedAt: ago(DAY), goingAlerts: true, goingAlertsSince: ago(30 * DAY) });
    expect(await updatePreferences(gone, { locale: 'en', categories: [], goingAlerts: false }, opts())).toEqual(gone);
  });

  it('pending and paused rows can switch alerts; unsubscribed and suppressed rows cannot', async () => {
    for (const status of ['pending', 'paused'] as const) {
      const sub = await seed({ status, pausedUntil: status === 'paused' ? new Date(NOW.getTime() + DAY) : null });
      expect(await updatePreferences(sub, { ...prefs, goingAlerts: true }, opts())).toMatchObject({ status, goingAlerts: true, goingAlertsSince: NOW });
    }
    for (const status of ['unsubscribed', 'suppressed'] as const) {
      const sub = await seed({ status });
      await updatePreferences(sub, { ...prefs, goingAlerts: true }, opts());
      expect(await reload(sub.id)).toEqual(sub);
    }
  });
});

describe('going alerts: disableGoingAlerts', () => {
  it('turns off alerts only: status, categories, language and the weekly email stay; repeating it is harmless', async () => {
    for (const status of ['pending', 'active', 'paused', 'unsubscribed'] as const) {
      const sub = await seed({
        status, locale: 'zh', goingAlerts: true, goingAlertsSince: ago(DAY), pausedUntil: status === 'paused' ? new Date(NOW.getTime() + DAY) : null,
      });
      const row = await disableGoingAlerts(sub, opts());
      expect(row).toEqual({ ...sub, goingAlerts: false, goingAlertsSince: null });
      expect(await disableGoingAlerts(sub, opts())).toEqual(row);
      expect(await reload(sub.id)).toEqual(row);
    }
  });

  it('leaves a suppressed row alone, and is a no-op when alerts are already off', async () => {
    const suppressed = await seed({ status: 'suppressed', goingAlerts: true, goingAlertsSince: ago(DAY) });
    expect(await disableGoingAlerts(suppressed, opts())).toEqual(suppressed);
    expect(await reload(suppressed.id)).toEqual(suppressed);
    const off = await seed();
    expect(await disableGoingAlerts(off, opts())).toEqual(off);
  });

  it('turned off while unsubscribed, "Subscribe again" brings back the weekly email without the alerts', async () => {
    const sub = await seed({ status: 'unsubscribed', unsubscribedAt: ago(DAY), goingAlerts: true, goingAlertsSince: ago(60 * DAY) });
    await disableGoingAlerts(sub, opts());
    const r = await resubscribe(await reload(sub.id), PREFS_CONSENT, opts());
    expect(r.sub).toMatchObject({ status: 'active', goingAlerts: false, goingAlertsSince: null });
  });
});

describe('going alerts: an unconfirmed re-request and the 7-day purge', () => {
  it('alerts switched on by a request nobody confirmed are off after the revert; "Subscribe again" brings back only the weekly email', async () => {
    const former = await seed({ status: 'unsubscribed', confirmedAt: ago(60 * DAY), unsubscribedAt: ago(20 * DAY) });
    await requestSubscription(input({ email: former.email, categories: ['vc'], goingAlerts: true }), opts(ago(8 * DAY)));
    expect(await alertsOf(former.id)).toEqual({ on: true, since: ago(8 * DAY) });
    expect(await purgeStalePending(opts())).toEqual({ deleted: 0, reverted: 1 });
    expect(await reload(former.id)).toMatchObject({ status: 'unsubscribed', unsubscribedAt: ago(20 * DAY), goingAlerts: false, goingAlertsSince: null });
    const r = await resubscribe(await reload(former.id), PREFS_CONSENT, opts());
    expect(r).toMatchObject({ needsConfirm: false, sub: { status: 'active', goingAlerts: false, goingAlertsSince: null } });
  });

  it('conservative: alerts that were on before the unconfirmed request are switched off too (the reader can tick them again)', async () => {
    const former = await seed({ status: 'unsubscribed', unsubscribedAt: ago(20 * DAY), goingAlerts: true, goingAlertsSince: ago(90 * DAY) });
    await requestSubscription(input({ email: former.email }), opts(ago(8 * DAY))); // box not shown: the stored choice is kept
    expect(await alertsOf(former.id)).toEqual({ on: true, since: ago(8 * DAY) });
    await purgeStalePending(opts());
    expect(await alertsOf(former.id)).toEqual({ on: false, since: null });
  });

  it('rows the purge doesn\'t revert keep their alerts', async () => {
    const fresh = await seed({ status: 'pending', confirmedAt: ago(60 * DAY), consentAt: ago(DAY), goingAlerts: true, goingAlertsSince: ago(DAY) });
    const active = await seed({ goingAlerts: true, goingAlertsSince: ago(30 * DAY) });
    expect(await purgeStalePending(opts())).toEqual({ deleted: 0, reverted: 0 });
    expect(await reload(fresh.id)).toEqual(fresh);
    expect(await reload(active.id)).toEqual(active);
  });
});

describe('going alerts: resubscribe', () => {
  it('alerts that were on come back counting from now, so no mark from while they were away is sent', async () => {
    const sub = await seed({ status: 'unsubscribed', unsubscribedAt: ago(10 * DAY), goingAlerts: true, goingAlertsSince: ago(60 * DAY) });
    expect((await resubscribe(sub, PREFS_CONSENT, opts())).sub).toMatchObject({ status: 'active', goingAlerts: true, goingAlertsSince: NOW });
    const never = await seed({ status: 'unsubscribed', confirmedAt: null, unsubscribedAt: ago(DAY), goingAlerts: true, goingAlertsSince: ago(9 * DAY) });
    expect((await resubscribe(never, PREFS_CONSENT, opts())).sub).toMatchObject({ status: 'pending', goingAlerts: true, goingAlertsSince: NOW });
    const off = await seed({ status: 'unsubscribed', unsubscribedAt: ago(DAY) });
    expect((await resubscribe(off, PREFS_CONSENT, opts())).sub).toMatchObject({ goingAlerts: false, goingAlertsSince: null });
  });
});

/** An alert_sends row for `sub` on a Pacific day; `inFlight` leaves it claimed (an hour ago by default) but unresolved. */
async function alertRow(sub: Subscriber, day: string, state: 'sent' | 'failed' | 'inFlight' = 'sent', claimedAt = ago(state === 'inFlight' ? HOUR : DAY)) {
  await db.insert(alertSends).values({
    alertDay: day, subscriberId: sub.id, eventIds: ['evt_0123456789abcdef'], variantKey: 'en:evt_0123456789abcdef', claimedAt,
    resendId: state === 'sent' ? 're_a' : null, sentAt: state === 'sent' ? ago(DAY) : null, error: state === 'failed' ? 'failed:bounced' : null,
  });
}
const alertsSentTo = async (id: string) => db.select().from(alertSends).where(eq(alertSends.subscriberId, id));

describe('going alerts: delete, retention and purge cover alert_sends', () => {
  it('alert_sends references the subscriber (NO ACTION): a plain DELETE fails, so every delete path must take them along', async () => {
    const sub = await seed();
    await alertRow(sub, '2026-10-01');
    await expect(db.delete(subscribers).where(eq(subscribers.id, sub.id))).rejects.toMatchObject({ cause: { code: '23503' } });
  });

  it('admin Delete removes the alert history with the row and counts it with the digest sends', async () => {
    const sub = await seed();
    const other = await seed();
    await sendRow(sub);
    await alertRow(sub, '2026-10-01');
    await alertRow(sub, '2026-10-02', 'failed');
    await alertRow(other, '2026-10-01');
    expect(await deleteSubscriber(sub.id, opts())).toEqual({ result: 'deleted', sends: 3 });
    expect(await reload(sub.id)).toBeUndefined();
    expect(await alertsSentTo(sub.id)).toEqual([]);
    expect(await alertsSentTo(other.id)).toHaveLength(1);
    expect(await audits('admin_delete')).toHaveLength(1);
  });

  it('admin Delete waits while an alert is in flight, like a digest claim', async () => {
    const sub = await seed();
    await alertRow(sub, '2026-10-01');
    await alertRow(sub, '2026-10-02', 'inFlight');
    expect(await deleteSubscriber(sub.id, opts())).toEqual({ result: 'in_flight', sends: 0 });
    expect(await alertsSentTo(sub.id)).toHaveLength(2);
    expect(await audits('admin_delete')).toEqual([]);
    // A suppressed row with an alert in flight: in flight is the message that can be acted on.
    const suppressed = await seed({ status: 'suppressed' });
    await alertRow(suppressed, '2026-10-02', 'inFlight');
    expect((await deleteSubscriber(suppressed.id, { ...opts(), allowSuppressed: true })).result).toBe('in_flight');
    await db.update(alertSends).set({ resendId: 're_b', sentAt: NOW }).where(eq(alertSends.subscriberId, sub.id));
    expect(await deleteSubscriber(sub.id, opts())).toEqual({ result: 'deleted', sends: 2 });
  });

  it('retention deletes old unsubscribed rows with their alert history; an alert in flight makes one wait', async () => {
    const old = await seed({ status: 'unsubscribed', unsubscribedAt: ago(UNSUBSCRIBED_TTL_MS + DAY) });
    const busy = await seed({ status: 'unsubscribed', unsubscribedAt: ago(UNSUBSCRIBED_TTL_MS + DAY) });
    const recent = await seed({ status: 'unsubscribed', unsubscribedAt: ago(30 * DAY) });
    await alertRow(old, '2025-09-01');
    await sendRow(old);
    await alertRow(busy, '2025-09-01', 'inFlight');
    await alertRow(recent, '2026-09-01');
    expect(await purgeOldUnsubscribed(opts())).toEqual({ deleted: 1 });
    expect(await reload(old.id)).toBeUndefined();
    expect(await alertsSentTo(old.id)).toEqual([]);
    expect(await sendsOf(old.id)).toEqual([]);
    expect(await reload(busy.id)).toBeDefined();
    expect(await alertsSentTo(recent.id)).toHaveLength(1);
    await db.update(alertSends).set({ error: 'ineligible' }).where(eq(alertSends.subscriberId, busy.id));
    expect(await purgeOldUnsubscribed(opts())).toEqual({ deleted: 1 });
    expect(await alertsSentTo(busy.id)).toEqual([]);
  });

  it('the stale-pending purge leaves a never-confirmed row with alert history alone, without throwing', async () => {
    const odd = await seed({ status: 'pending', confirmedAt: null, consentAt: ago(10 * DAY) });
    await alertRow(odd, '2026-09-25');
    const stranger = await seed({ status: 'pending', confirmedAt: null, consentAt: ago(10 * DAY) });
    expect(await purgeStalePending(opts())).toEqual({ deleted: 1, reverted: 0 });
    expect(await reload(odd.id)).toMatchObject({ status: 'pending' });
    expect(await alertsSentTo(odd.id)).toHaveLength(1);
    expect(await reload(stranger.id)).toBeUndefined();
  });
});

describe('in flight means a claim that can still be sent (younger than EXPIRE_MS)', () => {
  it('a claim stuck past 23 h (the run stopped, then alerts were switched off) blocks neither admin Delete nor retention', async () => {
    // Claimed, never resolved, and no run since to mark it expired (runAlerts returns early while 'off').
    const sub = await seed();
    await alertRow(sub, '2026-10-02', 'inFlight', ago(EXPIRE_MS));
    await sendRow(sub, 'inFlight', ago(EXPIRE_MS + HOUR));
    expect(await deleteSubscriber(sub.id, opts())).toEqual({ result: 'deleted', sends: 2 });
    expect(await alertsSentTo(sub.id)).toEqual([]);
    expect(await sendsOf(sub.id)).toEqual([]);

    const old = await seed({ status: 'unsubscribed', unsubscribedAt: ago(UNSUBSCRIBED_TTL_MS + DAY) });
    await alertRow(old, '2025-09-01', 'inFlight', ago(400 * DAY));
    await sendRow(old, 'inFlight', ago(400 * DAY));
    expect(await purgeOldUnsubscribed(opts())).toEqual({ deleted: 1 });
    expect(await reload(old.id)).toBeUndefined();
    expect(await alertsSentTo(old.id)).toEqual([]);
    expect(await sendsOf(old.id)).toEqual([]);
  });

  it.each([
    ['an alert claim', (sub: Subscriber, at: Date) => alertRow(sub, '2026-10-03', 'inFlight', at)],
    ['a digest claim', (sub: Subscriber, at: Date) => sendRow(sub, 'inFlight', at)],
  ])('%s just inside the window still blocks Delete and retention; once 23 h old it no longer does', async (_label, claim) => {
    const sub = await seed();
    await claim(sub, ago(EXPIRE_MS - 60_000));
    expect(await deleteSubscriber(sub.id, opts())).toEqual({ result: 'in_flight', sends: 0 });
    expect(await deleteSubscriber(sub.id, opts(new Date(NOW.getTime() + 60_000)))).toEqual({ result: 'deleted', sends: 1 });

    const old = await seed({ status: 'unsubscribed', unsubscribedAt: ago(UNSUBSCRIBED_TTL_MS + DAY) });
    await claim(old, ago(EXPIRE_MS - 60_000));
    expect(await purgeOldUnsubscribed(opts())).toEqual({ deleted: 0 });
    expect(await purgeOldUnsubscribed(opts(new Date(NOW.getTime() + 60_000)))).toEqual({ deleted: 1 });
  });

  it('"why nothing was deleted" uses the same rule: a suppressed row with only a stale claim says suppressed, not in flight', async () => {
    const sub = await seed({ status: 'suppressed' });
    await alertRow(sub, '2026-10-02', 'inFlight', ago(2 * DAY));
    await sendRow(sub, 'inFlight', ago(2 * DAY));
    expect(await deleteSubscriber(sub.id, opts())).toEqual({ result: 'suppressed', sends: 0 });
    expect(await deleteSubscriber(sub.id, { ...opts(), allowSuppressed: true })).toEqual({ result: 'deleted', sends: 2 });
  });
});
