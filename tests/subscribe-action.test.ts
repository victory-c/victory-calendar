import { load } from 'cheerio';
import { eq } from 'drizzle-orm';
import { cloneElement, createElement, isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { testDb } from './helpers/pglite';

// Subscribe flow (guide「订阅」, PRD F06): the Server Action's check order, its anti-enumeration
// answers, the consent record, and the /subscribe page and form markup.
const HUMAN = { isHuman: true, isBot: false, isVerifiedBot: false, bypassed: true };
const h = vi.hoisted(() => ({
  db: null as unknown,
  client: null as unknown,
  hasDb: true,
  headers: new Headers(),
  bot: null as unknown as { isHuman: boolean; isBot: boolean; isVerifiedBot: boolean; bypassed: boolean } | Error,
  botCalls: [] as unknown[],
  sent: [] as { to: string; subject: string; html: string; text: string }[],
  sendError: null as Error | null,
  locale: 'en' as 'en' | 'zh',
  /** Callbacks the action handed to after(): Next runs them once the response has been sent. */
  afters: [] as (() => unknown)[],
}));

vi.mock('@/lib/db', async (orig) => ({
  ...(await orig()),
  // Throws when touched while there is "no database".
  db: new Proxy({}, { get: (_t, p) => Reflect.get((h.db ?? (() => { throw new Error('db touched'); })()) as object, p) }),
  hasDatabase: () => h.hasDb,
}));
vi.mock('next/headers', () => ({ headers: async () => h.headers }));
vi.mock('next/cache', () => ({ refresh: vi.fn(), updateTag: vi.fn(), revalidateTag: vi.fn() }));
vi.mock('next/server', async (orig) => ({
  ...(await orig()),
  connection: async () => {},
  after: (task: (() => unknown) | Promise<unknown>) => void h.afters.push(typeof task === 'function' ? task : () => task),
}));
vi.mock('botid/server', () => ({
  checkBotId: async (cfg: unknown) => {
    h.botCalls.push(cfg);
    if (h.bot instanceof Error) throw h.bot;
    return h.bot;
  },
}));
vi.mock('@/lib/email/send', async (orig) => ({
  ...(await orig()),
  sendEmail: async (msg: { to: string; subject: string; html: string; text: string }) => {
    if (h.sendError) throw h.sendError;
    h.sent.push(msg);
    return { id: 'test' };
  },
}));
vi.mock('@/lib/ratelimit', async (orig) => {
  const real = await orig<typeof import('@/lib/ratelimit')>();
  return { ...real, limit: vi.fn(real.limit) };
});
// Page-level collaborators that need a real request or the intl router.
vi.mock('next-intl/server', () => ({
  getLocale: async () => h.locale,
  getTranslations: async ({ locale, namespace }: { locale: string; namespace: string }) => (key: string) => `${locale}:${namespace}.${key}`,
}));
vi.mock('@/components/PageShell', () => ({
  PageShell: ({ children, path }: { children: ReactNode; path: string }) => createElement('main', { 'data-path': path }, children),
}));
vi.mock('@/components/SubscribeMenu', () => ({
  SubscribeMenu: ({ cats = [] }: { cats?: string[] }) => createElement('details', { id: 'subscribe', 'data-cats': cats.join(',') }),
}));

const { subscribe } = await import('@/app/[locale]/subscribe/actions');
const { default: SubscribePage, generateMetadata } = await import('@/app/[locale]/subscribe/page');
const { SubscribeForm } = await import('@/components/SubscribeForm');
const { initialSubscribeState, MIN_FILL_MS, parseSubscribeParams, sourceFor } = await import('@/lib/newsletter/subscribe-state');
const { _resetMemoryLimits, limit, LIMITS } = await import('@/lib/ratelimit');
const { hashToken } = await import('@/lib/api/token-hash');
const { verifyToken } = await import('@/lib/subscribers/token');
const { newId } = await import('@/lib/ids');
const { subscribers } = await import('@/lib/db/schema');
type DB = import('@/lib/db').DB;
type PGlite = import('@electric-sql/pglite').PGlite;

beforeEach(async () => {
  const t = await testDb();
  h.db = t.db;
  h.client = t.client;
  h.hasDb = true;
  h.headers = new Headers({ 'x-forwarded-for': '203.0.113.7', 'user-agent': 'vitest' });
  h.bot = HUMAN;
  h.botCalls = [];
  h.sent = [];
  h.sendError = null;
  h.locale = 'en';
  h.afters = [];
  _resetMemoryLimits();
  vi.mocked(limit).mockClear();
  vi.stubEnv('SUBSCRIBER_LINK_SECRET', 'test-secret-subscribe-action');
  vi.stubEnv('PUBLIC_HOST', 'picks.test');
  vi.stubEnv('NEWSLETTER_OPEN', '');
  vi.stubEnv('VERCEL', '');
  // F20: going alerts in 'dev' mode (off Vercel), so the form offers the box unless a test turns it off.
  vi.stubEnv('ALERTS_SENDING', '');
  vi.stubEnv('DIGEST_SENDING', '');
  vi.stubEnv('UPSTASH_REDIS_REST_URL', '');
  vi.stubEnv('KV_REST_API_URL', '');
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const db = () => h.db as DB;
const rows = () => db().select().from(subscribers);

type Fields = Record<string, string | string[] | null>;
/** A plausible human submission: filled 10 s ago, honeypot empty. */
function form(over: Fields = {}) {
  const fields: Fields = {
    email: 'reader@example.com',
    c: ['ai', 'hackathon'],
    locale: 'en',
    source: 'subscribe',
    website: '',
    t: String(Date.now() - 10_000),
    ...over,
  };
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) for (const x of v === null ? [] : [v].flat()) fd.append(k, x);
  return fd;
}
/** Run what the action deferred with after(), in order, as Next does after responding. */
async function flush() {
  while (h.afters.length) await h.afters.shift()!();
}
/** One submission, end to end: the action's answer, then its deferred sends. */
const run = async (fd = form()) => {
  const r = await subscribe(initialSubscribeState, fd);
  await flush();
  return r;
};
/** Spend the deployment-wide daily budget for subscription email. */
async function spendDailyBudget() {
  for (let i = 0; i < LIMITS.subscribeSend.max; i++) await limit('subscribeSend', 'all');
  vi.mocked(limit).mockClear();
}
const fromIp = (ip: string | null) => {
  h.headers = new Headers({ 'user-agent': 'vitest', ...(ip ? { 'x-forwarded-for': ip } : {}) });
};
const confirmToken = (text: string) => /https:\/\/picks\.test(?:\/zh)?\/confirm\/(\S+)/.exec(text)?.[1] ?? '';

async function seed(email: string, status: 'pending' | 'active' | 'paused' | 'unsubscribed' | 'suppressed', extra: Partial<typeof subscribers.$inferInsert> = {}) {
  const [row] = await db()
    .insert(subscribers)
    .values({ id: newId('sub'), email, status, locale: 'en', categories: ['vc'], consentAt: new Date(Date.now() - 864e5), ...extra })
    .returning();
  return row;
}

/** Nothing was written, mailed or checked beyond the cheap gates. */
async function expectUntouched() {
  expect(await rows()).toHaveLength(0);
  expect(h.sent).toHaveLength(0);
}

describe('subscribe action: a real sign-up', () => {
  it('writes a pending row with the consent record and mails one confirmation link', async () => {
    h.headers = new Headers({ 'x-forwarded-for': '203.0.113.7, 10.0.0.1', 'user-agent': 'Mozilla/5.0 (test)' });
    const r = await run(form({ email: '  Reader@Example.COM ', c: ['hackathon', 'ai', 'ai'] }));
    expect(r).toEqual({ status: 'pending' });

    const [row] = await rows();
    expect(row).toMatchObject({
      email: 'reader@example.com',
      status: 'pending',
      locale: 'en',
      categories: ['ai', 'hackathon'],
      consentIp: '203.0.113.7',
      consentUa: 'Mozilla/5.0 (test)',
      consentSource: 'subscribe',
      confirmedAt: null,
    });
    expect(Math.abs(row.consentAt!.getTime() - Date.now())).toBeLessThan(10_000);

    expect(h.sent).toHaveLength(1);
    expect(h.sent[0].to).toBe('reader@example.com');
    expect(h.sent[0].subject).toBe("Confirm your subscription · 确认订阅 · Victor's Picks");
    const token = confirmToken(h.sent[0].text);
    expect(token).not.toBe('');
    expect(verifyToken(token, row)).toBe(true);
    expect(h.sent[0].text).not.toContain('reader@example.com'); // links carry the token, never the address
    // Returns state only: no route re-render riding along with the response.
    const cache = await import('next/cache');
    expect(vi.mocked(cache.refresh)).not.toHaveBeenCalled();
    expect(vi.mocked(cache.revalidateTag)).not.toHaveBeenCalled();
  });

  it('F19: facets carried in hidden fields are stored; none without them; unknown values mean none', async () => {
    await run(form({ ev_lang: 'zh', online: '1' }));
    expect((await rows())[0]).toMatchObject({ evLangPref: ['zh'], onlineOnly: true });
    await run(form({ email: 'plain@example.com' }));
    await run(form({ email: 'forged@example.com', ev_lang: 'fr', online: 'yes' }));
    const by = Object.fromEntries((await rows()).map((r) => [r.email, [r.evLangPref, r.onlineOnly]]));
    expect(by['plain@example.com']).toEqual([null, null]);
    expect(by['forged@example.com']).toEqual([null, null]);
  });

  it('answers before mailing: the confirmation goes out only once after() callbacks run', async () => {
    const r = await subscribe(initialSubscribeState, form());
    expect(r).toEqual({ status: 'pending' });
    expect(await rows()).toHaveLength(1); // the write happens before the answer
    expect(h.sent).toHaveLength(0);
    expect(h.afters).toHaveLength(1);
    await flush();
    expect(h.sent).toHaveLength(1);
    expect(h.sent[0].to).toBe('reader@example.com');
  });

  it('existing and suppressed addresses answer the same way; only the deferred part differs', async () => {
    await seed('active@example.com', 'active', { confirmedAt: new Date() });
    await seed('bounced@example.com', 'suppressed');
    for (const email of ['active@example.com', 'bounced@example.com']) {
      fromIp(email.startsWith('a') ? '203.0.113.20' : '203.0.113.21');
      expect(await subscribe(initialSubscribeState, form({ email }))).toEqual({ status: 'pending' });
      expect(h.sent).toHaveLength(0);
    }
    expect(h.afters).toHaveLength(1); // the suppressed address queues nothing
    await flush();
    expect(h.sent.map((m) => m.to)).toEqual(['active@example.com']);
    expect(h.sent[0].subject).toBe("You're already subscribed · 已经订阅过了 · Victor's Picks");
  });

  it('zh page: source zh/subscribe, Chinese emails and /zh links', async () => {
    await run(form({ locale: 'zh', source: 'zh/subscribe' }));
    const [row] = await rows();
    expect(row).toMatchObject({ locale: 'zh', consentSource: 'zh/subscribe' });
    expect(h.sent[0].text).toMatch(/https:\/\/picks\.test\/zh\/confirm\//);
    expect(h.sent[0].text.indexOf('请确认')).toBeLessThan(h.sent[0].text.indexOf('Confirm that'));
    // The subscriber's language leads the subject too.
    expect(h.sent[0].subject).toBe("确认订阅 · Confirm your subscription · Victor's Picks");
  });

  it('the confirmation ends with a /privacy link in the subscriber\'s language', async () => {
    await run();
    expect(h.sent[0].text.split('\n').at(-1)).toBe('Privacy 隐私: https://picks.test/privacy');
    expect(h.sent[0].html).toContain('<a href="https://picks.test/privacy" style="color:#6b7280">Privacy 隐私</a>');
    fromIp('198.51.100.40');
    await run(form({ email: 'zh-reader@example.com', locale: 'zh', source: 'zh/subscribe' }));
    expect(h.sent[1].text.split('\n').at(-1)).toBe('隐私 Privacy: https://picks.test/zh/privacy');
    expect(h.sent[1].html).toContain('href="https://picks.test/zh/privacy"');
  });

  it('the email language is the radio choice, independent of the page it was sent from', async () => {
    await run(form({ locale: 'en', source: 'zh/subscribe' }));
    expect((await rows())[0]).toMatchObject({ locale: 'en', consentSource: 'zh/subscribe' });
  });

  it('tampered fields are coerced, never stored as sent', async () => {
    await run(form({ locale: 'fr', source: 'https://evil.example', c: ['vc', '<script>', 'ai', 'social'] }));
    expect((await rows())[0]).toMatchObject({ locale: 'en', consentSource: 'subscribe', categories: ['ai', 'vc', 'social'] });
  });

  it('an unparseable client IP is stored as null and limited under "unknown"', async () => {
    fromIp('not-an-ip');
    expect(await run()).toEqual({ status: 'pending' });
    expect((await rows())[0].consentIp).toBeNull();
    expect(vi.mocked(limit)).toHaveBeenCalledWith('subscribeIp', 'unknown');
  });

  it('BotID runs in development mode off Vercel and for real on Vercel', async () => {
    await run();
    expect(h.botCalls).toEqual([{ developmentOptions: { isDevelopment: true } }]);
    vi.stubEnv('VERCEL', '1');
    vi.stubEnv('NEWSLETTER_OPEN', '1');
    await run(form({ email: 'second@example.com' }));
    expect(h.botCalls[1]).toEqual({ developmentOptions: { isDevelopment: false } });
  });
});

describe('subscribe action: closed', () => {
  it('NEWSLETTER_OPEN=0 → closed before any check, write or send', async () => {
    vi.stubEnv('NEWSLETTER_OPEN', '0');
    expect(await run()).toEqual({ status: 'closed' });
    await expectUntouched();
    expect(h.botCalls).toHaveLength(0);
    expect(vi.mocked(limit)).not.toHaveBeenCalled();
  });

  it('without a database (CI seed mode) it never touches db', async () => {
    h.hasDb = false;
    h.db = null;
    expect(await run()).toEqual({ status: 'closed' });
    expect(h.sent).toHaveLength(0);
    expect(h.botCalls).toHaveLength(0);
  });

  it('without the link secret no confirmation could be built, so it is closed', async () => {
    vi.stubEnv('SUBSCRIBER_LINK_SECRET', '');
    expect(await run()).toEqual({ status: 'closed' });
    await expectUntouched();
  });

  it('on Vercel without a verified sender it stays closed', async () => {
    vi.stubEnv('VERCEL', '1');
    vi.stubEnv('RESEND_API_KEY', '');
    expect(await run()).toEqual({ status: 'closed' });
    await expectUntouched();
  });
});

describe('subscribe action: bot gates answer like success', () => {
  it('honeypot filled → pending, nothing written, sent, checked or counted', async () => {
    expect(await run(form({ website: 'https://spam.example' }))).toEqual({ status: 'pending' });
    await expectUntouched();
    expect(h.botCalls).toHaveLength(0);
    expect(vi.mocked(limit)).not.toHaveBeenCalled();
  });

  it.each([
    ['missing', () => null],
    ['empty', () => ''],
    ['not a number', () => 'abc'],
    ['under 3 s', () => String(Date.now() - 1000)],
    ['in the future', () => String(Date.now() + 60_000)],
  ])('fill time %s → pending, nothing written', async (_label, t) => {
    expect(await run(form({ t: t() }))).toEqual({ status: 'pending' });
    await expectUntouched();
    expect(h.botCalls).toHaveLength(0);
  });

  it('exactly the minimum fill time is enough', async () => {
    await run(form({ t: String(Date.now() - MIN_FILL_MS) }));
    expect(await rows()).toHaveLength(1);
  });

  it("measures fill time on the browser's own clock when it sends one (clock skew)", async () => {
    const ahead = Date.now() + 120_000; // the visitor's clock runs two minutes fast
    await run(form({ t: String(ahead - 8000), n: String(ahead) }));
    expect(await rows()).toHaveLength(1);
    // Same clock, but submitted one second after the form appeared.
    await run(form({ email: 'quick@example.com', t: String(ahead - 1000), n: String(ahead) }));
    expect(await rows()).toHaveLength(1);
  });

  it('a garbage submit clock falls back to ours', async () => {
    await run(form({ n: 'later' }));
    expect(await rows()).toHaveLength(1);
  });

  it('BotID says bot (verified crawlers included) → bot error, nothing written or counted', async () => {
    h.bot = { isHuman: false, isBot: true, isVerifiedBot: true, bypassed: false };
    expect(await run()).toEqual({ status: 'error', code: 'bot' });
    await expectUntouched();
    expect(vi.mocked(limit)).not.toHaveBeenCalled();
  });
});

describe('subscribe action: limits', () => {
  it('5 per IP per 10 minutes, counted before validation; other IPs unaffected', async () => {
    for (let i = 0; i < 4; i++) expect(await run(form({ email: `r${i}@example.com` }))).toEqual({ status: 'pending' });
    expect(await run(form({ email: 'not an email' }))).toMatchObject({ code: 'invalid_email' });
    expect(await run(form({ email: 'r5@example.com' }))).toEqual({ status: 'rate_limited' });
    expect(await rows()).toHaveLength(4);
    fromIp('198.51.100.9');
    expect(await run(form({ email: 'r6@example.com' }))).toEqual({ status: 'pending' });
    expect(await rows()).toHaveLength(5);
  });

  it('per-IP keys are sha256 hashes, never the raw address (/privacy says so)', async () => {
    h.headers = new Headers({ 'x-forwarded-for': '203.0.113.7, 10.0.0.1', 'user-agent': 'vitest' });
    await run();
    const ipCalls = vi.mocked(limit).mock.calls.filter(([name]) => name === 'subscribeIp' || name === 'subscribeIpDay');
    expect(ipCalls).toEqual([
      ['subscribeIp', hashToken('203.0.113.7')],
      ['subscribeIpDay', hashToken('203.0.113.7')],
    ]);
    expect(JSON.stringify(vi.mocked(limit).mock.calls)).not.toContain('203.0.113');
    // IPv4-mapped IPv6 is the same visitor: clientIp() normalises before hashing.
    fromIp('::ffff:203.0.113.7');
    vi.mocked(limit).mockClear();
    await run(form({ email: 'mapped@example.com' }));
    expect(vi.mocked(limit).mock.calls[0]).toEqual(['subscribeIp', hashToken('203.0.113.7')]);
  });

  it('visitors without a usable IP share one bucket', async () => {
    fromIp(null);
    for (let i = 0; i < 5; i++) await run(form({ email: `n${i}@example.com` }));
    expect(await run(form({ email: 'n5@example.com' }))).toEqual({ status: 'rate_limited' });
  });

  it('3 per address per day, then a silent success with no email; keyed by hash, case-insensitive', async () => {
    const variants = ['reader@example.com', 'Reader@Example.com', ' READER@example.com', 'reader@EXAMPLE.com'];
    for (const [i, email] of variants.entries()) {
      fromIp(`203.0.113.${10 + i}`);
      expect(await run(form({ email }))).toEqual({ status: 'pending' });
    }
    expect(h.sent).toHaveLength(3);
    const emailCalls = vi.mocked(limit).mock.calls.filter(([name]) => name === 'subscribeEmail');
    expect(emailCalls).toHaveLength(4);
    expect(emailCalls.every(([, key]) => key === hashToken('reader@example.com'))).toBe(true);
    expect(JSON.stringify(vi.mocked(limit).mock.calls)).not.toContain('@');
  });
});

describe('subscribe action: one budget per inbox', () => {
  it('plus-tags share the per-address budget: the 4th spelling is a silent success with no row and no email', async () => {
    const variants = ['reader+1@example.com', 'reader+news@example.com', 'reader@example.com', 'reader+x@example.com'];
    for (const email of variants) expect(await run(form({ email }))).toEqual({ status: 'pending' });
    // Stored and mailed as typed, but counted as one inbox.
    expect((await rows()).map((r) => r.email).sort()).toEqual(variants.slice(0, 3).sort());
    expect(h.sent.map((m) => m.to)).toEqual(variants.slice(0, 3));
    const keys = vi.mocked(limit).mock.calls.filter(([name]) => name === 'subscribeEmail').map(([, key]) => key);
    expect(new Set(keys)).toEqual(new Set([hashToken('reader@example.com')]));
  });

  it('Gmail dots and googlemail.com count as the same inbox', async () => {
    const variants = ['v.ictim@gmail.com', 'victim@googlemail.com', 'vic.tim+a@gmail.com', 'victim@gmail.com'];
    for (const email of variants) expect(await run(form({ email }))).toEqual({ status: 'pending' });
    expect(await rows()).toHaveLength(3);
    expect(h.sent).toHaveLength(3);
    expect((await rows()).some((r) => r.email === 'victim@gmail.com')).toBe(false);
  });

  it('outside Gmail a dot is part of the address: separate inboxes, separate budgets', async () => {
    for (let i = 0; i < 3; i++) await limit('subscribeEmail', hashToken('firstlast@example.com'));
    expect(await run(form({ email: 'first.last@example.com' }))).toEqual({ status: 'pending' });
    expect((await rows()).map((r) => r.email)).toEqual(['first.last@example.com']);
    expect(h.sent).toHaveLength(1);
  });
});

describe('subscribe action: daily send budget', () => {
  it('spent → busy before any write or send, after the per-IP checks and without spending the address\'s attempts', async () => {
    await spendDailyBudget();
    expect(await run()).toEqual({ status: 'busy' });
    await expectUntouched();
    expect(h.afters).toHaveLength(0);
    // The budget is only looked at (hasRoom), so "busy" never uses up one of the inbox's 3 a day.
    expect(vi.mocked(limit).mock.calls.map(([name]) => name)).toEqual(['subscribeIp', 'subscribeIpDay']);
    // It says nothing about the address: an existing subscriber gets the same answer, and is left alone.
    const active = await seed('active@example.com', 'active', { confirmedAt: new Date() });
    expect(await run(form({ email: 'active@example.com' }))).toEqual({ status: 'busy' });
    expect((await rows())).toEqual([active]);
    expect(h.sent).toHaveLength(0);
  });

  it('every sign-up that can mail spends one unit; the next one past the cap is busy', async () => {
    for (let i = 0; i < LIMITS.subscribeSend.max - 1; i++) await limit('subscribeSend', 'all');
    expect(await run(form({ email: 'last@example.com' }))).toEqual({ status: 'pending' });
    expect(h.sent).toHaveLength(1);
    fromIp('198.51.100.30');
    expect(await run(form({ email: 'one-too-many@example.com' }))).toEqual({ status: 'busy' });
    expect((await rows()).map((r) => r.email)).toEqual(['last@example.com']);
  });

  it('with the budget spent, even an address past its own limit hears "busy" (global, so it reveals nothing)', async () => {
    for (let i = 0; i < 3; i++) await limit('subscribeEmail', hashToken('reader@example.com'));
    await spendDailyBudget();
    expect(await run(form({ email: 'reader+again@example.com' }))).toEqual({ status: 'busy' });
    await expectUntouched();
  });

  it('a per-address limit hit answers pending while the budget has room', async () => {
    for (let i = 0; i < 3; i++) await limit('subscribeEmail', hashToken('reader@example.com'));
    expect(await run(form({ email: 'reader+again@example.com' }))).toEqual({ status: 'pending' });
    await expectUntouched();
  });

  it('one IP gets at most 10 tries a day, so it cannot spend the whole budget alone', async () => {
    for (let i = 0; i < 10; i++) await limit('subscribeIpDay', hashToken('203.0.113.7'));
    expect(await run(form({ email: 'eleventh@example.com' }))).toEqual({ status: 'rate_limited' });
    await expectUntouched();
  });
});

describe('subscribe action: validation', () => {
  it.each([
    ['invalid', 'not-an-email'],
    ['empty', ''],
    ['missing', null],
    ['too long', `${'a'.repeat(250)}@example.com`],
  ])('%s email → invalid_email on the email field', async (_label, email) => {
    expect(await run(form({ email }))).toEqual({ status: 'error', code: 'invalid_email', field: 'email' });
    await expectUntouched();
  });

  it.each([
    ['none', null],
    ['only unknown slugs', ['nope', 'AI']],
  ])('categories: %s → no_category on the categories field', async (_label, c) => {
    expect(await run(form({ c }))).toEqual({ status: 'error', code: 'no_category', field: 'categories' });
    await expectUntouched();
  });
});

describe('subscribe action: existing addresses look the same from outside', () => {
  it('active or paused: nothing changes, they get their preferences link', async () => {
    const active = await seed('reader@example.com', 'active', { confirmedAt: new Date() });
    const paused = await seed('rest@example.com', 'paused', { confirmedAt: new Date(), pausedUntil: new Date(Date.now() + 864e5) });
    expect(await run(form({ c: ['social'], locale: 'zh', ev_lang: 'zh', online: '1' }))).toEqual({ status: 'pending' });
    expect(await run(form({ email: 'rest@example.com' }))).toEqual({ status: 'pending' });
    const [a] = await db().select().from(subscribers).where(eq(subscribers.id, active.id));
    const [p] = await db().select().from(subscribers).where(eq(subscribers.id, paused.id));
    expect(a).toEqual(active);
    expect(p).toEqual(paused);
    expect(h.sent.map((m) => m.subject)).toEqual([expect.stringContaining('already subscribed'), expect.stringContaining('already subscribed')]);
    expect(h.sent[0].text).toContain('https://picks.test/prefs/');
  });

  it('suppressed: never mailed again, row untouched', async () => {
    const row = await seed('bounced@example.com', 'suppressed');
    expect(await run(form({ email: 'bounced@example.com' }))).toEqual({ status: 'pending' });
    expect(h.sent).toHaveLength(0);
    expect((await rows())[0]).toEqual(row);
  });

  it('pending: re-armed with the new choices and a fresh confirmation', async () => {
    const row = await seed('reader@example.com', 'pending', { evLangPref: ['en'] });
    await run(form({ c: ['cycling'], locale: 'zh', source: 'zh/subscribe', online: '1' }));
    const [again] = await rows();
    expect(again).toMatchObject({
      id: row.id, status: 'pending', categories: ['cycling'], locale: 'zh', consentSource: 'zh/subscribe', evLangPref: null, onlineOnly: true,
    });
    expect(again.consentAt!.getTime()).toBeGreaterThan(row.consentAt!.getTime());
    expect(h.sent).toHaveLength(1);
    expect(verifyToken(confirmToken(h.sent[0].text), again)).toBe(true);
    // The earlier email's link described the earlier choices: it no longer confirms anything.
    expect(again.tokenVersion).toBe(row.tokenVersion + 1);
    expect(verifyToken(confirmToken(h.sent[0].text), row)).toBe(false);
  });

  it('unsubscribed: back to pending, confirm again; the earlier confirmation and opt-out stay on the row', async () => {
    const confirmedAt = new Date(Date.now() - 30 * 864e5);
    const unsubscribedAt = new Date(Date.now() - 864e5);
    await seed('reader@example.com', 'unsubscribed', { unsubscribedAt, confirmedAt, onlineOnly: true });
    await run(form({ ev_lang: 'bilingual' }));
    expect((await rows())[0]).toMatchObject({
      status: 'pending', unsubscribedAt, confirmedAt, categories: ['ai', 'hackathon'], evLangPref: ['bilingual'], onlineOnly: null,
    });
    expect(h.sent[0].subject).toContain('Confirm');
  });
});

describe('subscribe action: going alerts (F20)', () => {
  it('the ticked box is stored and dated from the request; unticked, forged or absent means off', async () => {
    const before = Date.now();
    await run(form({ alerts: '1' }));
    fromIp('203.0.113.30');
    await run(form({ email: 'plain@example.com' }));
    fromIp('203.0.113.31');
    await run(form({ email: 'forged@example.com', alerts: 'on' }));
    const by = Object.fromEntries((await rows()).map((r) => [r.email, r]));
    expect(by['reader@example.com'].goingAlerts).toBe(true);
    expect(by['reader@example.com'].goingAlertsSince!.getTime()).toBeGreaterThanOrEqual(before - 1000);
    expect(by['reader@example.com'].goingAlertsSince).toEqual(by['reader@example.com'].consentAt);
    for (const email of ['plain@example.com', 'forged@example.com']) expect(by[email]).toMatchObject({ goingAlerts: false, goingAlertsSince: null });
  });

  it('a re-request stores the new answer: unticked turns alerts off on a pending row', async () => {
    await seed('reader@example.com', 'pending', { goingAlerts: true, goingAlertsSince: new Date(Date.now() - 864e5) });
    await run(form());
    expect((await rows())[0]).toMatchObject({ status: 'pending', goingAlerts: false, goingAlertsSince: null });
  });

  it.each([
    ['ALERTS_SENDING=0', { ALERTS_SENDING: '0' }],
    ['DIGEST_SENDING=0', { DIGEST_SENDING: '0' }],
  ])('while alerts are off here (%s) the box is ignored and a re-armed row keeps its choice', async (_label, env: Record<string, string>) => {
    for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
    await run(form({ alerts: '1' }));
    expect((await rows())[0]).toMatchObject({ status: 'pending', goingAlerts: false, goingAlertsSince: null });
    await seed('kept@example.com', 'unsubscribed', { goingAlerts: true, goingAlertsSince: new Date(Date.now() - 30 * 864e5) });
    fromIp('203.0.113.32');
    await run(form({ email: 'kept@example.com' }));
    const kept = (await rows()).find((r) => r.email === 'kept@example.com')!;
    // Kept on, but counted from this new request: nothing from before it is ever alerted.
    expect(kept).toMatchObject({ status: 'pending', goingAlerts: true });
    expect(kept.goingAlertsSince).toEqual(kept.consentAt);
  });

  it('active and paused rows are untouched by the box, like every other field', async () => {
    const row = await seed('reader@example.com', 'active', { confirmedAt: new Date() });
    await run(form({ alerts: '1' }));
    expect((await rows())[0]).toEqual(row);
  });

  const ALERTS_EN = 'Going alerts are on too: at most one email a day when Victor marks an event as going.';
  const ALERTS_ZH = '会去提醒也已打开：Victor 标记会去的活动时，每天最多一封。';

  it('the confirmation email names going alerts when the box is ticked (both languages), so the click confirms them too', async () => {
    await run(form({ alerts: '1' }));
    fromIp('203.0.113.33');
    await run(form({ email: 'plain@example.com' }));
    const [ticked, plain] = h.sent;
    for (const part of [ticked.text, ticked.html]) {
      expect(part).toContain(ALERTS_EN);
      expect(part).toContain(ALERTS_ZH);
    }
    for (const part of [plain.text, plain.html]) {
      expect(part).not.toContain(ALERTS_EN);
      expect(part).not.toContain(ALERTS_ZH);
    }
    // After the category line, before the "if this wasn't you" note, in each language's block.
    const lines = ticked.text.split('\n');
    expect(lines.indexOf(ALERTS_EN)).toBe(lines.findIndex((l) => l.startsWith('You picked:')) + 1);
    expect(lines.indexOf(ALERTS_ZH)).toBe(lines.findIndex((l) => l.startsWith('你选了：')) + 1);
  });

  it('a re-request that keeps alerts on (box not shown here) still says so in the confirmation', async () => {
    vi.stubEnv('ALERTS_SENDING', '0');
    await seed('reader@example.com', 'unsubscribed', { confirmedAt: new Date(Date.now() - 30 * 864e5), goingAlerts: true, goingAlertsSince: new Date(Date.now() - 30 * 864e5) });
    await run(form());
    expect((await rows())[0]).toMatchObject({ status: 'pending', goingAlerts: true });
    expect(h.sent[0].text).toContain(ALERTS_EN);
    expect(h.sent[0].text).toContain(ALERTS_ZH);
  });

  it('a stranger re-requesting a pending address with alerts ticked cannot ride on the first email\'s link', async () => {
    await run(form());
    const first = confirmToken(h.sent[0].text);
    fromIp('203.0.113.34');
    await run(form({ alerts: '1', c: ['vc'] }));
    const [row] = await rows();
    expect(row).toMatchObject({ status: 'pending', goingAlerts: true, categories: ['vc'] });
    expect(verifyToken(first, row)).toBe(false);
    // Only the second email, which names the alerts, can confirm them.
    expect(verifyToken(confirmToken(h.sent[1].text), row)).toBe(true);
    expect(h.sent[1].text).toContain(ALERTS_EN);
  });
});

describe('subscribe action: failures', () => {
  const logged = (spy: { mock: { calls: unknown[][] } }) => spy.mock.calls.flat().map(String).join('\n');

  it('a failed send still answers pending (it happens after responding), logged with the address masked', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    h.sendError = new Error('resend: validation_error: cannot send to reader@example.com\nrecipient: reader@example.com', {
      cause: new Error('upstream said no to reader@example.com'),
    });
    const r = await subscribe(initialSubscribeState, form());
    expect(r).toEqual({ status: 'pending' });
    expect(spy).not.toHaveBeenCalled();
    await expect(flush()).resolves.toBeUndefined(); // the deferred send never rejects
    expect(spy).toHaveBeenCalledTimes(1);
    const text = logged(spy);
    expect(text).toContain('[subscribe] send failed for r***@example.com');
    expect(text).toContain('validation_error');
    expect(text).not.toContain('reader@example.com');
    expect(text).not.toContain('recipient:'); // only the first line of each error
    expect((await rows())[0]).toMatchObject({ status: 'pending' }); // the sign-up itself stands
  });

  it('a failed "already subscribed" send is logged the same way and still answers pending', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await seed('reader@example.com', 'active', { confirmedAt: new Date() });
    h.sendError = new Error('resend: rate_limit_exceeded for reader@example.com');
    expect(await run()).toEqual({ status: 'pending' });
    expect(logged(spy)).toContain('send failed for r***@example.com');
    expect(logged(spy)).not.toContain('reader@example.com');
  });

  it('a database error is logged without the query params (address, IP, user agent)', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await (h.client as PGlite).exec('drop table subscribers cascade');
    expect(await run()).toEqual({ status: 'error', code: 'server' });
    const text = logged(spy);
    expect(text).toContain('[subscribe]');
    expect(text).not.toContain('reader@example.com');
    expect(text).not.toContain('203.0.113.7');
    expect(text).not.toContain('vitest');
    expect(text).toContain('relation "subscribers" does not exist'); // the root cause survives the cap
  });

  it('BotID itself failing is logged and skipped: the limits still apply and the sign-up goes through', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    h.bot = new Error("The 'x-vercel-oidc-token' header is missing from the request");
    expect(await run()).toEqual({ status: 'pending' });
    expect(logged(spy)).toContain('[subscribe] BotID unavailable');
    expect(logged(spy)).toContain('x-vercel-oidc-token');
    expect(await rows()).toHaveLength(1);
    expect(h.sent).toHaveLength(1);
    expect(vi.mocked(limit).mock.calls.map(([name]) => name)).toEqual(['subscribeIp', 'subscribeIpDay', 'subscribeEmail', 'subscribeSend']);
  });
});

