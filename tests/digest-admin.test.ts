import { MockLanguageModelV4 } from 'ai/test';
import { eq } from 'drizzle-orm';
import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BatchEmail, BatchErr, BatchOk } from '@/lib/digest/transport';
import { testDb } from './helpers/pglite';

// /admin/digest (builder D): the editor's Server Action on PGlite with the real issue lifecycle,
// assembly and renderer. Mocked: the admin session, next/cache + after(), sendEmail (captured),
// the Resend batch transport (captured; seed sends), the model call, and runDigest (the send
// pipeline has its own tests). The clock is pinned to Monday 2026-10-05 11:00 PDT, so the upcoming
// issue is 2026-W42 (sent Sun Oct 11 17:00 PDT).
const h = vi.hoisted(() => ({
  db: null as unknown,
  sent: [] as { to: string; subject: string; html: string; text: string; headers?: Record<string, string>; tags?: { name: string; value: string }[] }[],
  batches: [] as { emails: BatchEmail[]; key: string; mode: string }[],
  /** The next batch outcome; null = every email accepted. */
  batchResult: null as null | ((emails: BatchEmail[]) => BatchOk | BatchErr),
  afters: [] as (() => unknown)[],
  refreshes: 0,
  path: '/admin/digest',
}));

vi.mock('@/lib/db', async (orig) => ({
  ...(await orig()),
  db: new Proxy({}, { get: (_t, p) => Reflect.get(h.db as object, p) }),
  hasDatabase: () => true,
}));
vi.mock('@/lib/admin-session', () => ({ requireAdmin: vi.fn(async () => ({ user: { email: 'victor@example.org' } })) }));
vi.mock('next/cache', () => ({ refresh: () => void h.refreshes++, updateTag: vi.fn(), revalidateTag: vi.fn() }));
vi.mock('next/server', async (orig) => ({
  ...(await orig()),
  after: (task: (() => unknown) | Promise<unknown>) => void h.afters.push(typeof task === 'function' ? task : () => task),
}));
vi.mock('@/lib/email/send', async (orig) => ({
  ...(await orig()),
  sendEmail: async (msg: (typeof h.sent)[number]) => {
    h.sent.push(msg);
    return { id: 'test' };
  },
}));
vi.mock('@/lib/digest/transport', async (orig) => ({
  ...(await orig()),
  resendTransport: () => async (emails: BatchEmail[], key: string, mode: string) => {
    h.batches.push({ emails, key, mode });
    return h.batchResult?.(emails) ?? { ok: true, ids: emails.map((_, i) => `re_${i}`), invalid: [], dailyUsed: null };
  },
}));
vi.mock('@/lib/admin/ai', async (orig) => ({ ...(await orig()), retranslate: vi.fn() }));
vi.mock('@/lib/digest/run', async (orig) => ({ ...(await orig()), runDigest: vi.fn() }));
// Markup tests render outside the App Router.
vi.mock('next/navigation', () => ({ usePathname: () => h.path, redirect: vi.fn() }));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => createElement('a', { href, ...rest }, children),
}));
vi.mock('next/form', () => ({
  default: ({ action, children, ...rest }: { action: string; children: ReactNode }) => createElement('form', { action, method: 'get', ...rest }, children),
}));

const { digestAction } = await import('@/app/admin/digest-actions');
const { requireAdmin } = await import('@/lib/admin-session');
const { retranslate } = await import('@/lib/admin/ai');
const { runDigest } = await import('@/lib/digest/run');
const { buildSnapshot } = await import('@/lib/digest/assemble');
const { ensureIssue, getIssue } = await import('@/lib/digest/issues');
const { LATE_LIMIT_MS, sendAfterFor, upcomingIssueWeek } = await import('@/lib/digest/week');
const { _resetMemoryLimits, LIMITS } = await import('@/lib/ratelimit');
const { verifyToken } = await import('@/lib/subscribers/token');
const { templateCoverRow } = await import('@/lib/covers/template');
const { newId } = await import('@/lib/ids');
const { covers, digestIssues, digestSends, events, jobsLog, settings, subscribers } = await import('@/lib/db/schema');
const { renderEmptyNotice, renderVariant } = await import('@/lib/digest/render');
const { parseVariantKey } = await import('@/lib/digest/variant');
const { emailKey, renderPerEmail } = await import('@/app/admin/(app)/digest/audience');
const { DigestEditor } = await import('@/components/admin/DigestEditor');
const { DigestPreview } = await import('@/components/admin/DigestPreview');
const { WeChatExport } = await import('@/components/admin/WeChatExport');
const { TabBar } = await import('@/components/admin/TabBar');
const { EXPECTED_SEED_DOMAINS, MAX_SEEDS, seedCoverage, seedEmails } = await import('@/lib/digest/seeds');
const { liveState, wechatText } = await import('@/lib/digest/wechat');
const { publicEvents } = await import('@/lib/events/public-rows');
const { showAttendance } = await import('@/lib/settings');
const { revalidateTag } = await import('next/cache');
type DB = import('@/lib/db').DB;
type NewEvent = import('@/lib/db/schema').NewEvent;
type EditorProps = import('@/components/admin/DigestEditor').DigestEditorProps;
type PreviewProps = Parameters<typeof DigestPreview>[0];
type Variant = import('@/lib/digest/variant').Variant;
type DigestSnapshot = import('@/lib/digest/types').DigestSnapshot;

const NOW = new Date('2026-10-05T18:00:00Z'); // Mon Oct 5, 11:00 PDT
const W = '2026-W42';
const SEND_AFTER = new Date('2026-10-12T00:00:00Z'); // Sun Oct 11 17:00 PDT
const ADMIN = 'victor@example.org';
const DUMMY = `sub_${'0'.repeat(16)}.${'A'.repeat(43)}`;

const db = () => h.db as DB;
const reload = async (id: string) => (await getIssue(id, { db: db() }))!;

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  h.db = (await testDb()).db;
  h.sent = [];
  h.batches = [];
  h.batchResult = null;
  h.afters = [];
  h.refreshes = 0;
  h.path = '/admin/digest';
  _resetMemoryLimits();
  vi.mocked(retranslate).mockReset();
  vi.mocked(runDigest).mockReset();
  vi.mocked(requireAdmin).mockClear();
  vi.mocked(revalidateTag).mockClear();
  vi.stubEnv('PUBLIC_HOST', 'picks.test');
  vi.stubEnv('SUBSCRIBER_LINK_SECRET', 'test-secret-digest-admin-0123456789');
  vi.stubEnv('ADMIN_EMAIL', ADMIN);
  vi.stubEnv('RESEND_API_KEY', '');
  vi.stubEnv('RESEND_FROM', '');
  vi.stubEnv('VERCEL', '');
  vi.stubEnv('DIGEST_SENDING', '');
  vi.stubEnv('DIGEST_SEED_EMAILS', '');
  vi.stubEnv('SHOW_ATTENDANCE', '');
  vi.stubEnv('UPSTASH_REDIS_REST_URL', '');
  vi.stubEnv('KV_REST_API_URL', '');
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

/** A published event with the cover row a published event needs. */
async function addEvent(over: Partial<NewEvent> & { official?: boolean } = {}) {
  const { official = false, ...rest } = over;
  const id = rest.id ?? newId('evt');
  const category = rest.category ?? 'ai';
  const coverId = newId('cov');
  await db().insert(covers).values(
    official
      ? {
          id: coverId, kind: 'official', url1600: `https://blob.test/${id}-1600.webp`, url800: `https://blob.test/${id}-800.webp`,
          url400: `https://blob.test/${id}-400.webp`, urlOgEn: '', urlOgZh: '', thumbhash: 'x', dominant: '#000000', bytes: 1,
        }
      : { id: coverId, ...templateCoverRow(category, null) },
  );
  await db().insert(events).values({
    slug: `event-${id}`, status: 'published', sourceUrl: `https://luma.com/${id.slice(4)}`, titleEn: `Agent Night ${id.slice(-4)}`,
    titleZh: `Agent 之夜 ${id.slice(-4)}`, noteEn: 'Worth it for the demos', noteZh: '值得去看 demo',
    startAt: new Date('2026-10-14T01:30:00Z'), tz: 'America/Los_Angeles', city: 'San Francisco', format: 'in_person', going: 'interested',
    publishedAt: NOW, ...rest, id, category, coverId,
  });
  return id;
}

