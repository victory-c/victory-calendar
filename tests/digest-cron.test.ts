import { createHmac } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { testDb } from './helpers/pglite';

// GET /api/cron/digest (auth, gates, jobs_log, no addresses in the response) and the week 14
// additions to the Resend webhook: email.failed on a digest email, and suppression by the `sub` tag.
// The renderer and assembler are small doubles; tests/digest-send.test.ts covers the pipeline.

const h = vi.hoisted(() => ({ db: null as unknown, hasDb: true, runThrows: null as Error | null, tooLarge: null as string | null }));
vi.mock('@/lib/db', async (orig) => ({
  ...(await orig()),
  db: new Proxy({}, { get: (_t, p) => Reflect.get(h.db as object, p) }),
  hasDatabase: () => h.hasDb,
}));

vi.mock('@/lib/digest/assemble', () => ({
  buildSnapshot: async (issue: { id: string; isoWeek: string }) => {
    if (h.runThrows) throw h.runThrows;
    return {
      version: 1, issueId: issue.id, isoWeek: issue.isoWeek, from: '', to: '', previewWeek: '', sendAfter: '', origin: 'https://picks.test',
      introEn: null, introZh: null, showAttendance: true, events: [{ id: 'evt_1', category: 'ai', titleEn: 'AI night' }], preview: [],
    };
  },
}));
vi.mock('@/lib/digest/render', async (orig) => {
  // The real module's constants and DigestTooLargeError (run.ts tells too_large apart by its class).
  const real = await orig<typeof import('@/lib/digest/render')>();
  const T = real.TOKEN;
  const mail = (subject: string, origin: string) => {
    const html = `<!doctype html><html><body><a href="${origin}/prefs/${T}">prefs</a></body></html>`;
    return { subject, preheader: '', html, text: `${origin}/prefs/${T}`, bytes: html.length, picks: 1, going: 0 };
  };
  return {
    ...real,
    renderVariant: async (snap: { origin: string }, v: { key: string }) => {
      if (h.tooLarge === v.key) throw new real.DigestTooLargeError('digest html is 95000 bytes (limit 90000)');
      return mail(`picks ${v.key}`, snap.origin);
    },
    renderEmptyNotice: async (snap: { origin: string }, v: { key: string }) => mail(`empty ${v.key}`, snap.origin),
    personalize: (e: { subject: string; html: string; text: string }, token: string) => ({
      subject: e.subject, html: e.html.replaceAll(T, token), text: e.text.replaceAll(T, token),
    }),
  };
});

const cronRoute = await import('@/app/api/cron/digest/route');
const webhookRoute = await import('@/app/api/webhooks/resend/route');
const { digestIssues, digestSends, jobsLog, subscribers } = await import('@/lib/db/schema');
const { newId } = await import('@/lib/ids');
const { suppressSubscriberIds } = await import('@/lib/subscribers/service');
type DB = import('@/lib/db').DB;

const HOUR = 3600_000;
const DAY = 864e5;
const db = () => h.db as DB;
let n = 0;

