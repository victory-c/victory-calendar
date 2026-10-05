import { createHmac } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { testDb } from './helpers/pglite';

// Route-level contract for the newsletter links: GET /confirm/<token> (303s only), RFC 8058
// POST /api/unsubscribe (200, no redirect, no cookie; GET never mutates), the Resend webhook
// (Standard Webhooks signature → suppression) and the 7-day pending purge in /api/cron/sync.
const h = vi.hoisted(() => ({ db: null as unknown, client: null as unknown, hasDb: true, connections: 0 }));
vi.mock('@/lib/db', async (orig) => ({
  ...(await orig()),
  db: new Proxy({}, { get: (_t, p) => Reflect.get(h.db as object, p) }),
  hasDatabase: () => h.hasDb,
}));
// connection() needs a live request store; outside Next it throws, so count the calls instead.
vi.mock('next/server', async (orig) => ({ ...(await orig()), connection: async () => void h.connections++ }));

const confirmRoute = await import('@/app/[locale]/confirm/[token]/route');
const unsubscribeRoute = await import('@/app/api/unsubscribe/route');
const webhookRoute = await import('@/app/api/webhooks/resend/route');
const cronRoute = await import('@/app/api/cron/sync/route');
const { digestIssues, digestSends, jobsLog, subscribers } = await import('@/lib/db/schema');
const { newId } = await import('@/lib/ids');
const { linkToken } = await import('@/lib/subscribers/token');
type DB = import('@/lib/db').DB;
type Subscriber = import('@/lib/subscribers/service').Subscriber;
type PGlite = import('@electric-sql/pglite').PGlite;

const DAY = 864e5;
const db = () => h.db as DB;
/** Stands in for the database when there is none: any query fails the test. */
const noDb = new Proxy({}, { get: () => { throw new Error('database touched'); } });