/** W42 with one going AI event, one hackathon, and a featured AI event in the preview week (W43). */
async function seedWeek() {
  const going = await addEvent({ going: 'going', goingVisibility: 'public', official: true });
  const hack = await addEvent({ category: 'hackathon', startAt: new Date('2026-10-17T17:00:00Z'), noteZh: null });
  const next = await addEvent({ featured: true, startAt: new Date('2026-10-21T01:00:00Z') });
  const issue = await ensureIssue(W, { db: db() });
  return { issue, going, hack, next };
}

function form(op: string, fields: Record<string, string | string[]> = {}) {
  const fd = new FormData();
  fd.set('_op', op);
  for (const [k, v] of Object.entries(fields)) for (const x of [v].flat()) fd.append(k, x);
  return fd;
}
const act = (id: string, op: string, fields: Record<string, string | string[]> = {}) => digestAction(id, null, form(op, fields));
const BOTH = { introEn: 'Big week for agents.\nTwo hackathons.', introZh: '这周 agent 活动很多。\n还有两场黑客松。' };

async function scheduled(fields: Record<string, string> = BOTH) {
  const s = await seedWeek();
  expect(await act(s.issue.id, 'schedule', fields)).toMatchObject({ ok: true });
  return { ...s, issue: await reload(s.issue.id) };
}

describe('setup', () => {
  it('pins the clock to a Monday whose upcoming issue is W42', () => {
    expect(upcomingIssueWeek(new Date())).toBe(W);
    expect(sendAfterFor(W)).toEqual(SEND_AFTER);
  });

  it('adds the digestTest limit: 10 a day, and digestSeed: 4 rounds a day', () => {
    expect(LIMITS.digestTest).toEqual({ max: 10, window: '1 d' });
    expect(LIMITS.digestSeed).toEqual({ max: 4, window: '1 d' });
  });
});

describe('save', () => {
  it('saves both intros (CRLF → LF), the featured preview and the kept Luma covers', async () => {
    const { issue, going, next } = await seedWeek();
    expect(issue.featuredIds).toEqual([next]); // prefilled from events.featured
    const r = await act(issue.id, 'save', {
      introEn: '  Line one\r\nLine two  ', introZh: '第一行\r\n第二行', featured_present: '1', featured: next, keep_present: '1', keep: going,
    });
    expect(r).toEqual({ ok: true, message: 'Saved · 已保存' });
    const row = await reload(issue.id);
    expect(row).toMatchObject({ introEn: 'Line one\nLine two', introZh: '第一行\n第二行', featuredIds: [next], keepCoverIds: [going], status: 'draft' });
    expect(h.refreshes).toBe(1);
    // The same text again (as a browser posts it) is not a change.
    expect(await act(issue.id, 'save', { introEn: 'Line one\r\nLine two', introZh: '第一行\n第二行', featured_present: '1', featured: next, keep_present: '1', keep: going })).toEqual({
      ok: true,
      message: 'No changes · 没有改动',
    });
  });

  it('keeps id lists that were not on screen, and empties them when every box is unticked', async () => {
    const { issue, going, next } = await seedWeek();
    await act(issue.id, 'save', { keep_present: '1', keep: going });
    await act(issue.id, 'save', { introEn: 'Hello' }); // no *_present fields: lists untouched
    expect(await reload(issue.id)).toMatchObject({ introEn: 'Hello', featuredIds: [next], keepCoverIds: [going] });
    await act(issue.id, 'save', { featured_present: '1', keep_present: '1' });
    expect(await reload(issue.id)).toMatchObject({ featuredIds: [], keepCoverIds: [] });
  });

  it('ignores featured ids that are not published events of the preview week', async () => {
    const { issue, going, next } = await seedWeek();
    await act(issue.id, 'save', { featured_present: '1', featured: [next, going, 'evt_doesnotexist0000', '<script>'] });
    expect((await reload(issue.id)).featuredIds).toEqual([next]);
  });

  it('refuses to edit a scheduled issue', async () => {
    const { issue } = await scheduled();
    for (const op of ['save', 'draft:zh', 'approve:en']) {
      expect(await act(issue.id, op, { introEn: 'Changed' })).toMatchObject({ ok: false, message: expect.stringContaining('撤回排期后才能修改') });
    }
    expect((await reload(issue.id)).introEn).toBe(BOTH.introEn);
    expect(retranslate).not.toHaveBeenCalled();
  });

  it('reports an unknown issue', async () => {
    expect(await act('dig_nope', 'save', BOTH)).toMatchObject({ ok: false, message: expect.stringContaining('找不到') });
  });

  it('checks the admin session before anything else', async () => {
    const { issue } = await seedWeek();
    vi.mocked(requireAdmin).mockRejectedValueOnce(Object.assign(new Error('NEXT_REDIRECT'), { digest: 'NEXT_REDIRECT;replace;/admin/sign-in' }));
    await expect(act(issue.id, 'save', BOTH)).rejects.toThrow('NEXT_REDIRECT');
    expect((await reload(issue.id)).introEn).toBeNull();
    expect(h.refreshes).toBe(0);
  });
});