beforeEach(async () => {
  h.db = (await testDb()).db;
  h.hasDb = true;
  h.runThrows = null;
  h.tooLarge = null;
  vi.stubEnv('SUBSCRIBER_LINK_SECRET', 'test-secret-cron-0123456789');
  vi.stubEnv('CRON_SECRET', 'cron-secret');
  // Local/CI: dev mode (log transport), never Resend.
  vi.stubEnv('VERCEL', '');
  vi.stubEnv('RESEND_API_KEY', '');
  vi.stubEnv('RESEND_FROM', '');
  vi.stubEnv('DIGEST_SENDING', '');
  vi.stubEnv('DIGEST_DAILY_CAP', '');
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

async function seedSub(over: Partial<typeof subscribers.$inferInsert> = {}) {
  const [row] = await db()
    .insert(subscribers)
    .values({
      id: newId('sub'), email: `reader${++n}@example.org`, status: 'active', locale: 'en', categories: ['ai'],
      consentAt: new Date(Date.now() - 9 * DAY), confirmedAt: new Date(Date.now() - 9 * DAY), ...over,
    })
    .returning();
  return row;
}
async function seedIssue(over: Partial<typeof digestIssues.$inferInsert> = {}) {
  const [row] = await db()
    .insert(digestIssues)
    .values({ id: newId('dig'), isoWeek: '2026-W42', status: 'scheduled', sendAfter: new Date(Date.now() - HOUR), ...over })
    .returning();
  return row;
}
const jobs = () => db().select().from(jobsLog).where(eq(jobsLog.job, 'digest'));
const reloadSub = async (id: string) => (await db().select().from(subscribers).where(eq(subscribers.id, id)))[0];

/** Every console line, as the log drain would see it. */
function captureLogs() {
  const logs: string[] = [];
  for (const level of ['log', 'info', 'warn', 'error', 'debug'] as const) {
    vi.spyOn(console, level).mockImplementation((...args: unknown[]) => void logs.push(args.map(String).join(' ')));
  }
  return () => logs.join('\n');
}

describe('GET /api/cron/digest', () => {
  const run = (auth = 'Bearer cron-secret') => cronRoute.GET(new Request('http://localhost/api/cron/digest', { headers: { authorization: auth } }));

  it('allows the full 300 s (work stops being started at 240 s)', () => {
    expect(cronRoute.maxDuration).toBe(300);
  });

  it('401 without the cron secret; nothing is touched', async () => {
    const issue = await seedIssue();
    await seedSub();
    expect((await run('Bearer nope')).status).toBe(401);
    vi.stubEnv('CRON_SECRET', '');
    expect((await run('Bearer ')).status).toBe(401);
    expect((await db().select().from(digestIssues).where(eq(digestIssues.id, issue.id)))[0].status).toBe('scheduled');
    expect(await db().select().from(digestSends)).toHaveLength(0);
  });

  it('without a database: skipped, no query', async () => {
    h.db = new Proxy({}, { get: () => { throw new Error('database touched'); } });
    h.hasDb = false;
    const res = await run();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, job: 'digest', skipped: 'no_database' });
  });

  it('on Vercel without a verified sender: skipped before claiming or changing any status, no jobs_log row', async () => {
    vi.stubEnv('VERCEL', '1');
    const issue = await seedIssue();
    await seedSub();
    const res = await run();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, job: 'digest', skipped: 'no_verified_sender', sent: 0 });
    expect((await db().select().from(digestIssues).where(eq(digestIssues.id, issue.id)))[0]).toMatchObject({ status: 'scheduled', snapshot: null });
    expect(await db().select().from(digestSends)).toHaveLength(0);
    expect(await jobs()).toHaveLength(0);
  });

  it('nothing due: a 200 and no jobs_log row (daily no-op runs are noise)', async () => {
    await seedIssue({ status: 'draft' });
    const res = await run();
    expect(await res.json()).toMatchObject({ ok: true, job: 'digest', skipped: 'nothing_due' });
    expect(await jobs()).toHaveLength(0);
  });

  it('a due issue is sent (dev transport) and logged once, with counts and no addresses', async () => {
    const text = captureLogs();
    const issue = await seedIssue();
    await seedSub({ email: 'private.person@example.org' });
    await seedSub({ categories: ['cycling'], locale: 'zh' }); // gets the month's empty notice
    const res = await run();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, job: 'digest', issue: '2026-W42', status: 'sent', claimed: 2, sent: 2, emptyNotices: 1, failed: 0 });
    expect(JSON.stringify(body)).not.toContain('@');
    const [job] = await jobs();
    expect(job).toMatchObject({ ok: true, detail: { issue: '2026-W42', sent: 2, emptyNotices: 1 } });
    expect(job.finishedAt).toBeInstanceOf(Date);
    expect(JSON.stringify(job.detail)).not.toContain('@');
    expect((await db().select().from(digestSends).where(eq(digestSends.issueId, issue.id))).every((r) => r.resendId === 'dev')).toBe(true);
    expect(text()).toContain('[digest:dev] batch n=2');
    expect(text()).not.toContain('private.person');
    // The second cron of the night has nothing left to do.
    expect(await (await run()).json()).toMatchObject({ ok: true, skipped: 'nothing_due' });
    expect(await jobs()).toHaveLength(1);
  });

  it('a missed issue (past the late limit) is logged as too_late and left scheduled', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const issue = await seedIssue({ sendAfter: new Date(Date.now() - 28 * HOUR) });
    await seedSub();
    expect(await (await run()).json()).toMatchObject({ ok: true, tooLate: ['2026-W42'] });
    expect(await jobs()).toMatchObject([{ ok: true, detail: { tooLate: ['2026-W42'] } }]);
    expect((await db().select().from(digestIssues).where(eq(digestIssues.id, issue.id)))[0].status).toBe('scheduled');
  });

  it('a failure is a 500 with a failed jobs_log row carrying only an error code', async () => {
    const text = captureLogs();
    await seedIssue();
    await seedSub({ email: 'private.person@example.org' });
    h.runThrows = new TypeError('cannot assemble for private.person@example.org');
    const res = await run();
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ ok: false, job: 'digest', reason: 'TypeError', sent: 0 });
    const [job] = await jobs();
    expect(job).toMatchObject({ ok: false, detail: { reason: 'TypeError' } });
    expect(text()).toContain('[cron] digest failed');
    expect(text()).toContain('p***@example.org');
    expect(text()).not.toContain('private.person');
  });

  it('a variant that cannot be built fails the run: 500 and a failed jobs_log row with counts per variant', async () => {
    const text = captureLogs();
    const issue = await seedIssue();
    await seedSub({ email: 'private.person@example.org' });
    await seedSub({ locale: 'zh' });
    h.tooLarge = 'zh:ai';
    const res = await run();
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toMatchObject({
      ok: false, reason: 'render_failed', status: 'sent', sent: 1, failed: 1, buildFailures: { 'digest|zh:ai': { error: 'too_large', rows: 1 } },
    });
    expect(JSON.stringify(body)).not.toContain('@');
    const [job] = await jobs();
    expect(job).toMatchObject({ ok: false, detail: { reason: 'render_failed', buildFailures: { 'digest|zh:ai': { error: 'too_large', rows: 1 } } } });
    expect(JSON.stringify(job.detail)).not.toContain('@');
    expect((await db().select().from(digestSends).where(eq(digestSends.issueId, issue.id))).map((r) => r.error).sort()).toEqual([null, 'too_large']);
    expect(text()).not.toContain('private.person');
  });

  it('a stop error (no link secret) is a failed run: logged, 500', async () => {
    vi.stubEnv('SUBSCRIBER_LINK_SECRET', '');
    await seedIssue();
    const res = await run();
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ ok: false, reason: 'no_link_secret' });
    expect(await jobs()).toMatchObject([{ ok: false, detail: { reason: 'no_link_secret' } }]);
  });
});