let n = 0;
beforeEach(async () => {
  const t = await testDb();
  h.db = t.db;
  h.client = t.client;
  h.hasDb = true;
  h.connections = 0;
  vi.stubEnv('SUBSCRIBER_LINK_SECRET', 'test-secret-routes-0123456789');
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

async function seed(over: Partial<typeof subscribers.$inferInsert> = {}): Promise<Subscriber> {
  const now = Date.now();
  const [row] = await db()
    .insert(subscribers)
    .values({
      id: newId('sub'), email: `reader${++n}@example.org`, status: 'active', locale: 'en', categories: ['ai', 'vc'],
      consentAt: new Date(now - DAY), confirmedAt: new Date(now - DAY), ...over,
    })
    .returning();
  return row;
}
const reload = async (id: string) => (await db().select().from(subscribers).where(eq(subscribers.id, id)))[0];
const pending = (over: Partial<typeof subscribers.$inferInsert> = {}) =>
  seed({ status: 'pending', confirmedAt: null, consentAt: new Date(Date.now() - DAY), ...over });
/** Signed for a row that does not exist. */
const ghostToken = () => linkToken({ id: 'sub_0000000000000000', tokenVersion: 1 });
const tampered = (t: string) => `${t.slice(0, -1)}${t.endsWith('A') ? 'B' : 'A'}`;

describe('GET /confirm/[token]', () => {
  const get = (locale: string, token: string) =>
    confirmRoute.GET(new NextRequest(`http://localhost/${locale}/confirm/${token}`), { params: Promise.resolve({ locale, token }) });
  const expectSee = (res: Response, path: string) => {
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe(`http://localhost${path}`);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('referrer-policy')).toBe('no-referrer');
  };

  it('confirms and lands on prefs with the welcome banner, in the link language', async () => {
    const sub = await pending();
    const t = linkToken(sub);
    expectSee(await get('en', t), `/prefs/${t}?welcome=1`);
    expect(await reload(sub.id)).toMatchObject({ status: 'active' });
    expect((await reload(sub.id)).confirmedAt).toBeInstanceOf(Date);
    expect(h.connections).toBe(1);

    const zh = await pending({ locale: 'zh' });
    const tz = linkToken(zh);
    expectSee(await get('zh', tz), `/zh/prefs/${tz}?welcome=1`);
  });

  it('a second click says already; a paused row too', async () => {
    const sub = await pending();
    const t = linkToken(sub);
    await get('en', t);
    const confirmedAt = (await reload(sub.id)).confirmedAt;
    expectSee(await get('en', t), `/prefs/${t}?welcome=already`);
    expect((await reload(sub.id)).confirmedAt).toEqual(confirmedAt);
    const paused = await seed({ status: 'paused', pausedUntil: new Date(Date.now() + DAY) });
    const tp = linkToken(paused);
    expectSee(await get('zh', tp), `/zh/prefs/${tp}?welcome=already`);
    expect((await reload(paused.id)).status).toBe('paused');
  });

  it('an expired link (older than 7 days, or unsubscribed since) goes back to the form', async () => {
    const stale = await pending({ consentAt: new Date(Date.now() - 8 * DAY) });
    expectSee(await get('en', linkToken(stale)), '/subscribe?link=expired');
    expectSee(await get('zh', linkToken(stale)), '/zh/subscribe?link=expired');
    expect((await reload(stale.id)).status).toBe('pending');
    const gone = await seed({ status: 'unsubscribed', unsubscribedAt: new Date() });
    expectSee(await get('en', linkToken(gone)), '/subscribe?link=expired');
    expect((await reload(gone.id)).status).toBe('unsubscribed');
  });

  it('a bad, unknown or suppressed token is invalid and changes nothing', async () => {
    const sub = await pending();
    const suppressed = await seed({ status: 'suppressed' });
    for (const t of [tampered(linkToken(sub)), ghostToken(), 'nope', `${sub.id}.`, linkToken(suppressed)]) {
      expectSee(await get('en', t), '/subscribe?link=invalid');
    }
    expectSee(await get('zh', 'nope'), '/zh/subscribe?link=invalid');
    expect((await reload(sub.id)).status).toBe('pending');
    expect((await reload(suppressed.id)).status).toBe('suppressed');
  });

  it('only en and zh exist', async () => {
    const sub = await pending();
    const res = await get('fr', linkToken(sub));
    expect(res.status).toBe(404);
    expect(res.headers.get('location')).toBeNull();
    expect((await reload(sub.id)).status).toBe('pending');
  });

  it('without a database or link secret every link is invalid, and nothing touches the db', async () => {
    const t = linkToken(await pending());
    h.db = noDb;
    h.hasDb = false;
    expectSee(await get('en', t), '/subscribe?link=invalid');
    expectSee(await get('zh', t), '/zh/subscribe?link=invalid');
    h.hasDb = true;
    vi.stubEnv('SUBSCRIBER_LINK_SECRET', '');
    expectSee(await get('en', t), '/subscribe?link=invalid');
  });

  it('HEAD (link scanners) is 200 and confirms nothing', async () => {
    const sub = await pending();
    const res = confirmRoute.HEAD();
    expect(res.status).toBe(200);
    expect(res.headers.get('location')).toBeNull();
    expect(await reload(sub.id)).toMatchObject({ status: 'pending', confirmedAt: null });
  });
});

describe('/api/unsubscribe (RFC 8058)', () => {
  const url = (t?: string | null) => `http://localhost/api/unsubscribe${t == null ? '' : `?t=${encodeURIComponent(t)}`}`;
  const oneClick = (t: string | null, init: RequestInit = { body: 'List-Unsubscribe=One-Click', headers: { 'content-type': 'application/x-www-form-urlencoded' } }) =>
    unsubscribeRoute.POST(new NextRequest(url(t), { method: 'POST', ...init } as ConstructorParameters<typeof NextRequest>[1]));
  const multipart = () => {
    const form = new FormData();
    form.set('List-Unsubscribe', 'One-Click');
    return { body: form };
  };
  const expectPlain = async (res: Response, status: number, body?: string) => {
    expect(res.status).toBe(status);
    expect(res.headers.get('location')).toBeNull();
    expect(res.headers.get('set-cookie')).toBeNull();
    expect(res.headers.getSetCookie()).toEqual([]);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('content-type')).toBe('text/plain; charset=utf-8');
    if (body) expect(await res.text()).toBe(body);
  };

  it('POST urlencoded unsubscribes before responding: 200 text, no Location, no Set-Cookie', async () => {
    const sub = await seed();
    await expectPlain(await oneClick(linkToken(sub)), 200, 'Unsubscribed. 已退订。');
    const row = await reload(sub.id);
    expect(row.status).toBe('unsubscribed');
    expect(row.unsubscribedAt).toBeInstanceOf(Date);
  });

  it('POST multipart works the same', async () => {
    const req = new NextRequest(url('x'), { method: 'POST', ...multipart() });
    expect(req.headers.get('content-type')).toMatch(/^multipart\/form-data; boundary=/);
    const sub = await seed({ status: 'paused', pausedUntil: new Date(Date.now() + DAY) });
    await expectPlain(await oneClick(linkToken(sub), multipart()), 200, 'Unsubscribed. 已退订。');
    expect(await reload(sub.id)).toMatchObject({ status: 'unsubscribed', pausedUntil: null });
  });

  it('POST with an empty or odd body still works: only the token matters', async () => {
    const a = await pending();
    await expectPlain(await oneClick(linkToken(a), {}), 200);
    const b = await seed();
    await expectPlain(await oneClick(linkToken(b), { body: '{"not":"a form"}', headers: { 'content-type': 'application/json' } }), 200);
    expect((await reload(a.id)).status).toBe('unsubscribed');
    expect((await reload(b.id)).status).toBe('unsubscribed');
  });

  it('is idempotent: repeats still return 200 and keep the first timestamp', async () => {
    const sub = await seed();
    const t = linkToken(sub);
    await oneClick(t);
    const first = (await reload(sub.id)).unsubscribedAt;
    await expectPlain(await oneClick(t), 200, 'Unsubscribed. 已退订。');
    await expectPlain(await oneClick(t, multipart()), 200);
    expect((await reload(sub.id)).unsubscribedAt).toEqual(first);
    // Suppressed is already stronger than unsubscribed: 200 and it stays suppressed.
    const suppressed = await seed({ status: 'suppressed' });
    await expectPlain(await oneClick(linkToken(suppressed)), 200);
    expect((await reload(suppressed.id)).status).toBe('suppressed');
  });

  it('400 for a missing, malformed, tampered or unknown token, changing nothing', async () => {
    const sub = await seed();
    for (const t of [null, '', 'bad', tampered(linkToken(sub)), ghostToken()]) {
      await expectPlain(await oneClick(t), 400);
    }
    expect((await reload(sub.id)).status).toBe('active');
    // The token goes in the URL, never the body.
    await expectPlain(await oneClick(null, { body: `t=${linkToken(sub)}`, headers: { 'content-type': 'application/x-www-form-urlencoded' } }), 400);
    expect((await reload(sub.id)).status).toBe('active');
  });

  it('503 (never a redirect) without a database or link secret', async () => {
    const t = linkToken(await seed());
    h.db = noDb;
    h.hasDb = false;
    await expectPlain(await oneClick(t), 503);
    await expectPlain(await oneClick('bad'), 503);
    h.hasDb = true;
    vi.stubEnv('SUBSCRIBER_LINK_SECRET', '');
    await expectPlain(await oneClick(t), 503);
  });

  describe('GET never mutates', () => {
    const get = (t?: string | null) => unsubscribeRoute.GET(new NextRequest(url(t)));
    const expectSee = (res: Response, path: string) => {
      expect(res.status).toBe(303);
      expect(res.headers.get('location')).toBe(`http://localhost${path}`);
      expect(res.headers.get('cache-control')).toBe('no-store');
      expect(res.headers.get('referrer-policy')).toBe('no-referrer');
      expect(res.headers.get('set-cookie')).toBeNull();
    };

    it('sends a valid token to the manual page in the subscriber language', async () => {
      const en = await seed();
      const zh = await seed({ locale: 'zh' });
      expectSee(await get(linkToken(en)), `/unsubscribe?t=${linkToken(en)}`);
      expectSee(await get(linkToken(zh)), `/zh/unsubscribe?t=${linkToken(zh)}`);
      expect((await reload(en.id)).status).toBe('active');
      expect((await reload(zh.id)).status).toBe('active');
      expect(h.connections).toBe(2);
    });

    it('a well-formed but invalid token keeps t and falls back to English; junk drops t', async () => {
      const zh = await seed({ locale: 'zh' });
      const bad = tampered(linkToken(zh));
      expectSee(await get(bad), `/unsubscribe?t=${bad}`);
      expectSee(await get(ghostToken()), `/unsubscribe?t=${ghostToken()}`);
      expectSee(await get('x'), '/unsubscribe');
      expectSee(await get('https://evil.example/'), '/unsubscribe');
      expectSee(await get(null), '/unsubscribe');
      expect((await reload(zh.id)).status).toBe('active');
    });

    it('without a database it still redirects, without reading anything', async () => {
      const t = linkToken(await seed({ locale: 'zh' }));
      h.db = noDb;
      h.hasDb = false;
      expectSee(await get(t), `/unsubscribe?t=${t}`);
    });

    it('a database error only costs the language prefix', async () => {
      const t = linkToken(await seed({ locale: 'zh' }));
      h.db = noDb;
      expectSee(await get(t), `/unsubscribe?t=${t}`);
    });
  });

  it('HEAD is 200 and changes nothing', async () => {
    const sub = await seed();
    const res = unsubscribeRoute.HEAD();
    expect(res.status).toBe(200);
    expect(res.headers.get('location')).toBeNull();
    expect((await reload(sub.id)).status).toBe('active');
  });
});