describe('AI draft and approval', () => {
  it('drafts the other language, marks it AI, and editing it approves it', async () => {
    const { issue } = await seedWeek();
    vi.mocked(retranslate).mockResolvedValueOnce('这周 agent 活动很多。\n还有两场黑客松。');
    // The button saves the English first, then drafts Chinese from it.
    const r = await act(issue.id, 'draft:zh', { introEn: BOTH.introEn, introZh: '' });
    expect(r).toMatchObject({ ok: true, message: expect.stringContaining('已起草') });
    expect(retranslate).toHaveBeenCalledWith('intro', BOTH.introEn, 'zh');
    expect(await reload(issue.id)).toMatchObject({ introEn: BOTH.introEn, introZh: BOTH.introZh, autoFields: ['intro_zh'] });

    // Saving the draft unchanged (CRLF as posted) keeps the mark; scheduling is refused.
    await act(issue.id, 'save', { introEn: BOTH.introEn, introZh: BOTH.introZh.replace('\n', '\r\n') });
    expect((await reload(issue.id)).autoFields).toEqual(['intro_zh']);
    expect(await act(issue.id, 'schedule', BOTH)).toMatchObject({ ok: false, message: expect.stringContaining('先确认 AI 起草的开场白') });

    // Editing it is approving it.
    await act(issue.id, 'save', { introEn: BOTH.introEn, introZh: '这周 agent 活动特别多。' });
    expect(await reload(issue.id)).toMatchObject({ introZh: '这周 agent 活动特别多。', autoFields: [] });
  });

  it('approve:<lang> clears the mark and keeps the text', async () => {
    const { issue } = await seedWeek();
    vi.mocked(retranslate).mockResolvedValueOnce('Big week for agents.');
    await act(issue.id, 'draft:en', { introZh: '这周 agent 活动很多。' });
    expect((await reload(issue.id)).autoFields).toEqual(['intro_en']);
    expect(await act(issue.id, 'approve:en', { introEn: 'Big week for agents.', introZh: '这周 agent 活动很多。' })).toEqual({ ok: true, message: 'Approved · 已确认' });
    expect(await reload(issue.id)).toMatchObject({ introEn: 'Big week for agents.', autoFields: [] });
    expect(await act(issue.id, 'approve:en', {})).toMatchObject({ ok: true, message: expect.stringContaining('已经确认过') });
  });

  it('maps ai_unavailable and changes nothing', async () => {
    const { issue } = await seedWeek();
    vi.mocked(retranslate).mockRejectedValueOnce(new Error('ai_unavailable'));
    const r = await act(issue.id, 'draft:zh', { introEn: 'Hello' });
    expect(r).toMatchObject({ ok: false, message: expect.stringContaining('AI 还没配置') });
    expect(await reload(issue.id)).toMatchObject({ introEn: 'Hello', introZh: null, autoFields: [] });
  });

  it('a failed model call says so without leaking details', async () => {
    const { issue } = await seedWeek();
    vi.mocked(retranslate).mockRejectedValueOnce(new Error('gateway timeout for victor@example.org'));
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const r = await act(issue.id, 'draft:zh', { introEn: 'Hello' });
    expect(r?.ok).toBe(false);
    expect(r?.message).not.toContain('victor@example.org');
    expect(err.mock.calls.flat().join(' ')).not.toContain('victor@example.org');
    err.mockRestore();
  });

  it('needs a source text and a known language', async () => {
    const { issue } = await seedWeek();
    expect(await act(issue.id, 'draft:zh', { introEn: '' })).toMatchObject({ ok: false, message: expect.stringContaining('另一种语言还是空的') });
    expect(await act(issue.id, 'draft:fr', { introEn: 'x' })).toMatchObject({ ok: false });
    expect(retranslate).not.toHaveBeenCalled();
  });

  it('the intro rule reaches the model (real retranslate)', async () => {
    const real = await vi.importActual<typeof import('@/lib/admin/ai')>('@/lib/admin/ai');
    const prompts: string[] = [];
    const model = new MockLanguageModelV4({
      doGenerate: async (opts) => {
        prompts.push(JSON.stringify(opts.prompt));
        return {
          content: [{ type: 'text', text: '「这周 agent 活动很多。」' }],
          finishReason: { unified: 'stop', raw: undefined },
          usage: { inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined }, outputTokens: { total: 1, text: 1, reasoning: undefined } },
          warnings: [],
        };
      },
    });
    vi.useRealTimers(); // AbortSignal.timeout inside retranslate
    expect(await real.retranslate('intro', 'Big week for agents.', 'zh', { model })).toBe('这周 agent 活动很多。');
    expect(prompts[0]).toContain('weekly newsletter');
    expect(prompts[0]).toContain('Simplified Chinese');
    expect(prompts[0]).toContain('add no facts');
  });
});

describe('schedule and unschedule', () => {
  it('needs both intros, then schedules for Sunday 17:00 PT', async () => {
    const { issue } = await seedWeek();
    expect(await act(issue.id, 'schedule', { introEn: 'Only English' })).toMatchObject({ ok: false, message: expect.stringContaining('先写好中英文开场白') });
    expect((await reload(issue.id)).introEn).toBe('Only English'); // saved before the check
    const r = await act(issue.id, 'schedule', BOTH);
    expect(r).toMatchObject({ ok: true, message: expect.stringContaining('Scheduled for Sun, Oct 11, 17:00 PT') });
    expect(r?.message).not.toContain('发信域名未验证'); // dev mode here
    expect(await reload(issue.id)).toMatchObject({ status: 'scheduled', sendAfter: SEND_AFTER });
    expect(await act(issue.id, 'schedule', BOTH)).toMatchObject({ ok: false, message: expect.stringContaining('只有草稿可以排期') });
  });

  it('warns that nothing will send without a verified sender on Vercel', async () => {
    vi.stubEnv('VERCEL', '1');
    const { issue } = await seedWeek();
    expect((await act(issue.id, 'schedule', BOTH))?.message).toContain('发信域名未验证');
  });

  it('refuses once the send window has passed', async () => {
    const { issue } = await seedWeek();
    vi.setSystemTime(new Date(SEND_AFTER.getTime() + LATE_LIMIT_MS));
    expect(await act(issue.id, 'schedule', BOTH)).toMatchObject({ ok: false, message: expect.stringContaining('错过发送时间') });
  });

  it('says when a late schedule is already due', async () => {
    const { issue } = await seedWeek();
    vi.setSystemTime(new Date(SEND_AFTER.getTime() + 3600_000));
    expect((await act(issue.id, 'schedule', BOTH))?.message).toContain('立即发送');
  });

  it('unschedules back to an editable draft; only from scheduled', async () => {
    const { issue } = await scheduled();
    expect(await act(issue.id, 'unschedule')).toMatchObject({ ok: true, message: expect.stringContaining('已撤回排期') });
    expect(await reload(issue.id)).toMatchObject({ status: 'draft', sendAfter: null });
    expect(await act(issue.id, 'unschedule')).toMatchObject({ ok: false });
    expect(await act(issue.id, 'save', { introEn: 'Edited again' })).toMatchObject({ ok: true });
  });

  it('an issue that started sending cannot be unscheduled', async () => {
    const { issue } = await scheduled();
    await db().update(digestIssues).set({ status: 'sending' }).where(eq(digestIssues.id, issue.id));
    expect(await act(issue.id, 'unschedule')).toMatchObject({ ok: false });
    expect((await reload(issue.id)).status).toBe('sending');
  });

  it('rejects an unknown op', async () => {
    const { issue } = await seedWeek();
    expect(await act(issue.id, 'explode')).toMatchObject({ ok: false });
  });
});