describe('subscribe-state', () => {
  it('parseSubscribeParams: known slugs in canonical order, merged repeats, only known link problems', () => {
    const none = { evLang: null, onlineOnly: false };
    expect(parseSubscribeParams({})).toEqual({ cats: [], facets: none, link: null });
    expect(parseSubscribeParams({ c: 'vc,bogus,ai' })).toEqual({ cats: ['ai', 'vc'], facets: none, link: null });
    expect(parseSubscribeParams({ c: ['social', 'ai'] })).toEqual({ cats: ['ai', 'social'], facets: none, link: null });
    // F19: facets from a feed menu's link; unknown values are ignored.
    expect(parseSubscribeParams({ c: 'ai', ev_lang: 'zh', online: '1' }).facets).toEqual({ evLang: 'zh', onlineOnly: true });
    expect(parseSubscribeParams({ ev_lang: 'fr', online: 'true' }).facets).toEqual(none);
    expect(parseSubscribeParams({ link: 'expired' }).link).toBe('expired');
    expect(parseSubscribeParams({ link: 'invalid' }).link).toBe('invalid');
    expect(parseSubscribeParams({ link: 'gone' }).link).toBeNull();
    expect(parseSubscribeParams({ link: ['invalid'] }).link).toBeNull();
  });

  it('sourceFor names the page', () => {
    expect(sourceFor('en')).toBe('subscribe');
    expect(sourceFor('zh')).toBe('zh/subscribe');
  });
});