describe('POST /api/webhooks/resend', () => {
  const SECRET = `whsec_${Buffer.from('0123456789abcdef0123456789abcdef').toString('base64')}`;
  beforeEach(() => vi.stubEnv('RESEND_WEBHOOK_SECRET', SECRET));

  type Opts = { ts?: number; id?: string; secret?: string; body?: string; headers?: Record<string, string> };
  /** A Standard Webhooks request as Resend (Svix) sends it. */
  function signed(evt: unknown, o: Opts = {}) {
    const payload = typeof evt === 'string' ? evt : JSON.stringify(evt);
    const ts = o.ts ?? Math.floor(Date.now() / 1000);
    const id = o.id ?? 'msg_2abc';
    const key = Buffer.from((o.secret ?? SECRET).replace(/^whsec_/, ''), 'base64');
    const sig = createHmac('sha256', key).update(`${id}.${ts}.${payload}`).digest('base64');
    return new Request('http://localhost/api/webhooks/resend', {
      method: 'POST',
      body: o.body ?? payload,
      headers: { 'content-type': 'application/json', 'svix-id': id, 'svix-timestamp': String(ts), 'svix-signature': `v1,${sig}`, ...o.headers },
    });
  }
  const emailEvent = (type: string, to: string[], extra: Record<string, unknown> = {}) => ({
    type,
    created_at: new Date().toISOString(),
    data: {
      email_id: 'em_1', message_id: '<m1@example.org>', from: "Victor's Picks <picks@example.org>", to, subject: 'This week', created_at: new Date().toISOString(),
      ...extra,
    },
  });
  const bounced = (to: string[], type: string) => emailEvent('email.bounced', to, { bounce: { type, subType: 'General', message: 'x' } });
  const post = (req: Request) => webhookRoute.POST(req);

  it('503 when the signing secret is not configured (never accepts unsigned events)', async () => {
    vi.stubEnv('RESEND_WEBHOOK_SECRET', '');
    const sub = await seed();
    expect((await post(signed(emailEvent('email.complained', [sub.email])))).status).toBe(503);
    expect((await reload(sub.id)).status).toBe('active');
  });

  it('400 for a bad, stale, missing or foreign signature, or a changed body', async () => {
    const sub = await seed();
    const evt = emailEvent('email.complained', [sub.email]);
    const now = Math.floor(Date.now() / 1000);
    const bad = [
      signed(evt, { headers: { 'svix-signature': 'v1,AAAA' } }),
      signed(evt, { secret: `whsec_${Buffer.from('another-secret-another-secret!!').toString('base64')}` }),
      signed(evt, { ts: now - 600 }),
      signed(evt, { ts: now + 600 }),
      signed(evt, { body: JSON.stringify(emailEvent('email.complained', ['someone-else@example.org'])) }),
      signed(evt, { headers: { 'svix-id': 'msg_other' } }),
      new Request('http://localhost/api/webhooks/resend', { method: 'POST', body: JSON.stringify(evt) }),
    ];
    for (const req of bad) {
      const res = await post(req);
      expect(res.status).toBe(400);
    }
    expect((await reload(sub.id)).status).toBe('active');
  });

  it('a signed empty or non-object payload is rejected, not a crash', async () => {
    expect((await post(signed(''))).status).toBe(400);
    expect((await post(signed('null'))).status).toBe(400);
    expect((await post(signed('"email.bounced"'))).status).toBe(400);
  });

  it('a permanent bounce suppresses every recipient, matched case-insensitively', async () => {
    const a = await seed();
    const b = await seed({ status: 'pending', confirmedAt: null });
    const res = await post(signed(bounced([a.email.toUpperCase(), `Reader <${b.email}>`], 'Permanent')));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, suppressed: 2 });
    expect((await reload(a.id)).status).toBe('suppressed');
    expect((await reload(b.id)).status).toBe('suppressed');
  });

  it('an undetermined bounce suppresses too; a transient one does not', async () => {
    const soft = await seed();
    const res = await post(signed(bounced([soft.email], 'Transient')));
    expect(res.status).toBe(200);
    expect((await reload(soft.id)).status).toBe('active');
    const unknown = await seed();
    expect((await post(signed(bounced([unknown.email], 'Undetermined')))).status).toBe(200);
    expect((await reload(unknown.id)).status).toBe('suppressed');
  });

  it('complaints and Resend suppressions suppress; replays are harmless', async () => {
    const a = await seed({ status: 'paused', pausedUntil: new Date(Date.now() + DAY) });
    const b = await seed({ status: 'unsubscribed' });
    const complaint = emailEvent('email.complained', [a.email]);
    expect(await (await post(signed(complaint))).json()).toEqual({ ok: true, suppressed: 1 });
    expect(await reload(a.id)).toMatchObject({ status: 'suppressed', pausedUntil: null });
    // At-least-once delivery: the same event again changes nothing and still succeeds.
    const replay = await post(signed(complaint));
    expect(replay.status).toBe(200);
    expect(await replay.json()).toEqual({ ok: true, suppressed: 0 });
    const res = await post(signed(emailEvent('email.suppressed', [b.email], { suppressed: { type: 'OnAccountSuppressionList', message: 'x' } })));
    expect(res.status).toBe(200);
    expect((await reload(b.id)).status).toBe('suppressed');
  });

  it('a signed event with an unknown recipient is a 200 that changes nothing', async () => {
    const sub = await seed();
    const res = await post(signed(emailEvent('email.complained', ['nobody@example.org', 'not an address'])));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, suppressed: 0 });
    expect((await reload(sub.id)).status).toBe('active');
  });

  it('every other event type (delivered, opened, contact.updated, future types) is a 200 no-op', async () => {
    const sub = await seed();
    const others = [
      emailEvent('email.delivered', [sub.email]),
      emailEvent('email.opened', [sub.email]),
      emailEvent('email.delivery_delayed', [sub.email]),
      { type: 'contact.updated', created_at: new Date().toISOString(), data: { id: 'c1', email: sub.email, unsubscribed: true } },
      { type: 'email.something_new', created_at: new Date().toISOString(), data: { to: [sub.email] } },
    ];
    for (const evt of others) {
      const res = await post(signed(evt));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true });
    }
    expect((await reload(sub.id)).status).toBe('active');
  });

  it('without a database: suppressing events get 503 (Resend retries), others still 200', async () => {
    const sub = await seed();
    h.db = noDb;
    h.hasDb = false;
    expect((await post(signed(emailEvent('email.complained', [sub.email])))).status).toBe(503);
    expect((await post(signed(bounced([sub.email], 'Permanent')))).status).toBe(503);
    expect((await post(signed(emailEvent('email.delivered', [sub.email])))).status).toBe(200);
    expect((await post(signed(bounced([sub.email], 'Transient')))).status).toBe(200);
  });

  describe('a failed suppression write', () => {
    /** Every console line, as the log drain would see it. */
    function captureLogs() {
      const logs: unknown[][] = [];
      for (const level of ['log', 'info', 'warn', 'error', 'debug'] as const) {
        vi.spyOn(console, level).mockImplementation((...args: unknown[]) => void logs.push(args));
      }
      return () => logs.map((args) => args.map((a) => (a instanceof Error ? `${a.message}\n${a.stack}` : String(a))).join(' ')).join('\n');
    }

    it('is a 503 (so Resend retries), logged with the reason and a count but no address', async () => {
      const text = captureLogs();
      const sub = await seed({ email: 'private.person@example.org' });
      // The driver's error message carries the bound params (the addresses) on a later line.
      await (h.client as PGlite).exec('drop table subscribers cascade');
      const res = await post(signed(emailEvent('email.complained', [sub.email, 'Other Person <other.person@example.org>'])));
      expect(res.status).toBe(503);
      expect(res.headers.get('cache-control')).toBe('no-store');
      expect(await res.text()).toBe('Suppression failed');
      const logged = text();
      expect(logged).toContain('[webhook:resend] email.complained: suppress failed for 2 recipient(s)');
      expect(logged).toContain('relation "subscribers" does not exist');
      expect(logged).not.toContain('private.person');
      expect(logged).not.toContain('other.person');
    });

    it('masks an address that reaches the first line of the error', async () => {
      const text = captureLogs();
      const sub = await seed({ email: 'private.person@example.org' });
      const real = h.db as DB;
      h.db = new Proxy(real, {
        get: (t, p) => (p === 'update' ? () => { throw new Error(`could not suppress ${sub.email}`); } : Reflect.get(t, p)),
      });
      const res = await post(signed(bounced([sub.email], 'Permanent')));
      expect(res.status).toBe(503);
      const logged = text();
      expect(logged).toContain('p***@example.org');
      expect(logged).not.toContain('private.person');
      h.db = real;
      expect((await reload(sub.id)).status).toBe('active');
    });
  });

  it('logs counts, never addresses', async () => {
    const logs: unknown[] = [];
    for (const level of ['log', 'info', 'warn', 'error', 'debug'] as const) {
      vi.spyOn(console, level).mockImplementation((...args: unknown[]) => void logs.push(args));
    }
    const sub = await seed({ email: 'private.person@example.org' });
    await post(signed(emailEvent('email.complained', [sub.email])));
    await post(signed(emailEvent('email.complained', [sub.email]), { headers: { 'svix-signature': 'v1,AAAA' } }));
    await post(signed(emailEvent('email.delivered', [sub.email])));
    expect(logs.length).toBeGreaterThan(0);
    expect(JSON.stringify(logs)).not.toContain('private.person');
  });
});