describe('send test', () => {
  const header = (i = 0) => h.sent[i].headers!;
  const tokenIn = (s: string) => /[?&]t=([\w.-]+)/.exec(s)?.[1];

  it('goes to ADMIN_EMAIL only, prefixed, with the real headers, and writes no digest_sends row', async () => {
    const { issue } = await seedWeek();
    const r = await act(issue.id, 'test', { ...BOTH, to: 'someone@example.com', test_locale: 'zh', test_cats: 'ai,hackathon' });
    expect(r).toMatchObject({ ok: true, message: expect.stringContaining('服务器日志') }); // no RESEND_API_KEY
    expect(h.sent).toHaveLength(1);
    const m = h.sent[0];
    expect(m.to).toBe(ADMIN);
    expect(m.subject).toBe('[测试] 本周 2 场精选 · Victor 会去 1 场');
    expect(header()).toEqual({
      'List-Unsubscribe': `<https://picks.test/api/unsubscribe?t=${DUMMY}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      'X-Entity-Ref-ID': issue.id,
    });
    expect(m.tags).toEqual([{ name: 'kind', value: 'digest_test' }, { name: 'issue', value: issue.id }]);
    expect(m.html).not.toContain('__VP_TOKEN__');
    expect(m.text).not.toContain('__VP_TOKEN__');
    expect(m.html).toContain(`https://picks.test/zh/unsubscribe?t=${DUMMY}`);
    expect(m.html).toContain('这周 agent 活动很多。'); // the intro saved by the same submit
    expect(m.html).not.toContain('someone@example.com');
    expect(await db().$count(digestSends)).toBe(0);
    expect((await reload(issue.id)).status).toBe('draft');
  });

  it("uses the admin's own subscriber token when mail really goes out", async () => {
    vi.stubEnv('RESEND_API_KEY', 're_test_key');
    const { issue } = await seedWeek();
    const [sub] = await db()
      .insert(subscribers)
      .values({ id: newId('sub'), email: ADMIN, status: 'active', locale: 'en', categories: ['ai'], tokenVersion: 3 })
      .returning();
    const r = await act(issue.id, 'test', { test_locale: 'en', test_cats: 'ai' });
    expect(r).toMatchObject({ ok: true, message: expect.stringContaining('v***@example.org') });
    expect(h.sent[0].subject).toMatch(/^\[Test\] 1 pick this week · Victor is going to 1$/);
    const token = tokenIn(header()['List-Unsubscribe'])!;
    expect(token).not.toBe(DUMMY);
    expect(verifyToken(token, sub)).toBe(true);
    expect(h.sent[0].html).toContain(`https://picks.test/prefs/${token}`);
    expect(h.sent[0].html).not.toContain('Hackathons'); // only the variant's categories
  });

  it('falls back to the invalid-link token when the admin has no subscriber row', async () => {
    vi.stubEnv('RESEND_API_KEY', 're_test_key');
    const { issue } = await seedWeek();
    await db().insert(subscribers).values({ id: newId('sub'), email: 'reader@example.org', status: 'active', locale: 'en', categories: ['ai'] });
    await act(issue.id, 'test', { test_locale: 'en' });
    expect(tokenIn(header()['List-Unsubscribe'])).toBe(DUMMY);
  });

  it('a variant with no picks sends the empty notice', async () => {
    const { issue } = await seedWeek();
    await act(issue.id, 'test', { test_locale: 'zh', test_cats: 'cycling' });
    expect(h.sent[0].subject).toBe('[测试] 本周没有想推荐的');
  });

  it('F19: carries the preview facets (test_ev, test_online); a forged language is ignored', async () => {
    const { issue } = await seedWeek(); // English, in-person events
    await act(issue.id, 'test', { test_locale: 'zh', test_cats: 'ai,hackathon', test_ev: 'zh' });
    expect(h.sent[0].subject).toBe('[测试] 本周没有想推荐的');
    expect(h.sent[0].text).toContain('只收：中文或双语活动。');
    await act(issue.id, 'test', { test_locale: 'en', test_cats: 'ai,hackathon', test_ev: 'en', test_online: '1' });
    expect(h.sent[1].subject).toBe("[Test] Nothing I'd recommend this week");
    expect(h.sent[1].text).toContain('Only online (incl. hybrid) English or bilingual events.');
    await act(issue.id, 'test', { test_locale: 'zh', test_cats: 'ai,hackathon', test_ev: 'fr', test_online: 'yes' });
    expect(h.sent[2].subject).toBe('[测试] 本周 2 场精选 · Victor 会去 1 场');
    expect(h.sent[2].text).not.toContain('只收：');
  });

  it('defaults to the Chinese, all-categories variant', async () => {
    const { issue } = await seedWeek();
    await act(issue.id, 'test', { test_cats: 'nonsense' });
    expect(h.sent[0].subject).toBe('[测试] 本周 2 场精选 · Victor 会去 1 场');
  });

  it('is limited to 10 a day', async () => {
    const { issue } = await seedWeek();
    for (let i = 0; i < 10; i++) expect(await act(issue.id, 'test')).toMatchObject({ ok: true });
    expect(await act(issue.id, 'test')).toMatchObject({ ok: false, message: expect.stringContaining('10 封上限') });
    expect(h.sent).toHaveLength(10);
  });

  it('sends nothing without ADMIN_EMAIL', async () => {
    vi.stubEnv('ADMIN_EMAIL', '');
    const { issue } = await seedWeek();
    expect(await act(issue.id, 'test')).toMatchObject({ ok: false, message: expect.stringContaining('ADMIN_EMAIL') });
    expect(h.sent).toHaveLength(0);
  });

  it('renders the frozen snapshot once the issue is sending', async () => {
    const { issue } = await scheduled();
    const snap = await buildSnapshot(issue, { db: db() });
    await db()
      .update(digestIssues)
      .set({ status: 'sending', snapshot: { ...snap, introZh: '冻结时的开场白' } })
      .where(eq(digestIssues.id, issue.id));
    await act(issue.id, 'test', { introZh: 'ignored' });
    expect(h.sent[0].html).toContain('冻结时的开场白');
    expect(h.sent[0].html).not.toContain('这周 agent 活动很多');
  });
});

describe('seed inboxes', () => {
  const FROM = "Victor's Picks <picks@mail.example.com>";
  const SEEDS = ' Seed.One@Example.com, seed.one@example.com ; not-an-address\nseed.two@example.org,seed.three@example.net,';
  const batch = (i = 0) => h.batches[i];
  const jobs = async () => db().select().from(jobsLog).where(eq(jobsLog.job, 'digest_seed')).orderBy(jobsLog.id);

  beforeEach(() => {
    vi.stubEnv('RESEND_API_KEY', 're_test_key');
    vi.stubEnv('RESEND_FROM', FROM);
    vi.stubEnv('DIGEST_SEED_EMAILS', SEEDS);
  });

  it('seedEmails normalises, drops invalid and duplicate entries, and caps at 10', () => {
    expect(seedEmails(SEEDS)).toEqual({ emails: ['seed.one@example.com', 'seed.two@example.org', 'seed.three@example.net'], invalid: 1, extra: 0 });
    const many = Array.from({ length: 12 }, (_, i) => `seed${i}@example.com`).join(',');
    expect(seedEmails(many)).toMatchObject({ emails: Array.from({ length: MAX_SEEDS }, (_, i) => `seed${i}@example.com`), invalid: 0, extra: 2 });
    expect(seedEmails('')).toEqual({ emails: [], invalid: 0, extra: 0 });
    expect(seedEmails(' , ;')).toEqual({ emails: [], invalid: 0, extra: 0 });
  });

  it('seedCoverage gives unique sorted domains and the guide domains still missing', () => {
    expect(seedCoverage(['b@example.org', 'a@example.com', 'c@example.org'])).toEqual({ domains: ['example.com', 'example.org'], missing: [...EXPECTED_SEED_DOMAINS] });
    const all = EXPECTED_SEED_DOMAINS.map((d) => `seed@${d}`);
    expect(seedCoverage(all.slice(1)).missing).toEqual([EXPECTED_SEED_DOMAINS[0]]);
  });

  it('sends one permissive batch to the seeds, exactly like the real send, and logs domains only', async () => {
    const { issue } = await seedWeek();
    const r = await act(issue.id, 'seed', { ...BOTH, to: 'someone@example.com', test_locale: 'zh', test_cats: 'ai,hackathon' });
    expect(r).toMatchObject({ ok: true, message: expect.stringContaining('种子邮件已发出') });
    expect(r?.message).toContain('3 inbox(es) (example.com, example.net, example.org)');
    expect(r?.message).not.toContain('@');
    expect(h.batches).toHaveLength(1);
    expect(batch().mode).toBe('permissive');
    expect(batch().key).toMatch(new RegExp(`^digest-seed/${issue.id}/[\\w-]{22}$`));
    expect(batch().emails.map((m) => m.to)).toEqual(['seed.one@example.com', 'seed.two@example.org', 'seed.three@example.net']);
    for (const m of batch().emails) {
      expect(m.from).toBe(FROM);
      expect(m.subject).toBe('本周 2 场精选 · Victor 会去 1 场'); // the real subject: placement is what a seed checks
      // The test send's headers, with the invalid-link token.
      expect(m.headers).toEqual({
        'List-Unsubscribe': `<https://picks.test/api/unsubscribe?t=${DUMMY}>`,
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
        'X-Entity-Ref-ID': issue.id,
      });
      // No sub tag: the webhook can never mark or suppress a subscriber by id over a seed.
      expect(m.tags).toEqual([{ name: 'kind', value: 'digest_seed' }, { name: 'issue', value: issue.id }]);
      expect(m.html).toContain(`https://picks.test/zh/unsubscribe?t=${DUMMY}`);
      expect(m.html).toContain('这周 agent 活动很多。'); // the intro saved by the same submit
      expect(m.html).not.toContain('__VP_TOKEN__');
      expect(m.text).not.toContain('__VP_TOKEN__');
      expect(m.html).not.toContain('someone@example.com');
    }
    expect(h.sent).toHaveLength(0); // not the transactional path
    expect(await db().$count(digestSends)).toBe(0);
    const [log] = await jobs();
    expect(log).toMatchObject({
      ok: true,
      detail: { issue: issue.id, variant: 'zh:ai,hackathon', n: 3, domains: ['example.com', 'example.net', 'example.org'], invalid: [] },
    });
    expect(JSON.stringify(log.detail)).not.toContain('@');
  });

  it('is refused without a verified sender or a key, and sends nothing', async () => {
    const { issue } = await seedWeek();
    vi.stubEnv('RESEND_FROM', "Victor's Picks <onboarding@resend.dev>");
    expect(await act(issue.id, 'seed')).toMatchObject({ ok: false, message: expect.stringContaining('发信域名验证后') });
    vi.stubEnv('RESEND_FROM', FROM);
    vi.stubEnv('RESEND_API_KEY', '');
    expect(await act(issue.id, 'seed')).toMatchObject({ ok: false, message: expect.stringContaining('发信域名验证后') });
    expect(h.batches).toHaveLength(0);
    expect(await jobs()).toHaveLength(0);
  });

  it('is refused without seed addresses', async () => {
    const { issue } = await seedWeek();
    for (const v of ['', 'not-an-address, also bad']) {
      vi.stubEnv('DIGEST_SEED_EMAILS', v);
      expect(await act(issue.id, 'seed')).toMatchObject({ ok: false, message: expect.stringContaining('DIGEST_SEED_EMAILS') });
    }
    expect(h.batches).toHaveLength(0);
  });

  it('caps the batch at 10 addresses', async () => {
    vi.stubEnv('DIGEST_SEED_EMAILS', Array.from({ length: 12 }, (_, i) => `seed${i}@example.com`).join(','));
    const { issue } = await seedWeek();
    await act(issue.id, 'seed');
    expect(batch().emails).toHaveLength(10);
  });

  it('uses the invalid-link token even when a seed address is a subscriber', async () => {
    const { issue } = await seedWeek();
    await db().insert(subscribers).values({ id: newId('sub'), email: 'seed.two@example.org', status: 'active', locale: 'zh', categories: ['ai'] });
    await act(issue.id, 'seed');
    for (const m of batch().emails) {
      expect(m.headers['List-Unsubscribe']).toBe(`<https://picks.test/api/unsubscribe?t=${DUMMY}>`);
      expect(m.html).not.toMatch(/\/prefs\/sub_(?!0{16})/);
    }
  });

  it('is limited to 4 rounds a day', async () => {
    const { issue } = await seedWeek();
    for (let i = 0; i < 4; i++) {
      vi.setSystemTime(new Date(NOW.getTime() + i * 3600_000));
      expect(await act(issue.id, 'seed')).toMatchObject({ ok: true });
    }
    expect(await act(issue.id, 'seed')).toMatchObject({ ok: false, message: expect.stringContaining('4 轮上限') });
    expect(h.batches).toHaveLength(4);
    expect(await jobs()).toHaveLength(4);
  });

  it('a repeat within the minute reuses the idempotency key; edited content or a later round gets a new one', async () => {
    const { issue } = await seedWeek();
    await act(issue.id, 'seed', BOTH);
    await act(issue.id, 'seed', BOTH);
    expect(batch(1).key).toBe(batch(0).key);
    await act(issue.id, 'seed', { ...BOTH, introZh: '改过的开场白。' });
    expect(batch(2).key).not.toBe(batch(0).key);
    vi.setSystemTime(new Date(NOW.getTime() + 60_000));
    await act(issue.id, 'seed', BOTH);
    expect(new Set(h.batches.map((b) => b.key)).size).toBe(3);
  });

  it('works while DIGEST_SENDING=0 keeps the cron off', async () => {
    vi.stubEnv('DIGEST_SENDING', '0');
    const { issue } = await seedWeek();
    expect(await act(issue.id, 'seed')).toMatchObject({ ok: true });
  });

  it('a Resend error is explained by its code, never its message, and logged as a failed round', async () => {
    const { issue } = await seedWeek();
    h.batchResult = () => ({ ok: false, error: { name: 'validation_error', statusCode: 403, message: 'seed.one@example.com: domain not verified' }, retryAfterMs: null });
    const r = await act(issue.id, 'seed');
    expect(r).toMatchObject({ ok: false, message: expect.stringContaining('发信域名还没在 Resend 验证通过') });
    expect(r?.message).not.toContain('@');
    h.batchResult = () => ({ ok: false, error: { name: 'internal_server_error', statusCode: 500, message: 'x' }, retryAfterMs: null });
    expect((await act(issue.id, 'seed'))?.message).toContain('稍后再试');
    const log = await jobs();
    expect(log.map((l) => [l.ok, l.detail])).toEqual([
      [false, { issue: issue.id, variant: expect.any(String), n: 0, domains: ['example.com', 'example.net', 'example.org'], invalid: [], error: 'validation_error' }],
      [false, expect.objectContaining({ n: 0, error: 'internal_server_error' })],
    ]);
    expect(JSON.stringify(log)).not.toContain('@');
  });

  it('addresses Resend rejects are reported by domain', async () => {
    const { issue } = await seedWeek();
    h.batchResult = (emails) => ({ ok: true, ids: emails.map((_, i) => (i === 1 ? null : `re_${i}`)), invalid: [1], dailyUsed: null });
    const r = await act(issue.id, 'seed');
    expect(r).toMatchObject({ ok: true, message: expect.stringContaining('Resend rejected 1 (example.org)') });
    expect((await jobs())[0].detail).toMatchObject({ n: 2, invalid: ['example.org'] });
    h.batchResult = (emails) => ({ ok: true, ids: emails.map(() => null), invalid: emails.map((_, i) => i), dailyUsed: null });
    expect(await act(issue.id, 'seed')).toMatchObject({ ok: false, message: expect.stringContaining('全部被 Resend 拒收') });
    expect((await jobs())[1]).toMatchObject({ ok: false, detail: { n: 0 } });
  });
});

describe('send now', () => {
  const done ={ ok: true, issue: W, status: 'sent' as const, claimed: 3, sent: 3, replayed: 0, failed: 0, emptyNotices: 0, skippedEmpty: 0, batches: 1, htmlMaxBytes: 20_000 };

  it('is refused for a draft and before send_after', async () => {
    const { issue } = await seedWeek();
    expect(await act(issue.id, 'send_now')).toMatchObject({ ok: false, message: expect.stringContaining('还不能发') });
    await act(issue.id, 'schedule', BOTH);
    expect(await act(issue.id, 'send_now')).toMatchObject({ ok: false });
    expect(h.afters).toHaveLength(0);
  });

  it('runs the digest after the response once a scheduled issue is due, and logs the run', async () => {
    const { issue } = await scheduled();
    vi.setSystemTime(new Date(SEND_AFTER.getTime() + 2 * 3600_000));
    vi.mocked(runDigest).mockResolvedValueOnce(done);
    expect(await act(issue.id, 'send_now')).toMatchObject({ ok: true, message: expect.stringContaining('后台发送') });
    expect(runDigest).not.toHaveBeenCalled(); // not before the response
    expect(h.afters).toHaveLength(1);
    await h.afters[0]();
    expect(runDigest).toHaveBeenCalledTimes(1);
    const [log] = await db().select().from(jobsLog);
    expect(log).toMatchObject({ job: 'digest', ok: true, detail: { trigger: 'admin', issue: W, sent: 3 } });
    expect(JSON.stringify(log.detail)).not.toContain('@');
    // The issue is now public on /weekly: the archive cache goes (inside after(), so not updateTag).
    expect(revalidateTag).toHaveBeenCalledExactlyOnceWith('digest', { expire: 0 });
  });

  it('a run that only closed an expired issue refreshes the archive too', async () => {
    const { issue } = await scheduled();
    await db().update(digestIssues).set({ status: 'sending' }).where(eq(digestIssues.id, issue.id));
    vi.mocked(runDigest).mockResolvedValueOnce({ ...done, issue: undefined, status: undefined, skipped: 'nothing_due', claimed: 0, sent: 0, closed: [W] });
    await act(issue.id, 'send_now');
    await h.afters[0]();
    expect(revalidateTag).toHaveBeenCalledExactlyOnceWith('digest', { expire: 0 });
  });

  it('a no-op run writes no jobs_log row; a failing one writes a code only', async () => {
    const { issue } = await scheduled();
    await db().update(digestIssues).set({ status: 'sending' }).where(eq(digestIssues.id, issue.id));
    vi.mocked(runDigest).mockResolvedValueOnce({ ...done, issue: undefined, status: undefined, skipped: 'locked', claimed: 0, sent: 0 });
    await act(issue.id, 'send_now');
    await h.afters[0]();
    expect(await db().$count(jobsLog)).toBe(0);
    expect(revalidateTag).not.toHaveBeenCalled(); // nothing changed for /weekly

    vi.mocked(runDigest).mockRejectedValueOnce(new TypeError('boom for reader@example.org'));
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    await act(issue.id, 'send_now');
    await h.afters[1]();
    err.mockRestore();
    const [log] = await db().select().from(jobsLog);
    expect(log).toMatchObject({ ok: false, detail: { trigger: 'admin', error: 'TypeError' } });
    expect(revalidateTag).toHaveBeenCalledWith('digest', { expire: 0 }); // it may have frozen the issue first
  });

  it('is refused past the 27 h limit and without a verified sender', async () => {
    const { issue } = await scheduled();
    vi.setSystemTime(new Date(SEND_AFTER.getTime() + LATE_LIMIT_MS));
    expect(await act(issue.id, 'send_now')).toMatchObject({ ok: false });
    vi.setSystemTime(new Date(SEND_AFTER.getTime() + 3600_000));
    vi.stubEnv('VERCEL', '1');
    expect(await act(issue.id, 'send_now')).toMatchObject({ ok: false, message: expect.stringContaining('发信域名未验证') });
    expect(h.afters).toHaveLength(0);
  });
});

describe('audience: one render per distinct email', () => {
  const v = (key: string) => parseVariantKey(key) as Variant;

  /** W42: AI + hackathon picks; W43 preview: the featured AI event plus a featured VC event. */
  async function snapshot() {
    await addEvent({ category: 'vc', featured: true, startAt: new Date('2026-10-22T01:00:00Z') });
    const { issue } = await seedWeek();
    expect(issue.featuredIds).toHaveLength(2);
    return buildSnapshot(issue, { db: db() });
  }

  it('the key is the language plus the picked categories with something to show, or empty', async () => {
    const snap = await snapshot();
    expect(emailKey(snap, v('zh:ai,campus,social'))).toBe('zh:ai');
    expect(emailKey(snap, v('zh:ai'))).toBe('zh:ai');
    expect(emailKey(snap, v('zh:ai,vc'))).toBe('zh:ai,vc'); // VC only in the preview: still a different email
    expect(emailKey(snap, v('zh:ai,hackathon,cycling'))).toBe('zh:ai,hackathon');
    expect(emailKey(snap, v('en:ai'))).toBe('en:ai');
    for (const k of ['zh:vc', 'zh:cycling,social']) expect(emailKey(snap, v(k))).toBe('zh:empty'); // no picks
    expect(emailKey(snap, v('en:cycling'))).toBe('en:empty');
    expect(emailKey({ ...snap, events: undefined } as unknown as typeof snap, v('zh:ai'))).toBe('zh:ai'); // malformed: own key
  });

  it('F19: facets are part of the key; within one facet choice the same dedup holds', async () => {
    await addEvent({ category: 'social', eventLanguage: 'zh', format: 'online', startAt: new Date('2026-10-16T02:00:00Z') });
    const snap = await snapshot();
    expect(emailKey(snap, v('zh:ai,social;l=zh'))).toBe('zh:social;l=zh');
    expect(emailKey(snap, v('zh:social,vc;l=zh'))).toBe('zh:social;l=zh'); // the VC preview item is English: dropped
    expect(emailKey(snap, v('zh:ai,social;o'))).toBe('zh:social;o');
    expect(emailKey(snap, v('zh:ai,social'))).toBe('zh:ai,social');
    expect(emailKey(snap, v('zh:ai;l=zh'))).toBe('zh:empty;l=zh');
    expect(emailKey(snap, v('zh:ai;l=zh;o'))).toBe('zh:empty;l=zh;o');
    expect(emailKey(snap, v('zh:vc'))).toBe('zh:empty');
    const a = await renderVariant(snap, v('zh:ai,social;l=zh'));
    const b = await renderVariant(snap, v('zh:social,vc;l=zh'));
    expect(a!.html).toBe(b!.html);
    expect((await renderVariant(snap, v('zh:social;o')))!.html).not.toBe(a!.html); // another facet line
    expect((await renderEmptyNotice(snap, v('zh:ai;l=zh'))).html).toBe((await renderEmptyNotice(snap, v('zh:hackathon,ai;l=zh'))).html);
  });

  it('variants with the same key render byte-identical emails (what the dedup relies on)', async () => {
    const snap = await snapshot();
    const a = await renderVariant(snap, v('zh:ai,campus,social'));
    const b = await renderVariant(snap, v('zh:ai'));
    expect(a!.html).toBe(b!.html);
    expect(a!.text).toBe(b!.text);
    expect(a!.subject).toBe(b!.subject);
    expect((await renderVariant(snap, v('zh:ai,vc')))!.html).not.toBe(b!.html);
    expect((await renderEmptyNotice(snap, v('zh:vc'))).html).toBe((await renderEmptyNotice(snap, v('zh:cycling,social'))).html);
  });

  it('renders each distinct email once, reuses a known render, and caps new renders', async () => {
    const snap = await snapshot();
    const rows = ['zh:ai', 'zh:ai,campus', 'zh:hackathon', 'zh:vc', 'zh:cycling', 'en:ai', 'en:ai,social', 'zh:ai,vc'].map(v);
    const calls: string[] = [];
    const render = async (x: Variant) => (calls.push(x.key), `html for ${emailKey(snap, x)}`);

    const all = await renderPerEmail(snap, rows, render, { limit: 64 });
    expect(calls).toEqual(['zh:ai', 'zh:hackathon', 'zh:vc', 'en:ai', 'zh:ai,vc']);
    expect(all).toEqual(['html for zh:ai', 'html for zh:ai', 'html for zh:hackathon', 'html for zh:empty', 'html for zh:empty', 'html for en:ai', 'html for en:ai', 'html for zh:ai,vc']);

    calls.length = 0;
    const known = await renderPerEmail(snap, rows, render, { limit: 64, known: [[v('zh:ai,social'), 'preview']] });
    expect(calls).not.toContain('zh:ai');
    expect(known.slice(0, 2)).toEqual(['preview', 'preview']);

    calls.length = 0;
    const capped = await renderPerEmail(snap, rows, render, { limit: 2 });
    expect(calls).toEqual(['zh:ai', 'zh:hackathon']);
    expect(capped).toEqual(['html for zh:ai', 'html for zh:ai', 'html for zh:hackathon', null, null, null, null, null]);
  });
});

describe('WeChat text of a frozen issue', () => {
  // As the page builds it for a sending or sent issue: the stored snapshot, then the events' live
  // rows and the attendance switch now (liveFor() in page.tsx), then liveState() and wechatText().
  async function frozenText(snapshot: DigestSnapshot, now = NOW) {
    const ids = [...snapshot.events, ...snapshot.preview].map((e) => e.id);
    const [rows, attendance] = await Promise.all([publicEvents({ ids }), showAttendance()]);
    const cur = liveState(snapshot, rows, now, attendance === true);
    return wechatText(cur.snap, { origin: 'https://picks.test', subscribe: false, cancelled: cur.cancelled });
  }
  async function sentIssue() {
    const s = await seedWeek();
    const snapshot = await buildSnapshot(s.issue, { db: db() });
    await db().update(digestIssues).set({ status: 'sent', snapshot, sentAt: SEND_AFTER }).where(eq(digestIssues.id, s.issue.id));
    expect(snapshot.events.find((e) => e.id === s.going)?.seal).toBe('going');
    return { ...s, snapshot };
  }

  it('unchanged since the send: the seal and the going count', async () => {
    const { snapshot } = await sentIssue();
    const text = (await frozenText(snapshot))!.text;
    expect(text).toContain('本周 2 场精选 · Victor 会去 1 场');
    expect(text).toMatch(/\n1\. \[会去\] Agent 之夜/);
  });

  it('the kill switch turned off after the send (setting or SHOW_ATTENDANCE): no seal, no going count', async () => {
    const { snapshot } = await sentIssue();
    await db().insert(settings).values({ key: 'show_attendance', value: { on: false } });
    const off = (await frozenText(snapshot))!;
    expect(off.text).not.toContain('[会去]');
    expect(off.text).not.toContain('Victor 会去');
    expect(off.going).toBe(0);
    await db().delete(settings);
    vi.stubEnv('SHOW_ATTENDANCE', 'false');
    const env = (await frozenText(snapshot))!.text;
    expect(env).not.toContain('[会去]');
    expect(env).not.toContain('Victor 会去');
  });

  it('going hidden since, or the event archived or cancelled: the archive\'s rules', async () => {
    const { snapshot, going, hack } = await sentIssue();
    await db().update(events).set({ goingVisibility: 'hidden' }).where(eq(events.id, going));
    expect((await frozenText(snapshot))!.text).not.toContain('[会去]');

    await db().update(events).set({ status: 'cancelled' }).where(eq(events.id, hack));
    await db().update(events).set({ status: 'archived', goingVisibility: 'public' }).where(eq(events.id, going));
    // Nothing left to post: the archived pick is gone and the cancelled one is not a pick.
    expect(await frozenText(snapshot)).toBeNull();

    await db().update(events).set({ status: 'published' }).where(eq(events.id, going));
    const text = (await frozenText(snapshot))!.text;
    expect(text).toContain('本周 1 场精选 · Victor 会去 1 场');
    expect(text).toMatch(/\n1\. \[会去\] Agent 之夜/);
    expect(text).toContain(`\n【10月17日周六】\n[已取消] Agent 之夜 ${hack.slice(-4)}\n`);
    expect(text).not.toContain('Worth it for the demos'); // a cancelled event keeps no note
    expect(text).not.toContain('2. ');
  });
});

describe('markup', () => {
  /** The <input> tag carrying `name` and `value`, whatever React's attribute order. */
  const input = (out: string, name: string, value: string) =>
    out.match(/<input[^>]*>/g)?.find((t) => t.includes(`name="${name}"`) && t.includes(`value="${value}"`)) ?? '';
  const editor = (over: Partial<EditorProps> = {}): EditorProps => ({
    issueId: 'dig_x', version: 'v1', status: 'draft', previewWeek: '2026-W43', introEn: 'Hello', introZh: '你好', autoFields: ['intro_zh'],
    featured: [{ id: 'evt_a', title: 'Agent 之夜', when: '10月20日周二 18:00', tag: 'AI 与技术', onSite: true, checked: true }],
    staleFeatured: 0, luma: [{ id: 'evt_b', title: 'Luma Night', when: '10月13日周二 18:30', kept: false }],
    allToTemplate: false, canSendNow: false, modeOff: false, aiReady: true,
    test: { locale: 'zh', categories: 'ai,hackathon', label: '中文 · AI 与技术、黑客松' }, adminEmail: 'v***@example.org',
    seed: { domains: ['example.com', 'example.org'], missing: ['gmail.com', 'icloud.com', 'outlook.com', 'qq.com', '163.com'], count: 2, ignored: 0, ready: true, reason: null },
    weeklyLink: true,
    ...over,
  });
  const html = (p: EditorProps) => renderToStaticMarkup(createElement(DigestEditor, p));

  it('a draft can be edited, approved, drafted by AI, saved and scheduled', () => {
    const out = html(editor());
    expect(out).toContain('name="introEn"');
    expect(out).not.toMatch(/<textarea[^>]*readOnly/i);
    expect(out).toContain('value="approve:zh"');
    expect(out).not.toContain('value="approve:en"');
    expect(out).toContain('value="draft:en"');
    expect(out).toContain('name="featured_present"');
    expect(out).toContain('name="keep_present"');
    expect(input(out, 'featured', 'evt_a')).toContain('checked=""');
    expect(input(out, 'keep', 'evt_b')).not.toContain('checked');
    expect(out).toContain('value="schedule"');
    expect(out).not.toContain('value="unschedule"');
    expect(out).not.toContain('value="send_now"');
    expect(out).toContain('name="test_locale" value="zh"');
    expect(out).toContain('name="test_cats" value="ai,hackathon"');
    expect(out).not.toContain('本周'); // keep choices are covered-week only now: no list tag
  });

  it('only the fields are keyed: the status line and action buttons sit outside the form and post it by id', () => {
    const out = html(editor({ status: 'scheduled', autoFields: [], canSendNow: true }));
    const form = /<form[^>]*>[\s\S]*<\/form>/.exec(out)![0];
    expect(form).toMatch(/^<form id="digest-editor"/);
    expect(form).not.toContain('role="status"');
    for (const op of ['unschedule', 'send_now', 'test']) {
      expect(form).not.toContain(`value="${op}"`);
      expect(out).toMatch(new RegExp(`<button[^>]*form="digest-editor"[^>]*value="${op}"`));
    }
    expect(out).toMatch(/<p[^>]*role="status"[^>]*aria-live="polite"[^>]*tabindex="-1"/i);
    const draft = html(editor());
    const draftForm = /<form[^>]*>[\s\S]*<\/form>/.exec(draft)![0];
    for (const op of ['save', 'schedule']) expect(draft).toMatch(new RegExp(`<button[^>]*form="digest-editor"[^>]*value="${op}"`));
    // Inside the form: the field buttons, the hidden default submit (Enter = save) and the test variant.
    expect(draftForm).toContain('value="approve:zh"');
    expect(draftForm).toContain('value="draft:en"');
    expect(draftForm).toMatch(/<button[^>]*value="save"[^>]*hidden/);
    expect(draftForm).toContain('name="test_locale"');
  });

  it('a scheduled issue is read-only and can be unscheduled or sent now', () => {
    const out = html(editor({ status: 'scheduled', autoFields: [], canSendNow: true }));
    expect(out).toMatch(/<textarea[^>]*readOnly/i);
    expect(out).not.toContain('featured_present');
    expect(out).not.toContain('keep_present');
    expect(out).not.toContain('value="schedule"');
    expect(out).not.toContain('value="draft:');
    expect(out).toContain('value="unschedule"');
    expect(out).toContain('value="send_now"');
  });

  it('send now is disabled without a verified sender; the keep list yields to the global switch', () => {
    const out = html(editor({ status: 'scheduled', canSendNow: true, modeOff: true, allToTemplate: true }));
    expect(out).toMatch(/<button[^>]*value="send_now"[^>]*disabled=""/);
    expect(out).not.toContain('name="keep"');
    expect(out).toContain('官方封面全部换模板');
  });

  const previewProps = (over: Partial<PreviewProps> = {}): PreviewProps => ({
    week: W, locale: 'zh', categories: ['ai', 'hackathon'], evLang: null, onlineOnly: false,
    result: { ok: true, empty: false, subject: '本周 2 场精选 · Victor 会去 1 场', preheader: '这周', html: '<!DOCTYPE html><html><body><p>hi &amp; bye</p></body></html>', text: 'hi', bytes: 81_234, picks: 2, going: 1 },
    maxBytes: 90_000,
    audience: [{ key: 'zh:ai', label: '中文 · AI 与技术', count: 4, href: '/admin/digest?w=2026-W42&l=zh&c=ai', subject: '本周 1 场精选', bytes: 20_000, empty: false, error: null }],
    eligible: 4, dailyCap: 60,
    warnings: [{ text: '1 event(s) miss a note', events: [{ id: 'evt_a', title: 'Agent 之夜' }] }],
    frozen: false, ...over,
  });

  it('the preview shows the email in a sandboxed iframe with subject, counts, size, audience and warnings', () => {
    const out = renderToStaticMarkup(createElement(DigestPreview, previewProps()));
    expect(out).toMatch(/<iframe[^>]*sandbox=""/);
    expect(out).toMatch(/srcdoc="&lt;!DOCTYPE html&gt;&lt;html&gt;&lt;body&gt;&lt;p&gt;hi &amp;amp; bye/i);
    expect(out).toContain('本周 2 场精选 · Victor 会去 1 场');
    expect(out).toContain('81.2 KB / 90.0 KB');
    expect(out).toContain('class="text-seal-text"'); // > 85 % of the limit
    expect(out).toContain('href="/admin/e/evt_a"');
    expect(out).toContain('href="/admin/digest?w=2026-W42&amp;l=zh&amp;c=ai"');
    expect(out).toContain('name="w" value="2026-W42"');
    expect(input(out, 'c', 'ai')).toContain('checked=""');
    expect(input(out, 'c', 'vc')).not.toContain('checked');
    expect(input(out, 'l', 'zh')).toContain('checked=""');
  });

  it('F19: the preview picker carries the facets, and the test send gets them as hidden fields', () => {
    const plain = renderToStaticMarkup(createElement(DigestPreview, previewProps()));
    expect(plain).toMatch(/<select name="ev"[^>]*>/);
    expect(plain).toMatch(/<option value="" selected="">Any · 不限<\/option>/);
    expect(input(plain, 'o', '1')).not.toContain('checked');
    const faceted = renderToStaticMarkup(createElement(DigestPreview, previewProps({ evLang: 'zh', onlineOnly: true })));
    expect(faceted).toMatch(/<option value="zh" selected="">/);
    expect(input(faceted, 'o', '1')).toContain('checked=""');
    expect(faceted).toMatch(/<select name="ev"[^>]*\bh-11\b/);
    const none = html(editor());
    expect(none).not.toContain('name="test_ev"');
    expect(none).not.toContain('name="test_online"');
    const withFacets = html(editor({ test: { locale: 'en', categories: 'ai', evLang: 'bilingual', online: true, label: 'EN · AI & Tech · bilingual' } }));
    expect(input(withFacets, 'test_ev', 'bilingual')).not.toBe('');
    expect(input(withFacets, 'test_online', '1')).not.toBe('');
  });

  it('a render error is shown instead of the iframe', () => {
    const out = renderToStaticMarkup(createElement(DigestPreview, previewProps({ result: { ok: false, error: 'digest html is 95000 bytes' }, audience: [] })));
    expect(out).not.toContain('<iframe');
    expect(out).toContain('role="alert"');
    expect(out).toContain('digest html is 95000 bytes');
    expect(out).toContain('还没有可以收周报的订阅者');
  });

  it('every editor button is a phone-sized target', () => {
    const out = html(editor());
    const button = (value: string) => out.match(/<button[^>]*>/g)!.find((t) => t.includes(`value="${value}"`))!;
    for (const op of ['approve:zh', 'draft:en', 'draft:zh']) expect(button(op)).toContain('min-h-11');
    expect(button('test')).toMatch(/\bh-11\b/);
    const preview = renderToStaticMarkup(createElement(DigestPreview, previewProps()));
    expect(preview).toMatch(/<button type="submit" class="[^"]*\bh-11\b[^"]*">Preview/);
  });

  it('the seed row shows domains, never addresses, and the reason when it is off', () => {
    const out = html(editor());
    const button = out.match(/<button[^>]*value="seed"[^>]*>/)![0];
    expect(button).toContain('form="digest-editor"');
    expect(button).not.toContain('disabled=""');
    expect(button).toMatch(/\bh-11\b/);
    expect(out).toContain('2 inbox(es) · 个收件箱：example.com · example.org（≤4 轮/天）');
    expect(out).toContain('No seed at gmail.com, icloud.com, outlook.com, qq.com, 163.com');
    const off = html(editor({ seed: { domains: [], missing: [], count: 0, ignored: 3, ready: false, reason: 'DIGEST_SEED_EMAILS is not set · 没有配置种子邮箱' } }));
    expect(off).toMatch(/<button[^>]*value="seed"[^>]*disabled=""/);
    expect(off).toContain('没有配置种子邮箱');
    expect(off).toContain('3 DIGEST_SEED_EMAILS entr(ies) ignored');
  });

  it('says intros are public on /weekly, and that a draft test email links to a page that 404s until sending', () => {
    const draft = html(editor());
    expect(draft).toContain('开场白会公开在 /weekly 存档里');
    expect(draft).toContain('这一期开始发送前会 404');
    expect(html(editor({ status: 'scheduled', autoFields: [] }))).toContain('这一期开始发送前会 404');
    const sending = html(editor({ status: 'sending', autoFields: [] }));
    expect(sending).toContain('开场白会公开在 /weekly 存档里');
    expect(sending).not.toContain('404');
    // No events this week: the test email links the plain /week page, which never 404s.
    expect(html(editor({ weeklyLink: false }))).not.toContain('404');
    expect(html(editor({ status: 'scheduled', autoFields: [], weeklyLink: false }))).not.toContain('404');
  });

  describe('WeChat export', () => {
    const panel = (p: Parameters<typeof WeChatExport>[0]) => renderToStaticMarkup(createElement(WeChatExport, p));

    it('a read-only textarea with the text, a copy button and the character count', () => {
      const out = panel({ text: 'Victor 精选 · 10月12日 这一周\n1. 标题 & 更多', introDrafted: false });
      expect(out).toMatch(/<textarea[^>]*readOnly=""[^>]*>Victor 精选 · 10月12日 这一周\n1\. 标题 &amp; 更多<\/textarea>/i);
      expect(out).toMatch(/<textarea[^>]*lang="zh-Hans"/);
      expect(out).toMatch(/<button type="button" class="[^"]*\bh-11\b[^"]*">复制微信文字 · Copy<\/button>/);
      expect(out).toContain('33 字 · characters');
      expect(out).not.toContain('建议删减');
      expect(out).not.toContain('AI 草稿');
      expect(out).toContain('role="status"');
    });

    it('warns past 2,000 characters and when the Chinese intro is an unapproved AI draft', () => {
      const out = panel({ text: '字'.repeat(2001), introDrafted: true });
      expect(out).toContain('2001 字 · characters：超过 2000 字，建议删减或分两条发');
      expect(out).toContain('中文开场白还是没确认的 AI 草稿');
      expect(panel({ text: '字'.repeat(2000), introDrafted: false })).not.toContain('建议删减');
    });

    it('no picks: nothing to copy; a build error is an alert', () => {
      const none = panel({ text: null, introDrafted: false });
      expect(none).toContain('本周没有精选，无需导出');
      expect(none).not.toContain('<textarea');
      expect(none).not.toContain('<button');
      const err = panel({ text: null, error: 'assembly failed: boom', introDrafted: false });
      expect(err).toContain('role="alert"');
      expect(err).toContain('assembly failed: boom');
    });
  });

  it('the More tab stays highlighted on /admin/digest', () => {
    const out = renderToStaticMarkup(createElement(TabBar));
    expect(out).toMatch(/<a href="\/admin" aria-current="page"/);
    expect(out.match(/aria-current="page"/g)).toHaveLength(1);
  });
});