describe('POST /api/webhooks/resend: digest emails', () => {
  const SECRET = `whsec_${Buffer.from('0123456789abcdef0123456789abcdef').toString('base64')}`;
  beforeEach(() => vi.stubEnv('RESEND_WEBHOOK_SECRET', SECRET));

  function signed(evt: unknown) {
    const payload = JSON.stringify(evt);
    const ts = Math.floor(Date.now() / 1000);
    const id = `msg_${++n}`;
    const sig = createHmac('sha256', Buffer.from(SECRET.replace(/^whsec_/, ''), 'base64')).update(`${id}.${ts}.${payload}`).digest('base64');
    return new Request('http://localhost/api/webhooks/resend', {
      method: 'POST',
      body: payload,
      headers: { 'content-type': 'application/json', 'svix-id': id, 'svix-timestamp': String(ts), 'svix-signature': `v1,${sig}` },
    });
  }
  const event = (type: string, to: string[], tags: Record<string, string> | undefined, extra: Record<string, unknown> = {}) => ({
    type,
    created_at: new Date().toISOString(),
    data: {
      email_id: 'em_1', message_id: '<m1@example.org>', from: 'picks@example.org', to, subject: 'This week', created_at: new Date().toISOString(),
      ...(tags ? { tags } : {}), ...extra,
    },
  });
  const post = (evt: unknown) => webhookRoute.POST(signed(evt));

  async function sentDigest() {
    const sub = await seedSub();
    const issue = await seedIssue({ status: 'sending' });
    await db().insert(digestSends).values({ issueId: issue.id, subscriberId: sub.id, variantKey: 'en:ai', resendId: 're_1', sentAt: new Date(), batchKey: 'dbk_1' });
    const row = async () => (await db().select().from(digestSends).where(eq(digestSends.issueId, issue.id)))[0];
    return { sub, issue, row, tags: { kind: 'digest', issue: issue.id, sub: sub.id } };
  }

  it('email.failed on a digest email records failed:<reason> on that row; a replay changes nothing', async () => {
    const { sub, row, tags } = await sentDigest();
    const evt = event('email.failed', [sub.email], tags, { failed: { reason: 'reached_daily_quota' } });
    const res = await post(evt);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, failed: 1 });
    expect(await row()).toMatchObject({ error: 'failed:reached_daily_quota', resendId: 're_1' });
    expect(await (await post(evt)).json()).toEqual({ ok: true, failed: 0 });
    expect((await reloadSub(sub.id)).status).toBe('active'); // a failure is not a bounce
  });

  it('an unexpected failure reason is stored as failed:other', async () => {
    const { sub, row, tags } = await sentDigest();
    await post(event('email.failed', [sub.email], tags, { failed: { reason: 'Something <odd> for x@example.org' } }));
    expect((await row()).error).toBe('failed:other');
  });

  it('email.failed without valid digest tags is a 200 no-op', async () => {
    const { sub, issue, row } = await sentDigest();
    for (const tags of [
      undefined,
      { kind: 'magic_link', issue: issue.id, sub: sub.id },
      { kind: 'digest', issue: 'dig_bad', sub: sub.id },
      { kind: 'digest', issue: issue.id, sub: "sub_x' or 1=1" },
    ]) {
      const res = await post(event('email.failed', [sub.email], tags, { failed: { reason: 'reached_daily_quota' } }));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true });
    }
    expect((await row()).error).toBeNull();
  });

  it('without a database a digest email.failed is a 503 so Resend retries', async () => {
    const { sub, tags } = await sentDigest();
    h.hasDb = false;
    expect((await post(event('email.failed', [sub.email], tags, { failed: { reason: 'x' } }))).status).toBe(503);
  });

  it('a hard bounce suppresses the tagged subscriber by id even when the address does not match', async () => {
    const { sub, tags } = await sentDigest();
    const res = await post(event('email.bounced', ['Some Alias <alias@example.net>'], tags, { bounce: { type: 'Permanent', subType: 'General', message: 'x' } }));
    expect(await res.json()).toEqual({ ok: true, suppressed: 1 });
    expect(await reloadSub(sub.id)).toMatchObject({ status: 'suppressed', pausedUntil: null });
  });

  it('a complaint matching both the address and the tag counts once; replays are harmless', async () => {
    const { sub, tags } = await sentDigest();
    const evt = event('email.complained', [sub.email], tags);
    expect(await (await post(evt)).json()).toEqual({ ok: true, suppressed: 1 });
    expect(await (await post(evt)).json()).toEqual({ ok: true, suppressed: 0 });
    expect((await reloadSub(sub.id)).status).toBe('suppressed');
  });

  it('a transient bounce suppresses nobody, tag or not; a malformed sub tag is ignored', async () => {
    const { sub, tags } = await sentDigest();
    await post(event('email.bounced', [sub.email], tags, { bounce: { type: 'Transient', subType: 'General', message: 'x' } }));
    expect((await reloadSub(sub.id)).status).toBe('active');
    const other = await seedSub();
    const res = await post(event('email.suppressed', ['nobody@example.org'], { kind: 'digest', sub: `${other.id}x` }, { suppressed: { type: 'x', message: 'x' } }));
    expect(await res.json()).toEqual({ ok: true, suppressed: 0 });
    expect((await reloadSub(other.id)).status).toBe('active');
  });

  it('logs never carry an address', async () => {
    const text = captureLogs();
    const { tags } = await sentDigest();
    await post(event('email.failed', ['private.person@example.org'], tags, { failed: { reason: 'reached_daily_quota' } }));
    await post(event('email.complained', ['private.person@example.org'], tags));
    expect(text()).toContain('[webhook:resend]');
    expect(text()).not.toContain('private.person');
  });
});

describe('suppressSubscriberIds', () => {
  it('suppresses well-formed ids only, once, and clears a pause', async () => {
    const a = await seedSub({ status: 'paused', pausedUntil: new Date(Date.now() + DAY) });
    const b = await seedSub({ status: 'suppressed' });
    expect(await suppressSubscriberIds([a.id, a.id, b.id, 'nope', `${a.id} `], { db: db() })).toBe(1);
    expect(await reloadSub(a.id)).toMatchObject({ status: 'suppressed', pausedUntil: null });
    expect(await suppressSubscriberIds([], { db: db() })).toBe(0);
  });
});