describe('GET /api/cron/sync: stale pending purge', () => {
  beforeEach(() => {
    vi.stubEnv('CRON_SECRET', 'cron-secret');
    // No feeds configured, so the inbox half only expires candidates (no network).
    for (const k of ['GCAL_SECRET_ICS_URL', 'LUMA_PERSONAL_ICS_URL', 'PARTIFUL_ICS_URL']) vi.stubEnv(k, '');
  });
  const run = (auth = 'Bearer cron-secret') => cronRoute.GET(new Request('http://localhost/api/cron/sync', { headers: { authorization: auth } }));

  it('401 without the cron secret, and nothing is purged', async () => {
    const stale = await pending({ consentAt: new Date(Date.now() - 8 * DAY) });
    expect((await run('Bearer nope')).status).toBe(401);
    expect(await reload(stale.id)).toBeDefined();
  });

  it('deletes sign-ups unconfirmed for 7 days, reports pending_purged and logs a jobs_log row', async () => {
    const stale = await pending({ consentAt: new Date(Date.now() - 8 * DAY) });
    const fresh = await pending({ consentAt: new Date(Date.now() - 6 * DAY) });
    const old = await seed({ consentAt: new Date(Date.now() - 60 * DAY) });
    const res = await run();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, job: 'sync', skipped: 'no_feeds', expired: 0, pending_purged: 1, pending_reverted: 0 });
    expect(await reload(stale.id)).toBeUndefined();
    expect(await reload(fresh.id)).toBeDefined();
    expect(await reload(old.id)).toBeDefined();
    const jobs = await db().select().from(jobsLog).where(eq(jobsLog.job, 'subscribers_purge'));
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ ok: true, detail: { deleted: 1, reverted: 0 } });
    expect(jobs[0].finishedAt).toBeInstanceOf(Date);

    expect(await (await run()).json()).toMatchObject({ ok: true, pending_purged: 0, pending_reverted: 0 });
    expect(await db().select().from(jobsLog).where(eq(jobsLog.job, 'subscribers_purge'))).toHaveLength(2);
  });

  it('a former subscriber with digest history is reverted to unsubscribed, and the purge still deletes strangers', async () => {
    const former = await seed({ status: 'pending', confirmedAt: new Date(Date.now() - 90 * DAY), unsubscribedAt: new Date(Date.now() - 30 * DAY), consentAt: new Date(Date.now() - 8 * DAY) });
    const [issue] = await db().insert(digestIssues).values({ id: newId('dig'), isoWeek: '2026-W30', status: 'sent' }).returning();
    await db().insert(digestSends).values({ issueId: issue.id, subscriberId: former.id, variantKey: 'en:ai' });
    const stranger = await pending({ consentAt: new Date(Date.now() - 8 * DAY) });
    const res = await run();
    expect(await res.json()).toMatchObject({ ok: true, pending_purged: 1, pending_reverted: 1 });
    expect(await reload(former.id)).toMatchObject({ status: 'unsubscribed' });
    expect(await reload(stranger.id)).toBeUndefined();
    const [job] = await db().select().from(jobsLog).where(eq(jobsLog.job, 'subscribers_purge'));
    expect(job).toMatchObject({ ok: true, detail: { deleted: 1, reverted: 1 } });
  });

  it('a purge failure: ok false, counts null, a failed jobs_log row with only the error code, inbox result kept', async () => {
    const logs: unknown[] = [];
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => void logs.push(args));
    await seed({ email: 'private.person@example.org', status: 'pending', confirmedAt: null, consentAt: new Date(Date.now() - 8 * DAY) });
    await (h.client as PGlite).exec('drop table subscribers cascade');
    const res = await run();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: false, job: 'sync', skipped: 'no_feeds', expired: 0, pending_purged: null, pending_reverted: null });
    const jobs = await db().select().from(jobsLog).where(eq(jobsLog.job, 'subscribers_purge'));
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ ok: false, detail: { error: '42P01' } }); // undefined_table
    expect(jobs[0].finishedAt).toBeInstanceOf(Date);
    const logged = JSON.stringify(logs);
    expect(logged).toContain('[cron] subscribers purge failed');
    expect(logged).not.toContain('private.person');
  });

  it('a purge failure without a pg code records the error name', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const real = h.db as DB;
    h.db = new Proxy(real, {
      get: (t, p) => (p === 'update' ? () => { throw new TypeError('driver went away'); } : Reflect.get(t, p)),
    });
    expect(await (await run()).json()).toMatchObject({ ok: false, pending_purged: null, pending_reverted: null });
    h.db = real;
    const [job] = await db().select().from(jobsLog).where(eq(jobsLog.job, 'subscribers_purge'));
    expect(job).toMatchObject({ ok: false, detail: { error: 'TypeError' } });
  });

  it('without a database the response is unchanged and nothing runs', async () => {
    h.db = noDb;
    h.hasDb = false;
    expect(await (await run()).json()).toEqual({ ok: true, job: 'sync', skipped: 'no_database' });
  });
});