// ---- markup ------------------------------------------------------------------------------------

const copy = {
  email: 'Email', emailPlaceholder: 'you@example.com', categories: 'Categories', categoriesHint: 'Pick at least one.',
  language: 'Email language', submit: 'Subscribe', submitting: 'Sending…', privacy: 'Privacy line', privacyLink: 'How I handle your data',
  honeypot: 'Leave this field empty',
  pending: 'Check your inbox', pendingHint: 'Hint', again: 'Subscribe again',
  errors: { invalid_email: 'bad email', no_category: 'pick one', bot: 'bot', server: 'server', rate_limited: 'slow down', closed: 'closed', busy: 'busy' },
};

describe('SubscribeForm (server render, before hydration)', () => {
  const render = (locale: 'en' | 'zh', categories: ('ai' | 'vc' | 'hackathon')[] = ['ai', 'vc']) =>
    load(renderToStaticMarkup(createElement(SubscribeForm, { locale, categories, copy })));

  it('submit stays disabled until hydration; the fill-time stamp is empty in the shell', () => {
    const $ = render('en');
    expect($('button[type=submit]').attr('disabled')).toBeDefined();
    expect($('button[type=submit]').text()).toBe('Subscribe');
    expect($('input[name=t]').attr('type')).toBe('hidden');
    expect($('input[name=t]').attr('value')).toBeUndefined();
    expect($('form').attr('method')).toBeUndefined();
  });

  it('email field: type, autocomplete, inputmode, required, labelled', () => {
    const $ = render('en');
    const email = $('input[name=email]');
    expect(email.attr()).toMatchObject({ type: 'email', autocomplete: 'email', inputmode: 'email', id: 'subscribe-email' });
    expect(email.attr('required')).toBeDefined();
    expect(email.attr('aria-invalid')).toBeUndefined();
    expect($('label[for=subscribe-email]').text()).toBe('Email');
  });

  it('honeypot is hidden from people and assistive tech, out of the tab order, never autofilled', () => {
    const $ = render('en');
    const trap = $('input[name=website]');
    expect(trap.attr()).toMatchObject({ tabindex: '-1', autocomplete: 'off', type: 'text' });
    expect(trap.attr('value')).toBeUndefined();
    expect(trap.parent().attr('aria-hidden')).toBe('true');
    expect($(`label[for=${trap.attr('id')}]`).text()).toBe('Leave this field empty');
  });

  it('prefills categories and the email language; source names the page', () => {
    const en = render('en', ['ai', 'vc']);
    expect(en('input[name=c]').map((_i, el) => en(el).attr('value')).get()).toHaveLength(7);
    expect(en('input[name=c][checked]').map((_i, el) => en(el).attr('value')).get()).toEqual(['ai', 'vc']);
    expect(en('input[name=locale][checked]').attr('value')).toBe('en');
    expect(en('input[name=source]').attr('value')).toBe('subscribe');

    const zh = render('zh', ['hackathon']);
    expect(zh('input[name=c][checked]').map((_i, el) => zh(el).attr('value')).get()).toEqual(['hackathon']);
    expect(zh('input[name=locale][checked]').attr('value')).toBe('zh');
    expect(zh('input[name=source]').attr('value')).toBe('zh/subscribe');
  });

  it('F20: an unticked going-alerts box when the page passes its label, and none otherwise', () => {
    const $ = load(renderToStaticMarkup(createElement(SubscribeForm, { locale: 'en', categories: ['ai'], copy: { ...copy, goingAlerts: 'Email me when Victor marks an event as going' } })));
    const box = $('input[name=alerts]');
    expect(box.attr()).toMatchObject({ type: 'checkbox', value: '1' });
    expect(box.attr('checked')).toBeUndefined();
    expect(box.closest('label').text()).toBe('Email me when Victor marks an event as going');
    expect(box.closest('label').attr('class')).toMatch(/\bmin-h-11\b/);
    // Before the submit button, inside the form that posts it.
    expect(box.closest('form').find('button[type=submit]')).toHaveLength(1);
    expect(render('en')('input[name=alerts]')).toHaveLength(0);
  });

  it('language names carry their own lang; the status line is a polite live region', () => {
    const $ = render('en');
    expect($('span[lang=en]').text()).toBe('English');
    expect($('span[lang=zh-Hans]').text()).toBe('中文');
    expect($('#subscribe-status').attr()).toMatchObject({ role: 'status', 'aria-live': 'polite' });
    expect($('#subscribe-status').text()).toBe('');
    expect($.text()).toContain('Privacy line');
  });
});

// ---- page --------------------------------------------------------------------------------------

/** Render a server page outside Next: await async components, then render the rest to HTML. */
async function resolve(node: ReactNode): Promise<ReactNode> {
  if (Array.isArray(node)) return Promise.all(node.map(resolve));
  if (!isValidElement(node)) return node;
  const el = node as ReactElement<{ children?: ReactNode }>;
  if (typeof el.type === 'function' && el.type.constructor.name === 'AsyncFunction') {
    return resolve(await (el.type as (p: unknown) => Promise<ReactNode>)(el.props));
  }
  if (el.props.children === undefined) return el;
  return cloneElement(el, undefined, await resolve(el.props.children));
}
const page = async (sp: Record<string, string | string[]> = {}) =>
  load(renderToStaticMarkup((await resolve(await SubscribePage({ searchParams: Promise.resolve(sp) }))) as ReactElement));

describe('/subscribe page', () => {
  it('open: heading, lead and the form with all 7 categories by default', async () => {
    const $ = await page();
    expect($('main').attr('data-path')).toBe('/subscribe');
    expect($('h1').text()).toBe('en:Newsletter.title');
    expect($('form input[name=c][checked]')).toHaveLength(7);
    expect($('#subscribe')).toHaveLength(0);
    expect($.text()).not.toContain('closed.title');
  });

  it('F20: the going-alerts box only while alerts can be sent (dev here; never with ALERTS_SENDING=0)', async () => {
    const on = await page();
    expect(on('form input[name=alerts]')).toHaveLength(1);
    expect(on('form input[name=alerts]').closest('label').text()).toBe('en:Newsletter.form.goingAlerts');
    vi.stubEnv('ALERTS_SENDING', '0');
    expect((await page())('input[name=alerts]')).toHaveLength(0);
  });

  it('open: ?c= preselects those categories; zh page preselects 中文', async () => {
    h.locale = 'zh';
    const $ = await page({ c: 'vc,cycling,bogus' });
    expect($('input[name=c][checked]').map((_i, el) => $(el).attr('value')).get()).toEqual(['vc', 'cycling']);
    expect($('input[name=locale][checked]').attr('value')).toBe('zh');
    expect($('h1').text()).toBe('zh:Newsletter.title');
  });

  it('?link=expired / ?link=invalid show the notice above the form', async () => {
    const expired = await page({ link: 'expired' });
    expect(expired.text()).toContain('en:Newsletter.link.expired');
    const invalid = await page({ link: 'invalid' });
    expect(invalid.text()).toContain('en:Newsletter.link.invalid');
    expect((await page({ link: 'other' })).text()).not.toContain('Newsletter.link.');
  });

  it('closed: closed copy plus one calendar menu for the ?c= picks, and no form', async () => {
    vi.stubEnv('NEWSLETTER_OPEN', '0');
    const $ = await page({ c: 'ai', link: 'invalid' });
    expect($('form')).toHaveLength(0);
    expect($('h2').text()).toBe('en:Newsletter.closed.title');
    expect($.text()).toContain('en:Newsletter.closed.body');
    expect($('#subscribe')).toHaveLength(1);
    expect($('#subscribe').attr('data-cats')).toBe('ai');
    expect($.text()).toContain('en:Newsletter.link.invalid');
  });

  it('closed in seed mode (no database) without touching it', async () => {
    h.hasDb = false;
    h.db = null;
    const $ = await page();
    expect($('form')).toHaveLength(0);
    expect($('#subscribe').attr('data-cats')).toBe('');
  });

  it('metadata: canonical /subscribe; noindex only while closed', async () => {
    const open = await generateMetadata();
    expect(open.robots).toBeUndefined();
    expect(open.alternates?.canonical).toBe('https://picks.test/subscribe');
    expect(open.description).toBe('en:Newsletter.metaDescription');
    vi.stubEnv('NEWSLETTER_OPEN', '0');
    expect((await generateMetadata()).robots).toEqual({ index: false, follow: true });
  });
});
