import { eq, sql } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { testDb } from './helpers/pglite';

// The digest sending pipeline (design contract §C) on PGlite with an injected transport, clock and
// sleep. Most tests replace the assembler and renderer with the small doubles below: those
// assertions are about claims, grouping, idempotency, pacing and error handling, not markup. The
// doubles keep the real contract (the size limit throws DigestTooLargeError, from the real module).
// Tests that set `h.real` run the real assemble.ts and render.ts end to end instead (last section).
// The default db handle points at the test's PGlite, because settings (show_attendance,
// official_covers_to_template) are read through it.

const h = vi.hoisted(() => {
  const TOKEN = '__VP_TOKEN__';
  /** lang / format: the F19 facets (absent = an 'en', in-person event, like a pre-F19 snapshot). */
  type Ev = { id: string; category: string; title: string; lang?: string; format?: string };
  const state = {
    TOKEN,
    db: null as unknown,
    /** Use the real buildSnapshot / renderVariant / renderEmptyNotice / personalize. */
    real: false,
    events: [] as Ev[],
    renders: [] as string[],
    snapshots: 0,
    failVariant: null as string | null,
    hugeVariant: null as string | null,
    nullVariant: null as string | null,
  };
  return state;
});

vi.mock('@/lib/db', async (orig) => ({
  ...(await orig()),
  db: new Proxy({}, { get: (_t, p) => Reflect.get(h.db as object, p) }),
  hasDatabase: () => true,
}));

vi.mock('@/lib/digest/assemble', async (orig) => {
  const real = await orig<typeof import('@/lib/digest/assemble')>();
  type Issue = Parameters<typeof real.buildSnapshot>[0];
  return {
    ...real,
    buildSnapshot: async (issue: Issue, opts?: Parameters<typeof real.buildSnapshot>[1]) => {
      h.snapshots++;
      if (h.real) return real.buildSnapshot(issue, opts);
      return {
        version: 1, issueId: issue.id, isoWeek: issue.isoWeek, from: '2026-10-12T07:00:00.000Z', to: '2026-10-19T07:00:00.000Z',
        previewWeek: '2026-W43', sendAfter: issue.sendAfter?.toISOString() ?? '', origin: 'https://picks.test',
        introEn: issue.introEn, introZh: issue.introZh, showAttendance: true,
        // Wed Oct 14 18:30 PDT, inside the covered week (select.ts only counts events inside it).
        events: h.events.map((e) => ({
          id: e.id, slug: e.id, category: e.category, titleEn: e.title, titleZh: e.title, startAt: '2026-10-15T01:30:00.000Z',
          format: e.format ?? 'in_person', ...(e.lang ? { eventLanguage: e.lang } : {}),
        })),
        preview: [],
      };
    },
  };
});

vi.mock('@/lib/digest/render', async (orig) => {
  const real = await orig<typeof import('@/lib/digest/render')>();
  const { matchesFacets } = await import('@/lib/events/facets');
  type Snap = { origin: string; events: { category: string; titleEn: string; eventLanguage?: string; format: string }[] };
  type V = { key: string; locale: 'en' | 'zh'; categories: string[]; evLang: 'en' | 'zh' | 'bilingual' | null; onlineOnly: boolean };
  const T = h.TOKEN;
  const email = (subject: string, body: string, snap: Snap, v: V) => {
    const pre = `${snap.origin}${v.locale === 'zh' ? '/zh' : ''}`;
    const html = `<!doctype html><html lang="${v.locale}"><body>${body}<a href="${pre}/prefs/${T}">prefs</a> <a href="${pre}/unsubscribe?t=${T}">unsubscribe</a></body></html>`;
    return { subject, preheader: subject, html, text: `${body}\n${pre}/prefs/${T}\n${pre}/unsubscribe?t=${T}`, bytes: html.length, picks: 0, going: 0 };
  };
  return {
    ...real,
    renderVariant: async (snap: Snap, v: V) => {
      h.renders.push(`digest|${v.key}`);
      if (h.real) return real.renderVariant(snap as never, v as never);
      if (h.failVariant === v.key) throw new Error('render exploded');
      // As the real finish(): a variant over the limit is refused, not clipped.
      if (h.hugeVariant === v.key) throw new real.DigestTooLargeError(`digest html is 95000 bytes (limit ${real.MAX_HTML_BYTES})`);
      const picks = snap.events.filter((e) => v.categories.includes(e.category) && matchesFacets(e, v));
      if (picks.length === 0 || h.nullVariant === v.key) return null;
      return { ...email(`${v.key} · ${picks.length} picks`, picks.map((e) => `<p>${e.titleEn}</p>`).join(''), snap, v), picks: picks.length };
    },
    renderEmptyNotice: async (snap: Snap, v: V) => {
      h.renders.push(`empty|${v.key}`);
      if (h.real) return real.renderEmptyNotice(snap as never, v as never);
      return email(`${v.key} · nothing this week`, '<p>nothing</p>', snap, v);
    },
    personalize: (e: Parameters<typeof real.personalize>[0], token: string) => {
      if (h.real) return real.personalize(e, token);
      if (!/^[A-Za-z0-9._-]+$/.test(token)) throw new Error('bad token');
      const out = { subject: e.subject, html: e.html.replaceAll(T, token), text: e.text.replaceAll(T, token) };
      if (out.html.includes(T) || out.text.includes(T)) throw new Error('placeholder left');
      return out;
    },
  };
});

const rs = vi.hoisted(() => ({ send: null as unknown as (...a: unknown[]) => unknown, constructed: [] as string[] }));
vi.mock('resend', () => ({
  Resend: class {
    batch = { send: (...a: unknown[]) => rs.send(...a) };
    constructor(key: string) {
      rs.constructed.push(key);
    }
  },
}));

const { runDigest, idempotencyKey, dailyCapFromEnv, LEASE, PACE_MS } = await import('@/lib/digest/run');
const claim = await import('@/lib/digest/claim');
const { alignIds, classify, devTransport, resendTransport } = await import('@/lib/digest/transport');
const { covers, digestIssues, digestSends, events, settings, subscribers, syncState } = await import('@/lib/db/schema');
const { templateCoverRow } = await import('@/lib/covers/template');
const { COPY } = await import('@/emails/copy');
const { newId } = await import('@/lib/ids');
const { linkToken } = await import('@/lib/subscribers/token');
const { parseVariantKey, variantKey } = await import('@/lib/digest/variant');
const { isEmptyFor, pickCells } = await import('@/lib/digest/select');
const { facetsOf } = await import('@/lib/events/facets');
const fixtures = await import('./helpers/digest-fixtures');
type DigestEvent = import('@/lib/digest/types').DigestEvent;
const { sendAfterFor } = await import('@/lib/digest/week');
const { CATEGORY_SLUGS } = await import('@/lib/taxonomy');
type DB = import('@/lib/db').DB;
type BatchEmail = import('@/lib/digest/transport').BatchEmail;
type BatchMode = import('@/lib/digest/transport').BatchMode;
type BatchOk = import('@/lib/digest/transport').BatchOk;
type BatchErr = import('@/lib/digest/transport').BatchErr;
type BatchTransport = import('@/lib/digest/transport').BatchTransport;
type RunDeps = import('@/lib/digest/run').RunDeps;
type Sub = typeof subscribers.$inferSelect;
type NewEvent = import('@/lib/db/schema').NewEvent;
type DigestSnapshot = import('@/lib/digest/types').DigestSnapshot;
type Issue = typeof digestIssues.$inferSelect;

const MIN = 60_000;
const HOUR = 3600_000;
const DAY = 864e5;
const WEEK = '2026-W42';
const SEND_AFTER = sendAfterFor(WEEK); // 2026-10-12T00:00Z (Sunday 17:00 PDT)

let db: DB;
let n = 0;

beforeEach(async () => {
  db = (await testDb()).db as unknown as DB;
  h.db = db;
  h.real = false;
  h.events = [
    { id: 'evt_ai', category: 'ai', title: 'AI night' },
    { id: 'evt_hack', category: 'hackathon', title: 'Hack weekend' },
  ];
  h.renders = [];
  h.snapshots = 0;
  h.failVariant = null;
  h.hugeVariant = null;
  h.nullVariant = null;
  vi.stubEnv('SUBSCRIBER_LINK_SECRET', 'test-secret-digest-0123456789');
  vi.stubEnv('RESEND_FROM', "Victor's Picks <picks@mail.picks.test>");
  vi.stubEnv('PUBLIC_HOST', 'picks.test');
  vi.stubEnv('SHOW_ATTENDANCE', '');
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

// ---- fixtures ----------------------------------------------------------------------------------

async function seedSub(over: Partial<typeof subscribers.$inferInsert> = {}): Promise<Sub> {
  const [row] = await db
    .insert(subscribers)
    .values({
      id: newId('sub'), email: `reader${++n}@example.org`, status: 'active', locale: 'en', categories: ['ai'],
      consentAt: new Date(SEND_AFTER.getTime() - 30 * DAY), confirmedAt: new Date(SEND_AFTER.getTime() - 30 * DAY + n * MIN), ...over,
    })
    .returning();
  return row;
}

async function seedMany(count: number, pick: (i: number) => Partial<typeof subscribers.$inferInsert> = () => ({})) {
  const base = SEND_AFTER.getTime() - 30 * DAY;
  const values = Array.from({ length: count }, (_, i) => ({
    id: newId('sub'), email: `bulk${++n}@example.org`, status: 'active' as const, locale: 'en' as const, categories: ['ai'],
    consentAt: new Date(base), confirmedAt: new Date(base + i * MIN), ...pick(i),
  }));
  return db.insert(subscribers).values(values).returning();
}

async function seedIssue(over: Partial<typeof digestIssues.$inferInsert> = {}): Promise<Issue> {
  const isoWeek = over.isoWeek ?? WEEK;
  const [row] = await db
    .insert(digestIssues)
    .values({ id: newId('dig'), isoWeek, status: 'scheduled', sendAfter: sendAfterFor(isoWeek), introEn: 'Hello', introZh: '你好', ...over })
    .returning();
  return row;
}

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

const sends = (issueId?: string) =>
  issueId ? db.select().from(digestSends).where(eq(digestSends.issueId, issueId)) : db.select().from(digestSends);
const issueRow = async (id: string) => (await db.select().from(digestIssues).where(eq(digestIssues.id, id)))[0];

type PickCell = import('@/lib/digest/select').PickCell;
/** Claim cells for events in these categories: English and in person unless told otherwise. */
const cellsOf = (cats: readonly string[], lang: PickCell['lang'] = 'en', online = false): PickCell[] =>
  cats.map((c) => ({ category: c as PickCell['category'], lang, online }));

/** Fails `execute` once when the statement contains `needle`: a crash at that exact point. */
function crashOnce(real: DB, needle: string) {
  const dialect = new PgDialect();
  let armed = true;
  return new Proxy(real, {
    get(t, p) {
      if (p === 'execute') {
        return async (q: Parameters<DB['execute']>[0]) => {
          const text = typeof q === 'string' ? q : dialect.sqlToQuery((q as { getSQL: () => import('drizzle-orm').SQL }).getSQL()).sql;
          if (armed && text.includes(needle)) {
            armed = false;
            throw new Error('connection lost');
          }
          return t.execute(q);
        };
      }
      const v = Reflect.get(t, p, t);
      return typeof v === 'function' ? v.bind(t) : v;
    },
  });
}

/** Any database access fails the test. */
const noDb = new Proxy({}, { get: () => { throw new Error('database touched'); } }) as DB;

function setup(start = new Date(SEND_AFTER.getTime() + HOUR), script?: Script) {
  const clock = fakeClock(start);
  const tr = fakeTransport(script);
  const run = (over: Partial<RunDeps> = {}) =>
    runDigest({ db, now: clock.now, sleep: clock.sleep, transport: tr.t, mode: 'live', dailyCap: 1000, ...over });
  return { clock, tr, run };
}

// ---- transport ----------------------------------------------------------------------------------

describe('alignIds', () => {
  it('strict: ids pair with payload positions', () => {
    expect(alignIds(3, ['a', 'b', 'c'], [])).toEqual(['a', 'b', 'c']);
  });
  it('permissive: created ids skip the rejected indices', () => {
    expect(alignIds(4, ['a', 'c', 'd'], [1])).toEqual(['a', null, 'c', 'd']);
    expect(alignIds(3, [], [0, 1, 2])).toEqual([null, null, null]);
  });
  it('permissive with a full-length data array keeps positions and blanks the rejected', () => {
    expect(alignIds(3, ['a', 'b', 'c'], [1])).toEqual(['a', null, 'c']);
  });
  it('any other shape is not guessed at', () => {
    expect(alignIds(3, ['a'], [])).toBeNull();
    expect(alignIds(3, ['a', 'b'], [])).toBeNull();
    expect(alignIds(4, ['a'], [1])).toBeNull();
  });
});

describe('classify', () => {
  it.each([
    ['rate_limit_exceeded', 429, 'retry'],
    ['concurrent_idempotent_requests', 409, 'retry'],
    ['internal_server_error', 500, 'retry'],
    ['application_error', null, 'retry'],
    ['application_error', 503, 'retry'],
    ['service_unavailable', 503, 'retry'],
    ['invalid_idempotent_request', 409, 'conflict'],
    ['daily_quota_exceeded', 429, 'stop'],
    ['monthly_quota_exceeded', 429, 'stop'],
    ['missing_api_key', 401, 'stop'],
    ['invalid_api_key', 403, 'stop'],
    ['restricted_api_key', 401, 'stop'],
    ['invalid_from_address', 422, 'stop'],
    ['invalid_idempotency_key', 400, 'stop'],
    ['validation_error', 403, 'stop'],
    ['validation_error', 422, 'permissive'],
    ['validation_error', 400, 'permissive'],
    ['missing_required_field', 422, 'permissive'],
    ['invalid_parameter', 422, 'permissive'],
    ['something_new', 418, 'stop'],
  ] as const)('%s %s → %s', (name, statusCode, next) => {
    expect(classify({ name, statusCode })).toBe(next);
  });
});

describe('resendTransport', () => {
  const mail = (i: number): BatchEmail => ({
    from: 'f@picks.test', to: `r${i}@example.org`, subject: 's', html: '<p>h</p>', text: 'h', headers: {}, tags: [],
  });
  beforeEach(() => {
    rs.constructed = [];
  });

  it('without a key: a stop error, and no client is ever built', async () => {
    const r = await resendTransport('')([mail(0)], 'k', 'strict');
    expect(r).toMatchObject({ ok: false, error: { name: 'missing_api_key' } });
    expect(classify((r as BatchErr).error)).toBe('stop');
    expect(rs.constructed).toEqual([]);
  });

  it('sends with the idempotency key and validation mode; ids come from data.data; client built once', async () => {
    const calls: unknown[][] = [];
    rs.send = async (...a: unknown[]) => {
      calls.push(a);
      return { data: { data: [{ id: 'e1' }, { id: 'e2' }] }, error: null, headers: { 'x-resend-daily-quota': '17' } };
    };
    const t = resendTransport('re_test');
    expect(await t([mail(0), mail(1)], 'digest/dig_x/abc', 'strict')).toEqual({ ok: true, ids: ['e1', 'e2'], invalid: [], dailyUsed: 17 });
    await t([mail(0), mail(1)], 'digest/dig_x/abc', 'strict');
    expect(calls[0][1]).toEqual({ idempotencyKey: 'digest/dig_x/abc', batchValidation: 'strict' });
    expect((calls[0][0] as BatchEmail[]).map((e) => e.to)).toEqual(['r0@example.org', 'r1@example.org']);
    expect(rs.constructed).toEqual(['re_test']);
  });

  it('permissive: rejected indices are reported and ids are realigned', async () => {
    rs.send = async () => ({
      data: { data: [{ id: 'e0' }, { id: 'e2' }], errors: [{ index: 1, message: 'Invalid `to` field' }] },
      error: null, headers: {},
    });
    const r = await resendTransport('re_test')([mail(0), mail(1), mail(2)], 'k:p', 'permissive');
    expect(r).toEqual({ ok: true, ids: ['e0', null, 'e2'], invalid: [1], dailyUsed: null });
  });

  it('an error carries the retry-after header in ms', async () => {
    rs.send = async () => ({ data: null, error: { name: 'rate_limit_exceeded', statusCode: 429, message: 'slow down' }, headers: { 'retry-after': '2' } });
    expect(await resendTransport('re_test')([mail(0)], 'k', 'strict')).toEqual({
      ok: false, error: { name: 'rate_limit_exceeded', statusCode: 429, message: 'slow down' }, retryAfterMs: 2000,
    });
  });

  it('a thrown network fault becomes application_error with no status (retry, same key)', async () => {
    rs.send = async () => {
      throw new TypeError('fetch failed');
    };
    const r = await resendTransport('re_test')([mail(0)], 'k', 'strict');
    expect(r).toMatchObject({ ok: false, error: { name: 'application_error', statusCode: null }, retryAfterMs: null });
    expect(classify((r as BatchErr).error)).toBe('retry');
  });

  it('refuses an empty batch or more than 100', async () => {
    rs.send = async () => ({ data: { data: [] }, error: null, headers: {} });
    await expect(resendTransport('re_test')([], 'k', 'strict')).rejects.toThrow('batch size 0');
    await expect(resendTransport('re_test')(Array.from({ length: 101 }, (_, i) => mail(i)), 'k', 'strict')).rejects.toThrow('batch size 101');
  });
});

describe('devTransport', () => {
  it('logs one masked line per batch and returns dev ids', async () => {
    const logs: string[] = [];
    vi.spyOn(console, 'info').mockImplementation((...a: unknown[]) => void logs.push(a.join(' ')));
    const r = await devTransport(
      [
        { from: 'f', to: 'private.person@example.org', subject: 'en:ai · 2 picks', html: '', text: '', headers: {}, tags: [] },
        { from: 'f', to: 'other.person@example.org', subject: 'en:ai · 2 picks', html: '', text: '', headers: {}, tags: [] },
      ],
      'digest/dig_x/abc',
      'strict',
    );
    expect(r).toEqual({ ok: true, ids: ['dev', 'dev'], invalid: [], dailyUsed: null });
    expect(logs).toHaveLength(1);
    expect(logs[0]).toContain('[digest:dev] batch n=2');
    expect(logs[0]).toContain('p***@example.org');
    expect(logs[0]).not.toContain('private.person');
    expect(logs[0]).not.toContain('other.person');
  });
});

describe('idempotencyKey and the daily cap setting', () => {
  it('depends only on the set of ids, fits Resend limits', () => {
    const k = idempotencyKey('dig_0123456789abcdef', ['sub_b', 'sub_a', 'sub_c']);
    expect(k).toBe(idempotencyKey('dig_0123456789abcdef', ['sub_c', 'sub_a', 'sub_b']));
    expect(k).toMatch(/^digest\/dig_0123456789abcdef\/[A-Za-z0-9_-]{22}$/);
    expect(idempotencyKey('dig_0123456789abcdef', ['sub_a', 'sub_b'])).not.toBe(k);
  });
  it('DIGEST_DAILY_CAP defaults to 60', () => {
    expect(dailyCapFromEnv(undefined)).toBe(60);
    expect(dailyCapFromEnv('')).toBe(60);
    expect(dailyCapFromEnv('abc')).toBe(60);
    expect(dailyCapFromEnv('-1')).toBe(60);
    expect(dailyCapFromEnv('90')).toBe(90);
    expect(dailyCapFromEnv('0')).toBe(0);
  });
});

// ---- claims -------------------------------------------------------------------------------------

describe('claims', () => {
  const at = new Date(SEND_AFTER.getTime() + HOUR);

  it('the SQL variant key equals variantKey() for all 127 category sets in both languages', async () => {
    const subsets = Array.from({ length: 127 }, (_, m) => CATEGORY_SLUGS.filter((_, i) => (m + 1) & (1 << i)));
    for (const locale of ['en', 'zh'] as const) {
      for (const set of subsets) {
        // Reversed, with a duplicate and an unknown slug: both sides must normalise the same way.
        const messy: string[] = [...[...set].reverse(), set[0], 'bogus'];
        const r = (await db.execute(sql`select ${claim.variantKeyExpr(sql`${locale}::text`, claim.textArray(messy))} as k`)) as unknown as { rows: { k: string }[] };
        expect(r.rows[0].k).toBe(variantKey(locale, messy));
      }
    }
  });

  it('claims eligible subscribers only: active, or paused with the pause over or undated; with a known category', async () => {
    const issue = await seedIssue({ status: 'sending' });
    const ok = [
      await seedSub(),
      await seedSub({ status: 'paused', pausedUntil: new Date(at.getTime() - MIN) }),
      await seedSub({ status: 'paused', pausedUntil: null }),
    ];
    const notOk = [
      await seedSub({ status: 'paused', pausedUntil: new Date(at.getTime() + DAY) }),
      await seedSub({ status: 'pending', confirmedAt: null }),
      await seedSub({ status: 'unsubscribed' }),
      await seedSub({ status: 'suppressed' }),
      await seedSub({ categories: [] }),
      await seedSub({ categories: ['bogus'] }),
      await seedSub({ categories: ['cycling'] }), // no overlap with this week's categories
    ];
    const got = await claim.claimFresh(issue.id, { kind: 'digest', cells: cellsOf(['ai', 'hackathon']) }, 100, 'dbk_1', at, db);
    expect(got.map((r) => r.id).sort()).toEqual(ok.map((s) => s.id).sort());
    expect(got.every((r) => r.kind === 'digest' && r.variantKey === 'en:ai')).toBe(true);
    expect(notOk.length).toBe(7);
    const rows = await sends(issue.id);
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.batchKey === 'dbk_1' && r.claimedAt.getTime() === at.getTime() && r.resendId === null)).toBe(true);
  });

  it('oldest confirmation first, never-confirmed last, up to the limit; a second claim takes the rest', async () => {
    const issue = await seedIssue({ status: 'sending' });
    const late = await seedSub({ confirmedAt: new Date(at.getTime() - DAY) });
    const early = await seedSub({ confirmedAt: new Date(at.getTime() - 9 * DAY) });
    const none = await seedSub({ confirmedAt: null });
    const first = await claim.claimFresh(issue.id, { kind: 'digest', cells: cellsOf(['ai']) }, 2, 'dbk_a', at, db);
    expect(first.map((r) => r.id).sort()).toEqual([early.id, late.id].sort());
    const second = await claim.claimFresh(issue.id, { kind: 'digest', cells: cellsOf(['ai']) }, 2, 'dbk_b', at, db);
    expect(second.map((r) => r.id)).toEqual([none.id]);
    expect(await claim.claimFresh(issue.id, { kind: 'digest', cells: cellsOf(['ai']) }, 2, 'dbk_c', at, db)).toEqual([]);
    expect(await claim.claimFresh(issue.id, { kind: 'digest', cells: cellsOf([]) }, 2, 'dbk_d', at, db)).toEqual([]);
    expect(await claim.claimFresh(issue.id, { kind: 'digest', cells: cellsOf(['ai']) }, 0, 'dbk_e', at, db)).toEqual([]);
  });

  it('racing claims never overlap and together cover everyone', async () => {
    const issue = await seedIssue({ status: 'sending' });
    const all = await seedMany(30, (i) => ({ categories: i % 2 ? ['ai'] : ['ai', 'vc'], locale: i % 3 ? 'en' : 'zh' }));
    const results = await Promise.all(
      Array.from({ length: 4 }, (_, i) => claim.claimFresh(issue.id, { kind: 'digest', cells: cellsOf(['ai']) }, 30, `dbk_${i}`, at, db)),
    );
    const ids = results.flat().map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.sort()).toEqual(all.map((s) => s.id).sort());
    expect(await sends(issue.id)).toHaveLength(30);
  });

  it('empty notices: only subscribers with no category that has events, at most one claimed per month', async () => {
    const issue = await seedIssue({ status: 'sending' });
    const later = await seedIssue({ isoWeek: '2026-W43', status: 'sending' });
    const cyclist = await seedSub({ categories: ['cycling'], locale: 'zh' });
    await seedSub({ categories: ['ai'] });
    const monthStart = new Date('2026-10-01T07:00:00Z');
    const target = { kind: 'empty' as const, cells: cellsOf(['ai']), monthStart };
    const got = await claim.claimFresh(issue.id, target, 100, 'dbk_e1', at, db);
    expect(got).toMatchObject([{ id: cyclist.id, kind: 'empty', variantKey: 'zh:cycling' }]);
    // The next issue in the same month: already had one.
    expect(await claim.claimFresh(later.id, target, 100, 'dbk_e2', new Date(at.getTime() + 7 * DAY), db)).toEqual([]);
    expect(await claim.countSkippedEmpty(later.id, cellsOf(['ai']), monthStart, at, db)).toBe(1);
    // A new month.
    const nov = { ...target, monthStart: new Date('2026-11-01T07:00:00Z') };
    expect((await claim.claimFresh(later.id, nov, 100, 'dbk_e3', new Date('2026-11-02T02:00:00Z'), db)).map((r) => r.id)).toEqual([cyclist.id]);
  });

  it("an empty notice that provably never went out doesn't use up the month; one that may have did", async () => {
    const monthStart = new Date('2026-10-01T07:00:00Z');
    const target = { kind: 'empty' as const, cells: cellsOf(['ai']), monthStart };
    const w42 = await seedIssue({ status: 'sending' });
    const w43 = await seedIssue({ isoWeek: '2026-W43', status: 'sending' });
    const errors = ['failed:reached_daily_quota', 'render_failed', 'too_large', 'invalid', 'no_picks'] as const;
    // Replay-only codes: the first attempt of that stale group may already have been delivered.
    const maybeDelivered = [
      'id_mismatch', 'idem_conflict', 'expired', 'window_closed', 'ineligible', 'replay_render_failed', 'replay_too_large', 'replay_no_picks', null,
    ] as const;
    const freed = await seedMany(errors.length, () => ({ categories: ['cycling'] }));
    const kept = await seedMany(maybeDelivered.length, () => ({ categories: ['cycling'] }));
    expect(await claim.claimFresh(w42.id, target, 100, 'dbk_m1', at, db)).toHaveLength(freed.length + kept.length);
    for (const [i, s] of freed.entries()) {
      await db.update(digestSends).set({ error: errors[i] }).where(eq(digestSends.subscriberId, s.id));
    }
    for (const [i, s] of kept.entries()) {
      // null = an in-flight claim (waiting to be sent or replayed)
      if (maybeDelivered[i]) await db.update(digestSends).set({ error: maybeDelivered[i] }).where(eq(digestSends.subscriberId, s.id));
    }
    const week43 = new Date(at.getTime() + 7 * DAY);
    expect(await claim.countSkippedEmpty(w43.id, cellsOf(['ai']), monthStart, week43, db)).toBe(kept.length);
    const again = await claim.claimFresh(w43.id, target, 100, 'dbk_m2', week43, db);
    expect(again.map((r) => r.id).sort()).toEqual(freed.map((s) => s.id).sort());
  });

  it('reclaimStale takes one whole group older than 10 min and younger than 23 h, dropping ineligible members', async () => {
    const issue = await seedIssue({ status: 'sending' });
    const subs = await seedMany(4);
    const [a, b, c, d] = subs;
    const t0 = at;
    await claim.claimFresh(issue.id, { kind: 'digest', cells: cellsOf(['ai']) }, 3, 'dbk_g1', t0, db);
    await claim.claimFresh(issue.id, { kind: 'digest', cells: cellsOf(['ai']) }, 1, 'dbk_g2', new Date(t0.getTime() + MIN), db);
    expect(await claim.reclaimStale(issue.id, new Date(t0.getTime() + 9 * MIN), db)).toBeNull();
    await db.update(subscribers).set({ status: 'unsubscribed' }).where(eq(subscribers.id, b.id));
    const later = new Date(t0.getTime() + 11 * MIN);
    const g = await claim.reclaimStale(issue.id, later, db);
    expect(g).toMatchObject({ batchKey: 'dbk_g1', ineligible: 1 });
    expect(g!.rows.map((r) => r.id)).toEqual([a.id, c.id].sort());
    const rows = await sends(issue.id);
    expect(rows.find((r) => r.subscriberId === b.id)?.error).toBe('ineligible');
    // claimed_at is never moved: the 23 h expiry keeps counting from the first attempt.
    expect(rows.filter((r) => r.batchKey === 'dbk_g1').every((r) => r.claimedAt.getTime() === t0.getTime())).toBe(true);
    // Still unsent, so still the oldest stale group; `skip` passes over it to the next one.
    const t12 = new Date(t0.getTime() + 12 * MIN);
    expect(await claim.reclaimStale(issue.id, t12, db)).toMatchObject({ batchKey: 'dbk_g1', ineligible: 0, rows: [{}, {}] });
    expect(await claim.reclaimStale(issue.id, t12, db, ['dbk_g1'])).toMatchObject({ batchKey: 'dbk_g2', rows: [{ id: d.id }] });
    expect(await claim.reclaimStale(issue.id, t12, db, ['dbk_g1', 'dbk_g2'])).toBeNull();
    // Past 23 h after the claim (not after the reclaim) a group is never replayed: it expires.
    const expiry = new Date(t0.getTime() + 23 * HOUR + MIN);
    expect(await claim.reclaimStale(issue.id, expiry, db)).toBeNull();
    expect(await claim.expireOld(issue.id, expiry, db)).toBe(3);
    expect((await sends(issue.id)).filter((r) => r.error === 'expired').map((r) => r.subscriberId).sort()).toEqual([a.id, c.id, d.id].sort());
  });

  it('markSent, markError and the daily count', async () => {
    const issue = await seedIssue({ status: 'sending' });
    const subs = await seedMany(3);
    await claim.claimFresh(issue.id, { kind: 'digest', cells: cellsOf(['ai']) }, 3, 'dbk_m', at, db);
    expect(await claim.sentTodayCount(at, db)).toBe(3); // claimed today, waiting
    expect(await claim.markSent(issue.id, [{ subscriberId: subs[0].id, resendId: 'e0' }], at, db)).toBe(1);
    expect(await claim.markSent(issue.id, [{ subscriberId: subs[0].id, resendId: 'other' }], at, db)).toBe(0);
    expect(await claim.markError(issue.id, [subs[0].id, subs[1].id], 'invalid', db)).toBe(1);
    expect(await claim.markError(issue.id, [], 'invalid', db)).toBe(0);
    expect(await claim.sentTodayCount(at, db)).toBe(2); // one sent + one waiting; the invalid one doesn't count
    expect(await claim.sentTodayCount(new Date(at.getTime() + DAY), db)).toBe(0);
    expect(await claim.markError(issue.id, { allUnsent: true }, 'window_closed', db)).toBe(1);
    const rows = await sends(issue.id);
    expect(Object.fromEntries(rows.map((r) => [r.subscriberId, [r.resendId, r.error]]))).toEqual({
      [subs[0].id]: ['e0', null],
      [subs[1].id]: [null, 'invalid'],
      [subs[2].id]: [null, 'window_closed'],
    });
    expect(rows.find((r) => r.subscriberId === subs[0].id)?.sentAt?.getTime()).toBe(at.getTime());
  });
});

// ---- F19 facets in claims ---------------------------------------------------------------------

describe('claims with F19 facets (event language, online only)', () => {
  const at = new Date(SEND_AFTER.getTime() + HOUR);
  const monthStart = new Date('2026-10-01T07:00:00Z');
  /** Every stored ev_lang_pref shape: the valid one-element arrays and the ones read as "none". */
  const STORED: ((string | null)[] | null)[] = [null, [], ['en'], ['zh'], ['bilingual'], ['xx'], ['en', 'zh'], [null]];
  const ONLINE = [null, false, true] as const;

  it('the SQL variant key equals variantKey() for every stored facet shape × online × category sets × language', async () => {
    const sets = [['ai'], ['social', 'ai', 'ai', 'bogus'], [...CATEGORY_SLUGS], ['cycling', 'vc']];
    const pref = (p: (string | null)[] | null) =>
      p === null ? sql`null::text[]` : p.some((x) => x === null) ? sql`array[null]::text[]` : claim.textArray(p as string[]);
    const online = (o: boolean | null) => (o === null ? sql`null::boolean` : sql`${o}::boolean`);
    for (const locale of ['en', 'zh'] as const) {
      for (const cats of sets) {
        for (const p of STORED) {
          for (const o of ONLINE) {
            const r = (await db.execute(
              sql`select ${claim.variantKeyExpr(sql`${locale}::text`, claim.textArray(cats), pref(p), online(o))} as k`,
            )) as unknown as { rows: { k: string }[] };
            expect(r.rows[0].k).toBe(variantKey(locale, cats, facetsOf({ evLangPref: p, onlineOnly: o })));
          }
        }
      }
    }
    // Without facets, exactly the pre-F19 key.
    expect(variantKey('en', ['ai'], facetsOf({ evLangPref: null, onlineOnly: null }))).toBe('en:ai');
    expect(variantKey('zh', ['vc', 'ai'], { evLang: 'zh', onlineOnly: true })).toBe('zh:ai,vc;l=zh;o');
  });

  // Invariant: a digest claim always has picks for its variant, an empty claim never does, so a run
  // never fails a claimed row with no_picks. Checked over a matrix of subscribers for several weeks.
  const weeks: [name: string, events: Partial<DigestEvent>[]][] = [
    ['mixed', [
      { category: 'ai' },
      { category: 'ai', eventLanguage: 'zh', format: 'online' },
      { category: 'hackathon', eventLanguage: 'bilingual', format: 'hybrid' },
      { category: 'vc', eventLanguage: 'en', format: 'online' },
    ]],
    ['one Chinese in-person event', [{ category: 'ai', eventLanguage: 'zh' }]],
    ['bilingual and hybrid only', [{ category: 'social', eventLanguage: 'bilingual' }, { category: 'cycling', format: 'hybrid' }]],
    ['pre-F19 snapshot (no eventLanguage) plus an event outside the week', [
      { category: 'ai', format: 'online' },
      { category: 'campus', eventLanguage: 'zh', format: 'online', startAt: '2026-10-20T01:30:00.000Z' }, // the next week
    ]],
    ['no events', []],
  ];

  it.each(weeks)('claims agree with isEmptyFor() for every subscriber: %s', async (_name, list) => {
    const s = fixtures.snap({ events: list.map((e) => fixtures.ev(e)) });
    const cells = pickCells(s);
    const catSets = [['ai'], ['hackathon'], ['vc', 'social'], ['cycling'], ['ai', 'campus'], ['campus'], ['bogus', 'ai']];
    const subs = await seedMany(catSets.length * STORED.length * ONLINE.length, (i) => ({
      categories: catSets[i % catSets.length],
      evLangPref: STORED[Math.floor(i / catSets.length) % STORED.length] as string[] | null,
      onlineOnly: ONLINE[Math.floor(i / (catSets.length * STORED.length))],
      locale: i % 2 ? 'zh' : 'en',
    }));
    const issue = await seedIssue({ status: 'sending' });
    const got = [
      ...(await claim.claimFresh(issue.id, { kind: 'digest', cells }, 1000, 'dbk_d', at, db)),
      ...(await claim.claimFresh(issue.id, { kind: 'empty', cells, monthStart }, 1000, 'dbk_e', at, db)),
    ];
    // Everyone is claimed exactly once (nobody had a notice this month) …
    expect(got.map((r) => r.id).sort()).toEqual(subs.map((x) => x.id).sort());
    const byId = new Map(subs.map((x) => [x.id, x]));
    for (const row of got) {
      const sub = byId.get(row.id)!;
      const v = parseVariantKey(row.variantKey)!;
      // … under the key variantKey() gives their row, and as a digest exactly when their variant has picks.
      expect(row.variantKey).toBe(variantKey(sub.locale, sub.categories, facetsOf(sub)));
      expect({ key: row.variantKey, kind: row.kind }).toEqual({ key: row.variantKey, kind: isEmptyFor(s, v.categories, v) ? 'empty' : 'digest' });
    }
    expect(await claim.countSkippedEmpty(issue.id, cells, monthStart, at, db)).toBe(0);
  });

  it('a Chinese-only reader in a week of English events gets the empty notice; with a Chinese event, the digest', async () => {
    const issue = await seedIssue({ status: 'sending' });
    const zh = await seedSub({ categories: ['ai'], evLangPref: ['zh'] });
    const any = await seedSub({ categories: ['ai'] });
    const enWeek = cellsOf(['ai', 'hackathon']);
    expect(await claim.claimFresh(issue.id, { kind: 'digest', cells: enWeek }, 10, 'dbk_1', at, db)).toMatchObject([{ id: any.id, variantKey: 'en:ai' }]);
    expect(await claim.claimFresh(issue.id, { kind: 'empty', cells: enWeek, monthStart }, 10, 'dbk_2', at, db)).toMatchObject([
      { id: zh.id, kind: 'empty', variantKey: 'en:ai;l=zh' },
    ]);
    const w43 = await seedIssue({ isoWeek: '2026-W43', status: 'sending' });
    const zhWeek = [...enWeek, ...cellsOf(['ai'], 'zh')];
    const later = new Date(at.getTime() + 7 * DAY);
    expect((await claim.claimFresh(w43.id, { kind: 'digest', cells: zhWeek }, 10, 'dbk_3', later, db)).map((r) => [r.id, r.variantKey]).sort()).toEqual(
      [[zh.id, 'en:ai;l=zh'], [any.id, 'en:ai']].sort(),
    );
    // Bilingual events reach every language preference, English and bilingual-only readers included.
    const w44 = await seedIssue({ isoWeek: '2026-W44', status: 'sending' });
    const en = await seedSub({ categories: ['ai'], evLangPref: ['en'], locale: 'zh' });
    const bi = await seedSub({ categories: ['ai'], evLangPref: ['bilingual'] });
    const biWeek = cellsOf(['ai'], 'bilingual');
    const got = await claim.claimFresh(w44.id, { kind: 'digest', cells: biWeek }, 10, 'dbk_4', new Date(later.getTime() + 7 * DAY), db);
    expect(Object.fromEntries(got.map((r) => [r.id, r.variantKey]))).toEqual({
      [zh.id]: 'en:ai;l=zh', [any.id]: 'en:ai', [en.id]: 'zh:ai;l=en', [bi.id]: 'en:ai;l=bilingual',
    });
  });

  it('online only: a hybrid event reaches the reader, an in-person one does not', async () => {
    const issue = await seedIssue({ status: 'sending' });
    const remote = await seedSub({ categories: ['ai', 'hackathon'], onlineOnly: true });
    const hackOnly = await seedSub({ categories: ['hackathon'], onlineOnly: true, evLangPref: ['zh'] });
    const cells = [...cellsOf(['ai'], 'en', true), ...cellsOf(['hackathon'])]; // a hybrid AI event, an in-person hackathon
    expect(await claim.claimFresh(issue.id, { kind: 'digest', cells }, 10, 'dbk_1', at, db)).toMatchObject([{ id: remote.id, variantKey: 'en:ai,hackathon;o' }]);
    expect(await claim.claimFresh(issue.id, { kind: 'empty', cells, monthStart }, 10, 'dbk_2', at, db)).toMatchObject([
      { id: hackOnly.id, kind: 'empty', variantKey: 'en:hackathon;l=zh;o' },
    ]);
    expect(await claim.anyClaimable(issue.id, [{ kind: 'digest', cells }, { kind: 'empty', cells, monthStart }], at, db)).toBe(false);
  });

  it('runDigest: facet variants render once each, the empty notice goes to readers the facets leave with nothing', async () => {
    h.events = [
      { id: 'evt_ai_zh', category: 'ai', title: 'AI 夜', lang: 'zh', format: 'hybrid' },
      { id: 'evt_ai_en', category: 'ai', title: 'AI night' },
    ];
    const issue = await seedIssue();
    const zh = await seedMany(2, () => ({ categories: ['ai'], evLangPref: ['zh'] }));
    const remote = await seedSub({ categories: ['ai'], onlineOnly: true, evLangPref: ['en'] });
    const plain = await seedSub({ categories: ['ai'] });
    const { run, tr } = setup();
    expect(await run()).toMatchObject({ ok: true, claimed: 4, sent: 4, failed: 0, emptyNotices: 1, status: 'sent' });
    expect(h.renders.sort()).toEqual(['digest|en:ai', 'digest|en:ai;l=zh', 'empty|en:ai;l=en;o']);
    const subject = Object.fromEntries(tr.sent().map((e) => [e.to, e.subject]));
    expect(subject[zh[0].email]).toBe('en:ai;l=zh · 1 picks');
    expect(subject[plain.email]).toBe('en:ai · 2 picks');
    expect(subject[remote.email]).toBe('en:ai;l=en;o · nothing this week');
    expect((await sends(issue.id)).every((r) => r.error === null)).toBe(true);
  });
});

// ---- runDigest ----------------------------------------------------------------------------------

describe('runDigest: gates', () => {
  it("mode 'off' (Vercel without a verified sender) touches nothing at all", async () => {
    vi.stubEnv('VERCEL', '1');
    vi.stubEnv('RESEND_API_KEY', '');
    vi.stubEnv('DIGEST_SENDING', '');
    const tr = fakeTransport();
    expect(await runDigest({ db: noDb, transport: tr.t })).toMatchObject({ ok: true, skipped: 'no_verified_sender', claimed: 0, sent: 0 });
    expect(await runDigest({ db: noDb, transport: tr.t, mode: 'off' })).toMatchObject({ ok: true, skipped: 'no_verified_sender' });
    expect(tr.calls).toHaveLength(0);
  });

  it('DIGEST_SENDING=0 stops a fully configured production sender, touching nothing', async () => {
    vi.stubEnv('VERCEL', '1');
    vi.stubEnv('RESEND_API_KEY', 're_test');
    vi.stubEnv('RESEND_FROM', "Victor's Picks <hi@mail.example.org>");
    vi.stubEnv('DIGEST_SENDING', '0');
    const tr = fakeTransport();
    expect(await runDigest({ db: noDb, transport: tr.t })).toMatchObject({ ok: true, skipped: 'no_verified_sender', claimed: 0, sent: 0 });
    expect(tr.calls).toHaveLength(0);
  });

  it('without the link secret nothing is claimed', async () => {
    vi.stubEnv('SUBSCRIBER_LINK_SECRET', '');
    expect(await runDigest({ db: noDb, mode: 'live' })).toMatchObject({ ok: false, reason: 'no_link_secret' });
  });

  it('nothing due: a draft, a future issue; the lease is released', async () => {
    const draft = await seedIssue({ status: 'draft' });
    const { run, tr } = setup();
    await seedSub();
    expect(await run()).toMatchObject({ ok: true, skipped: 'nothing_due' });
    await db.update(digestIssues).set({ status: 'scheduled', sendAfter: new Date(SEND_AFTER.getTime() + 2 * HOUR) }).where(eq(digestIssues.id, draft.id));
    expect(await run()).toMatchObject({ ok: true, skipped: 'nothing_due' });
    expect(tr.calls).toHaveLength(0);
    expect(await sends()).toHaveLength(0);
    expect((await issueRow(draft.id)).status).toBe('scheduled');
    const [lease] = await db.select().from(syncState).where(eq(syncState.source, LEASE));
    expect(lease.lastRunAt).toBeNull();
  });

  it('a live lease makes a second runner back off; an expired one is taken over', async () => {
    await seedIssue();
    await seedSub();
    const { run, tr, clock } = setup();
    await db.insert(syncState).values({ source: LEASE, lastRunAt: new Date(clock.now().getTime() - MIN) });
    expect(await run()).toMatchObject({ ok: true, skipped: 'locked' });
    expect(tr.calls).toHaveLength(0);
    await db.update(syncState).set({ lastRunAt: new Date(clock.now().getTime() - 6 * MIN) }).where(eq(syncState.source, LEASE));
    expect(await run()).toMatchObject({ ok: true, sent: 1, status: 'sent' });
  });
});

describe('runDigest: sending', () => {
  it('two runs send exactly one email per eligible subscriber, then the issue is sent', async () => {
    const issue = await seedIssue();
    const eligible = [
      await seedSub({ categories: ['ai'] }),
      await seedSub({ categories: ['hackathon', 'ai'], locale: 'zh' }),
      await seedSub({ status: 'paused', pausedUntil: new Date(SEND_AFTER.getTime() - DAY), categories: ['hackathon'] }),
    ];
    await seedSub({ status: 'unsubscribed' });
    await seedSub({ status: 'suppressed' });
    await seedSub({ status: 'pending', confirmedAt: null });
    await seedSub({ status: 'paused', pausedUntil: new Date(SEND_AFTER.getTime() + 9 * DAY) });
    const { run, tr, clock } = setup();

    const first = await run();
    expect(first).toMatchObject({ ok: true, issue: WEEK, status: 'sent', claimed: 3, sent: 3, replayed: 0, failed: 0, emptyNotices: 0, batches: 1 });
    expect(first.htmlMaxBytes).toBeGreaterThan(0);
    clock.advance(HOUR); // the 02:00 run
    expect(await run()).toMatchObject({ ok: true, skipped: 'nothing_due' });

    expect(tr.sent().map((e) => e.to).sort()).toEqual(eligible.map((s) => s.email).sort());
    const row = await issueRow(issue.id);
    expect(row.status).toBe('sent');
    expect(row.sentAt?.getTime()).toBe(clock.now().getTime() - HOUR);
    expect(row.snapshot).toMatchObject({ issueId: issue.id, isoWeek: WEEK });
    expect(h.snapshots).toBe(1);
    const rows = await sends(issue.id);
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.resendId?.startsWith('re_') && r.error === null && r.kind === 'digest')).toBe(true);
    expect(Object.fromEntries(rows.map((r) => [r.subscriberId, r.variantKey]))).toEqual({
      [eligible[0].id]: 'en:ai',
      [eligible[1].id]: 'zh:ai,hackathon',
      [eligible[2].id]: 'en:hackathon',
    });
  });

  it('two runs racing (Promise.all) still send one email each', async () => {
    await seedIssue();
    const subs = await seedMany(12, (i) => ({ categories: i % 2 ? ['ai'] : ['hackathon'] }));
    const { run, tr } = setup();
    const results = await Promise.all([run(), run()]);
    expect(results.map((r) => r.skipped ?? 'ran').sort()).toEqual(['locked', 'ran']);
    expect(await run()).toMatchObject({ skipped: 'nothing_due' });
    const to = tr.sent().map((e) => e.to);
    expect(new Set(to).size).toBe(to.length);
    expect(to.sort()).toEqual(subs.map((s) => s.email).sort());
  });

  it('packs up to 100 per call across variants, renders each variant once, and paces calls 1 s apart', async () => {
    await seedIssue();
    const variants = [
      { locale: 'en' as const, categories: ['ai'] },
      { locale: 'zh' as const, categories: ['ai'] },
      { locale: 'en' as const, categories: ['ai', 'hackathon'] },
      { locale: 'zh' as const, categories: ['hackathon'] },
    ];
    await seedMany(250, (i) => variants[i % 4]);
    const { run, tr, clock } = setup();
    const r = await run();
    expect(r).toMatchObject({ ok: true, claimed: 250, sent: 250, batches: 3, status: 'sent' });
    expect(tr.calls.map((c) => c.emails.length)).toEqual([100, 100, 50]);
    expect(new Set(tr.calls[0].emails.map((e) => e.subject)).size).toBe(4); // mixed variants in one call
    expect(new Set(tr.calls.map((c) => c.key)).size).toBe(3);
    expect(h.renders.sort()).toEqual(['digest|en:ai', 'digest|en:ai,hackathon', 'digest|zh:ai', 'digest|zh:hackathon']);
    expect(clock.sleep.mock.calls.map(([ms]) => ms)).toEqual([PACE_MS, PACE_MS]);
    // Each call's payload is sorted by subscriber id (stable bytes for a replay).
    for (const c of tr.calls) {
      const ids = c.emails.map((e) => e.tags.find((t) => t.name === 'sub')!.value);
      expect(ids).toEqual([...ids].sort());
    }
  });

  it('every email has its own links, List-Unsubscribe headers and tags; no placeholder survives', async () => {
    const issue = await seedIssue();
    const en = await seedSub({ categories: ['ai'] });
    const zh = await seedSub({ categories: ['hackathon'], locale: 'zh' });
    const { run, tr } = setup();
    await run();
    const byTo = Object.fromEntries(tr.sent().map((e) => [e.to, e]));
    for (const sub of [en, zh]) {
      const e = byTo[sub.email];
      const token = linkToken(sub);
      expect(e.from).toBe("Victor's Picks <picks@mail.picks.test>");
      expect(e.headers).toEqual({
        'List-Unsubscribe': `<https://picks.test/api/unsubscribe?t=${token}>`,
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
        'X-Entity-Ref-ID': issue.id,
      });
      expect(e.tags).toEqual([
        { name: 'kind', value: 'digest' },
        { name: 'issue', value: issue.id },
        { name: 'sub', value: sub.id },
      ]);
      for (const t of e.tags) expect(t.value).toMatch(/^[a-z0-9_]+$/);
      expect(e.html).toContain(token);
      expect(e.text).toContain(token);
      expect(e.html + e.text).not.toContain('__VP_TOKEN__');
    }
    expect(byTo[zh.email].html).toContain(`https://picks.test/zh/prefs/${linkToken(zh)}`);
    expect(byTo[zh.email].subject).toBe('zh:hackathon · 1 picks');
    expect(byTo[en.email].html).not.toContain(linkToken(zh));
  });

  it('a crash between send and mark: the retry replays the same key and the same bytes', async () => {
    const issue = await seedIssue();
    const subs = await seedMany(3, (i) => ({ categories: i ? ['ai'] : ['hackathon'] }));
    const { tr, clock } = setup();
    const deps = { now: clock.now, sleep: clock.sleep, transport: tr.t, mode: 'live' as const, dailyCap: 1000 };
    await expect(runDigest({ ...deps, db: crashOnce(db, 'resend_id = v.rid') })).rejects.toThrow('connection lost');
    expect(tr.calls).toHaveLength(1);
    expect((await sends(issue.id)).every((r) => r.resendId === null && r.error === null)).toBe(true);
    // An edit after sending started must not change a replay: the snapshot is frozen.
    h.events = [{ id: 'evt_ai', category: 'ai', title: 'Renamed' }];

    clock.advance(5 * MIN); // a live claim (under 10 min) is never taken over
    expect(await runDigest({ ...deps, db })).toMatchObject({ ok: true, status: 'sending', sent: 0, replayed: 0, batches: 0 });
    expect(tr.calls).toHaveLength(1);

    clock.advance(6 * MIN);
    expect(await runDigest({ ...deps, db })).toMatchObject({ ok: true, status: 'sent', replayed: 3, sent: 0, claimed: 0 });
    expect(tr.calls).toHaveLength(2);
    expect(tr.calls[1].key).toBe(tr.calls[0].key);
    expect(tr.calls[1].json).toBe(tr.calls[0].json);
    expect(tr.calls[1].key).toBe(idempotencyKey(issue.id, subs.map((s) => s.id)));
    expect((await sends(issue.id)).every((r) => r.resendId?.startsWith('re_2_'))).toBe(true);
    expect(h.snapshots).toBe(1);
  });

  it('a replay drops members who unsubscribed meanwhile (new key: the group changed)', async () => {
    const issue = await seedIssue();
    const subs = await seedMany(3);
    const { tr, clock } = setup();
    const deps = { now: clock.now, sleep: clock.sleep, transport: tr.t, mode: 'live' as const, dailyCap: 1000 };
    await expect(runDigest({ ...deps, db: crashOnce(db, 'resend_id = v.rid') })).rejects.toThrow();
    await db.update(subscribers).set({ status: 'unsubscribed' }).where(eq(subscribers.id, subs[1].id));
    clock.advance(11 * MIN);
    expect(await runDigest({ ...deps, db })).toMatchObject({ ok: true, replayed: 2, status: 'sent' });
    expect(tr.calls[1].emails.map((e) => e.to)).not.toContain(subs[1].email);
    expect(tr.calls[1].key).not.toBe(tr.calls[0].key);
    const rows = await sends(issue.id);
    expect(rows.find((r) => r.subscriberId === subs[1].id)).toMatchObject({ resendId: null, error: 'ineligible' });
  });

  it('a replay where a member no longer builds keeps the original key (Resend answers 409, nobody mailed twice)', async () => {
    const issue = await seedIssue();
    const subs = await seedMany(3, (i) => ({ categories: i ? ['ai'] : ['hackathon'] }));
    const hack = subs[0];
    // Resend-like: the same key with the same body replays, with a different body it is a 409.
    const seen = new Map<string, string>();
    const { tr, clock } = setup(undefined, (call) => {
      const first = seen.get(call.key);
      if (first === undefined) return void seen.set(call.key, call.json);
      return first === call.json ? undefined : err('invalid_idempotent_request', 409);
    });
    const deps = { now: clock.now, sleep: clock.sleep, transport: tr.t, mode: 'live' as const, dailyCap: 1000 };
    await expect(runDigest({ ...deps, db: crashOnce(db, 'resend_id = v.rid') })).rejects.toThrow('connection lost');
    // A deploy between the attempts breaks one variant.
    h.failVariant = 'en:hackathon';
    vi.spyOn(console, 'error').mockImplementation(() => {});
    clock.advance(11 * MIN);
    expect(await runDigest({ ...deps, db })).toMatchObject({ ok: false, reason: 'render_failed', replayed: 0, failed: 3, status: 'sent' });
    expect(tr.calls).toHaveLength(2);
    expect(tr.calls[1].key).toBe(tr.calls[0].key);
    expect(tr.calls[1].key).toBe(idempotencyKey(issue.id, subs.map((s) => s.id)));
    expect(tr.calls[1].emails.map((e) => e.to)).not.toContain(hack.email);
    const rows = Object.fromEntries((await sends(issue.id)).map((r) => [r.subscriberId, r.error]));
    // replay_…: that reader may already have the first copy, so the code says so.
    expect(rows).toEqual({ [subs[0].id]: 'replay_render_failed', [subs[1].id]: 'idem_conflict', [subs[2].id]: 'idem_conflict' });
  });

  it('a replay never moves claimed_at: past 23 h after the first attempt the group expires, never re-sent', async () => {
    const issue = await seedIssue();
    await seedMany(3);
    let down = false;
    const { tr, clock } = setup(undefined, () => (down ? err('internal_server_error', 500) : undefined));
    const deps = { now: clock.now, sleep: clock.sleep, transport: tr.t, mode: 'live' as const, dailyCap: 1000 };
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const t0 = clock.now();
    // T0: Resend takes the batch (its key is kept 24 h from now), then the mark fails.
    await expect(runDigest({ ...deps, db: crashOnce(db, 'resend_id = v.rid') })).rejects.toThrow('connection lost');
    expect(tr.calls).toHaveLength(1);
    // T0+14h ("Send now" during a Resend outage): the replay fails too and leaves the claims.
    down = true;
    clock.set(new Date(t0.getTime() + 14 * HOUR));
    expect(await runDigest({ ...deps, db })).toMatchObject({ ok: false, reason: 'retry:internal_server_error', replayed: 0, status: 'sending' });
    expect(tr.calls).toHaveLength(5);
    expect((await sends(issue.id)).every((r) => r.claimedAt.getTime() === t0.getTime() && r.error === null)).toBe(true);
    // T0+24h+1m (Tuesday's run, still inside the 27 h window): Resend has forgotten the key, so a
    // replay would be a second copy. The claims expire instead.
    down = false;
    clock.set(new Date(t0.getTime() + 24 * HOUR + MIN));
    expect(await runDigest({ ...deps, db })).toMatchObject({ ok: true, failed: 3, replayed: 0, sent: 0, batches: 0, status: 'sent' });
    expect(tr.calls).toHaveLength(5);
    expect((await sends(issue.id)).every((r) => r.error === 'expired' && r.resendId === null)).toBe(true);
  });

  it('a payload error: strict is retried permissive under a derived key; rejected rows become invalid', async () => {
    const issue = await seedIssue();
    const subs = await seedMany(3);
    const { run, tr } = setup(undefined, (call, i) =>
      i === 0 ? err('validation_error', 422) : { ok: true, ids: call.emails.map((_, j) => (j === 1 ? null : `re_p_${j}`)), invalid: [1], dailyUsed: 3 },
    );
    const r = await run();
    expect(r).toMatchObject({ ok: true, sent: 2, failed: 1, status: 'sent', batches: 2 });
    expect(tr.calls.map((c) => c.mode)).toEqual(['strict', 'permissive']);
    expect(tr.calls[1].key).toBe(`${tr.calls[0].key}:p`);
    expect(tr.calls[1].json).toBe(tr.calls[0].json);
    const rows = Object.fromEntries((await sends(issue.id)).map((r) => [r.subscriberId, [r.resendId, r.error]]));
    const sorted = subs.map((s) => s.id).sort();
    expect(rows[sorted[0]]).toEqual(['re_p_0', null]);
    expect(rows[sorted[1]]).toEqual([null, 'invalid']);
    expect(rows[sorted[2]]).toEqual(['re_p_2', null]);
  });

  it('a payload error in permissive mode too marks the whole group invalid and moves on', async () => {
    const issue = await seedIssue();
    await seedMany(2);
    const { run } = setup(undefined, () => err('validation_error', 422));
    expect(await run()).toMatchObject({ ok: true, failed: 2, sent: 0, status: 'sent' });
    expect((await sends(issue.id)).every((r) => r.error === 'invalid')).toBe(true);
  });

  it('an idempotency conflict (409) marks the group idem_conflict and the run continues', async () => {
    const issue = await seedIssue();
    await seedMany(101);
    const { run, tr } = setup(undefined, (call, i) => (i === 0 ? err('invalid_idempotent_request', 409) : undefined));
    const logs: string[] = [];
    vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => void logs.push(a.join(' ')));
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await run()).toMatchObject({ ok: true, failed: 100, sent: 1, status: 'sent' });
    expect(tr.calls).toHaveLength(2);
    expect((await sends(issue.id)).filter((r) => r.error === 'idem_conflict')).toHaveLength(100);
    expect(logs.join('\n')).toContain('idempotency conflict');
    expect(logs.join('\n')).not.toContain('@');
  });

  it('a quota error stops the run with the claims intact', async () => {
    const issue = await seedIssue();
    await seedMany(3);
    const { run, tr } = setup(undefined, () => err('daily_quota_exceeded', 429));
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await run()).toMatchObject({ ok: false, partial: true, reason: 'daily_quota_exceeded', claimed: 3, sent: 0, status: 'sending' });
    expect(tr.calls).toHaveLength(1);
    const rows = await sends(issue.id);
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.resendId === null && r.error === null)).toBe(true);
    expect((await issueRow(issue.id)).status).toBe('sending');
  });

  it('transient errors are retried with the same key after a pause', async () => {
    await seedIssue();
    await seedMany(2);
    const { run, tr, clock } = setup(undefined, (_c, i) =>
      i === 0 ? err('internal_server_error', 500) : i === 1 ? err('rate_limit_exceeded', 429, 2000) : undefined,
    );
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await run()).toMatchObject({ ok: true, sent: 2, status: 'sent', batches: 3 });
    expect(new Set(tr.calls.map((c) => c.key)).size).toBe(1);
    expect(tr.calls.every((c) => c.mode === 'strict')).toBe(true);
    // Backoff 500 ms then the server's 2 s; the 1 s pacing tops each wait up to a full second.
    expect(clock.sleep.mock.calls.map(([ms]) => ms)).toEqual([500, 500, 2000]);
  });

  it('a provider that keeps failing: the run stops, the claims wait for a later run (same key)', async () => {
    const issue = await seedIssue();
    await seedMany(2);
    let down = true;
    const { run, tr, clock } = setup(undefined, () => (down ? err('application_error', null) : undefined));
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await run()).toMatchObject({ ok: false, partial: true, reason: 'retry:application_error', sent: 0, status: 'sending' });
    expect(tr.calls).toHaveLength(4);
    down = false;
    clock.advance(11 * MIN);
    expect(await run()).toMatchObject({ ok: true, replayed: 2, status: 'sent' });
    expect(new Set(tr.calls.map((c) => c.key)).size).toBe(1);
    expect((await sends(issue.id)).every((r) => r.resendId)).toBe(true);
  });

  it('a transport that throws is treated as an unknown outcome', async () => {
    await seedIssue();
    await seedMany(1);
    let i = 0;
    const clock = fakeClock(new Date(SEND_AFTER.getTime() + HOUR));
    const t: BatchTransport = async (emails) => {
      if (i++ === 0) throw new Error('boom');
      return { ok: true, ids: emails.map(() => 'r1'), invalid: [], dailyUsed: null };
    };
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await runDigest({ db, now: clock.now, sleep: clock.sleep, transport: t, mode: 'live' })).toMatchObject({ ok: true, sent: 1, batches: 2 });
  });

  it('accepted ids that cannot be paired mark the group id_mismatch (never re-sent)', async () => {
    const issue = await seedIssue();
    await seedMany(2);
    const { run } = setup(undefined, () => ({ ok: true, ids: null, invalid: [], dailyUsed: null }));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await run()).toMatchObject({ ok: true, failed: 2, sent: 0, status: 'sent' });
    expect((await sends(issue.id)).every((r) => r.error === 'id_mismatch')).toBe(true);
  });

  it('the deadline leaves the rest for the next run, which resumes', async () => {
    const issue = await seedIssue();
    await seedMany(250);
    const { run, tr, clock } = setup();
    expect(await run({ budgetMs: 900 })).toMatchObject({ ok: true, partial: true, reason: 'deadline', sent: 200, status: 'sending' });
    expect(tr.calls).toHaveLength(2);
    clock.advance(HOUR);
    expect(await run({ budgetMs: 900 })).toMatchObject({ ok: true, sent: 50, status: 'sent' });
    expect(new Set(tr.sent().map((e) => e.to)).size).toBe(250);
    expect((await sends(issue.id)).every((r) => r.resendId)).toBe(true);
  });

  it('the daily cap (UTC day) holds back the newest subscribers until the next day', async () => {
    const issue = await seedIssue();
    const subs = await seedMany(5);
    const { run, tr, clock } = setup();
    expect(await run({ dailyCap: 3 })).toMatchObject({ ok: true, partial: true, reason: 'daily_cap', sent: 3, status: 'sending' });
    expect(tr.sent().map((e) => e.to).sort()).toEqual(subs.slice(0, 3).map((s) => s.email).sort()); // oldest confirmations first
    clock.advance(HOUR);
    expect(await run({ dailyCap: 3 })).toMatchObject({ partial: true, reason: 'daily_cap', sent: 0 });
    clock.advance(23 * HOUR); // Tuesday 01:00 UTC, still inside the 27 h window
    expect(await run({ dailyCap: 3 })).toMatchObject({ ok: true, sent: 2, status: 'sent' });
    expect((await issueRow(issue.id)).status).toBe('sent');
  });

  it('reaching the cap with nobody left still finishes the issue in the same run', async () => {
    const issue = await seedIssue();
    await seedMany(3);
    const { run } = setup();
    expect(await run({ dailyCap: 3 })).toMatchObject({ ok: true, sent: 3, status: 'sent' });
    expect((await issueRow(issue.id)).status).toBe('sent');
    expect(await run({ dailyCap: 3 })).toMatchObject({ skipped: 'nothing_due' });
  });

  it('a cap of 0 sends nothing and keeps the issue sending', async () => {
    const issue = await seedIssue();
    await seedMany(1);
    const { run, tr } = setup();
    expect(await run({ dailyCap: 0 })).toMatchObject({ ok: true, partial: true, reason: 'daily_cap', claimed: 0 });
    expect(tr.calls).toHaveLength(0);
    expect((await issueRow(issue.id)).status).toBe('sending');
  });

  it('empty notice: at most one per subscriber per Pacific month, otherwise skipped without a row', async () => {
    h.events = [{ id: 'evt_ai', category: 'ai', title: 'AI night' }];
    const reader = await seedSub({ categories: ['ai'] });
    const cyclist = await seedSub({ categories: ['cycling'], locale: 'zh' });
    const w42 = await seedIssue();
    const { run, tr, clock } = setup();
    expect(await run()).toMatchObject({ ok: true, sent: 2, emptyNotices: 1, skippedEmpty: 0, status: 'sent' });
    expect(tr.calls).toHaveLength(1); // digest and empty notice share one call
    expect(tr.sent().find((e) => e.to === cyclist.email)?.subject).toBe('zh:cycling · nothing this week');
    expect((await sends(w42.id)).find((r) => r.subscriberId === cyclist.id)).toMatchObject({ kind: 'empty', variantKey: 'zh:cycling' });

    const w43 = await seedIssue({ isoWeek: '2026-W43' });
    clock.set(new Date(sendAfterFor('2026-W43').getTime() + HOUR));
    expect(await run()).toMatchObject({ ok: true, sent: 1, emptyNotices: 0, skippedEmpty: 1, status: 'sent' });
    expect((await sends(w43.id)).map((r) => r.subscriberId)).toEqual([reader.id]);

    // November in Pacific time (Sunday Nov 1, 18:00 PST): a new month, a new notice.
    const w45 = await seedIssue({ isoWeek: '2026-W45' });
    clock.set(new Date(sendAfterFor('2026-W45').getTime() + HOUR));
    expect(await run()).toMatchObject({ ok: true, sent: 2, emptyNotices: 1 });
    expect((await sends(w45.id)).find((r) => r.subscriberId === cyclist.id)?.kind).toBe('empty');
    expect(h.renders.filter((r) => r.startsWith('empty|'))).toEqual(['empty|zh:cycling', 'empty|zh:cycling']);
  });

  it('a week with no events at all: everyone gets (at most) the empty notice', async () => {
    h.events = [];
    await seedIssue();
    await seedMany(2, (i) => ({ categories: i ? ['ai'] : ['vc', 'social'] }));
    const { run } = setup();
    expect(await run()).toMatchObject({ ok: true, sent: 2, emptyNotices: 2, status: 'sent' });
  });

  it('a variant that fails to render (or is too large) loses only its own rows, and fails the run', async () => {
    const issue = await seedIssue();
    const ai = await seedSub({ categories: ['ai'] });
    const hack = await seedSub({ categories: ['hackathon'] });
    const big = await seedSub({ categories: ['hackathon'], locale: 'zh' });
    const big2 = await seedSub({ categories: ['hackathon'], locale: 'zh' });
    h.failVariant = 'en:hackathon';
    h.hugeVariant = 'zh:hackathon';
    const logs: string[] = [];
    vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => void logs.push(a.join(' ')));
    const { run, tr } = setup();
    const r = await run();
    // The rest still goes out and the issue finishes, but the run is a failure (cron 500, jobs_log ok=false).
    expect(r).toMatchObject({ ok: false, reason: 'render_failed', sent: 1, failed: 3, status: 'sent' });
    expect(r.buildFailures).toEqual({
      'digest|en:hackathon': { error: 'render_failed', rows: 1 },
      'digest|zh:hackathon': { error: 'too_large', rows: 2 },
    });
    expect(tr.sent().map((e) => e.to)).toEqual([ai.email]);
    const rows = Object.fromEntries((await sends(issue.id)).map((r) => [r.subscriberId, r.error]));
    expect(rows).toEqual({ [ai.id]: null, [hack.id]: 'render_failed', [big.id]: 'too_large', [big2.id]: 'too_large' });
    expect(logs.join('\n')).toContain('render exploded');
    expect(logs.join('\n')).toContain('DigestTooLargeError');
    expect(logs.join('\n')).not.toContain('@');
    expect(JSON.stringify(r)).not.toContain('@');
  });

  it('a quota stop after a build failure keeps its own reason; the run stays failed', async () => {
    await seedIssue();
    await seedSub({ categories: ['ai'] });
    await seedSub({ categories: ['hackathon'] });
    h.failVariant = 'en:hackathon';
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { run } = setup(undefined, () => err('daily_quota_exceeded', 429));
    expect(await run()).toMatchObject({ ok: false, reason: 'daily_quota_exceeded', failed: 1, buildFailures: { 'digest|en:hackathon': { rows: 1 } } });
  });

  it("a digest claim whose render has no picks is marked no_picks, not mailed, and fails the run", async () => {
    const issue = await seedIssue();
    const s = await seedSub({ categories: ['ai'] });
    h.nullVariant = 'en:ai';
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { run, tr } = setup();
    expect(await run()).toMatchObject({
      ok: false, reason: 'render_failed', failed: 1, sent: 0, status: 'sent', buildFailures: { 'digest|en:ai': { error: 'no_picks', rows: 1 } },
    });
    expect(tr.calls).toHaveLength(0);
    expect((await sends(issue.id))[0]).toMatchObject({ subscriberId: s.id, error: 'no_picks' });
  });

  it("dev mode without an injected transport logs masked lines and marks rows 'dev'", async () => {
    const issue = await seedIssue();
    await seedSub({ email: 'private.person@example.org' });
    const logs: string[] = [];
    vi.spyOn(console, 'info').mockImplementation((...a: unknown[]) => void logs.push(a.join(' ')));
    const clock = fakeClock(new Date(SEND_AFTER.getTime() + HOUR));
    expect(await runDigest({ db, now: clock.now, sleep: clock.sleep, mode: 'dev' })).toMatchObject({ ok: true, sent: 1, status: 'sent' });
    expect((await sends(issue.id))[0].resendId).toBe('dev');
    expect(logs.join('\n')).toContain('p***@example.org');
    expect(logs.join('\n')).not.toContain('private.person');
  });

  it('results never carry an address or a token', async () => {
    await seedIssue();
    const s = await seedSub({ email: 'private.person@example.org' });
    const { run } = setup();
    const r = await run();
    expect(JSON.stringify(r)).not.toMatch(/@|private\.person/);
    expect(JSON.stringify(r)).not.toContain(linkToken(s).split('.')[1]);
  });
});

describe('runDigest: the send window', () => {
  it('a sending issue past the late limit closes: unsent claims window_closed, status sent', async () => {
    const sendAfter = new Date(SEND_AFTER.getTime());
    const issue = await seedIssue({ status: 'sending', snapshot: { version: 1, events: [] } as never });
    const subs = await seedMany(3);
    await claim.claimFresh(issue.id, { kind: 'digest', cells: cellsOf(['ai']) }, 3, 'dbk_w', new Date(sendAfter.getTime() + 2 * HOUR), db);
    await claim.markSent(issue.id, [{ subscriberId: subs[0].id, resendId: 'e0' }], new Date(sendAfter.getTime() + 2 * HOUR), db);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { run, tr } = setup(new Date(sendAfter.getTime() + 27 * HOUR));
    expect(await run()).toMatchObject({ ok: true, skipped: 'nothing_due', closed: [WEEK], failed: 2 });
    expect(tr.calls).toHaveLength(0);
    expect((await issueRow(issue.id)).status).toBe('sent');
    expect((await sends(issue.id)).map((r) => r.error).sort()).toEqual([null, 'window_closed', 'window_closed']);
  });

  it('a scheduled issue past the late limit is not started: too_late, left scheduled', async () => {
    const issue = await seedIssue();
    await seedSub();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { run, tr } = setup(new Date(SEND_AFTER.getTime() + 27 * HOUR));
    expect(await run()).toMatchObject({ ok: true, skipped: 'nothing_due', tooLate: [WEEK] });
    expect(tr.calls).toHaveLength(0);
    expect(await sends()).toHaveLength(0);
    expect(await issueRow(issue.id)).toMatchObject({ status: 'scheduled', snapshot: null });
    // Weeks later it is no longer reported (no daily noise forever).
    const { run: later } = setup(new Date(SEND_AFTER.getTime() + 10 * DAY));
    expect(await later()).toEqual(expect.not.objectContaining({ tooLate: expect.anything() }));
  });

  it('just inside the limit (Monday evening PT) a scheduled issue still starts', async () => {
    await seedIssue();
    await seedSub();
    const { run } = setup(new Date(SEND_AFTER.getTime() + 27 * HOUR - MIN));
    expect(await run()).toMatchObject({ ok: true, sent: 1, status: 'sent' });
  });

  it('claims older than 23 h expire instead of being replayed; the issue then finishes', async () => {
    const issue = await seedIssue({ status: 'sending', snapshot: { version: 1, issueId: 'x', origin: 'https://picks.test', events: [] } as never });
    await seedMany(2);
    await claim.claimFresh(issue.id, { kind: 'digest', cells: cellsOf(['ai']) }, 2, 'dbk_x', new Date(SEND_AFTER.getTime() + HOUR), db);
    const { run, tr } = setup(new Date(SEND_AFTER.getTime() + 24 * HOUR + 2 * MIN));
    expect(await run()).toMatchObject({ ok: true, failed: 2, sent: 0, status: 'sent' });
    expect(tr.calls).toHaveLength(0);
    expect((await sends(issue.id)).every((r) => r.error === 'expired')).toBe(true);
  });

  it('the issue is only finalized once no claim is waiting', async () => {
    const issue = await seedIssue();
    await seedMany(1);
    const { tr, clock } = setup();
    const deps = { now: clock.now, sleep: clock.sleep, transport: tr.t, mode: 'live' as const, dailyCap: 1000 };
    await expect(runDigest({ ...deps, db: crashOnce(db, 'resend_id = v.rid') })).rejects.toThrow();
    clock.advance(MIN);
    expect(await runDigest({ ...deps, db })).toMatchObject({ status: 'sending' });
    expect((await issueRow(issue.id)).status).toBe('sending');
  });
});

// ---- end to end: the real assembler and renderer ----------------------------------------------

describe('runDigest with the real assemble.ts and render.ts', () => {
  const WED = new Date('2026-10-15T01:00:00Z'); // Wed Oct 14 18:00 PDT, inside 2026-W42
  let seq = 0;
  beforeEach(() => {
    h.real = true;
  });

  type CoverSpec = { kind: 'template' } | { kind: 'official' | 'host_composite'; attribution: string };

  /** A published event with the cover row a published event needs. */
  async function addEvent(over: Partial<NewEvent> & { cover?: CoverSpec } = {}) {
    const { cover = { kind: 'template' }, ...rest } = over;
    const id = rest.id ?? `evt_${String(++seq).padStart(4, '0')}`;
    const category = rest.category ?? 'ai';
    const coverId = `cov_${id.slice(4)}`;
    await db.insert(covers).values(
      cover.kind === 'template'
        ? { id: coverId, ...templateCoverRow(category, null) }
        : {
            id: coverId, kind: cover.kind, url1600: `https://blob.test/${id}-1600.webp`, url800: `https://blob.test/${id}-800.webp`,
            url400: `https://blob.test/${id}-400.webp`, urlOgEn: '', urlOgZh: '', thumbhash: 'x', dominant: '#000000', bytes: 1,
            attribution: cover.attribution,
          },
    );
    await db.insert(events).values({
      slug: `event-${id}`, status: 'published', sourceUrl: `https://luma.com/${id}`, titleEn: `Event ${id}`, titleZh: `活动 ${id}`,
      startAt: WED, tz: 'America/Los_Angeles', city: 'San Francisco', format: 'in_person', going: 'interested', ...rest,
      id, category, coverId,
    });
    return id;
  }

  /** Resend-like: the same key with the same body is a replay (same ids); a different body is a 409. */
  function resendLike() {
    const seen = new Map<string, string>();
    return (call: Call) => {
      const first = seen.get(call.key);
      if (first === undefined) return void seen.set(call.key, call.json);
      return first === call.json ? undefined : err('invalid_idempotent_request', 409);
    };
  }

  it('a crash between send and mark: the replay sends the same key and byte-identical JSON', async () => {
    const ai = await addEvent({ category: 'ai', noteEn: 'Worth the trip.', noteZh: '值得专门去。' });
    await addEvent({ category: 'hackathon', startAt: new Date('2026-10-17T17:00:00Z') });
    const issue = await seedIssue();
    const subs = [
      await seedSub({ categories: ['ai'] }),
      await seedSub({ categories: ['ai', 'hackathon'], locale: 'zh' }),
      await seedSub({ categories: ['cycling'] }), // this month's empty notice
    ];
    const { tr, clock } = setup();
    const deps = { now: clock.now, sleep: clock.sleep, transport: tr.t, mode: 'live' as const, dailyCap: 1000 };
    await expect(runDigest({ ...deps, db: crashOnce(db, 'resend_id = v.rid') })).rejects.toThrow('connection lost');
    expect(tr.calls).toHaveLength(1);
    const frozen = (await issueRow(issue.id)).snapshot;
    expect(frozen).toMatchObject({ issueId: issue.id, origin: 'https://picks.test', events: [{ id: ai }, {}] });
    // Edits after sending started don't reach the replay: the snapshot is frozen.
    await db.update(events).set({ titleEn: 'Renamed', noteEn: 'Changed my mind.' }).where(eq(events.id, ai));

    clock.advance(11 * MIN);
    expect(await runDigest({ ...deps, db })).toMatchObject({ ok: true, replayed: 3, sent: 0, emptyNotices: 1, status: 'sent' });
    expect(tr.calls).toHaveLength(2);
    expect(tr.calls[1].key).toBe(tr.calls[0].key);
    expect(tr.calls[1].key).toBe(idempotencyKey(issue.id, subs.map((s) => s.id)));
    expect(tr.calls[1].json).toBe(tr.calls[0].json);
    expect((await issueRow(issue.id)).snapshot).toEqual(frozen);
    expect(h.snapshots).toBe(1);

    const byTo = Object.fromEntries(tr.calls[1].emails.map((e) => [e.to, e]));
    for (const sub of subs) {
      const e = byTo[sub.email];
      expect(e.html).toContain(linkToken(sub));
      expect(e.text).toContain(linkToken(sub));
      expect(e.html + e.text).not.toContain('__VP_TOKEN__');
      expect(Buffer.byteLength(e.html)).toBeLessThan(90_000);
    }
    expect(byTo[subs[0].email].subject).toBe(COPY.en.subject(1, 0));
    expect(byTo[subs[0].email].html).toContain('Worth the trip.');
    expect(byTo[subs[0].email].html).not.toContain('Renamed');
    expect(byTo[subs[1].email].subject).toBe(COPY.zh.subject(2, 0));
    expect(byTo[subs[2].email].subject).toBe(COPY.en.emptySubject);
  });

  it('F19: each reader gets the events their facets allow, with the facet line; readers without facets get the pre-F19 email', async () => {
    const en = await addEvent({ category: 'ai', titleEn: 'English Agents Night' });
    await addEvent({ category: 'ai', titleEn: 'Chinese Founders Dinner', eventLanguage: 'zh', startAt: new Date('2026-10-16T02:00:00Z') });
    await addEvent({ category: 'ai', titleEn: 'Bilingual Hybrid Demo', eventLanguage: 'bilingual', format: 'hybrid', startAt: new Date('2026-10-17T02:00:00Z') });
    const issue = await seedIssue();
    const plain = await seedSub({ categories: ['ai'] });
    const zh = await seedSub({ categories: ['ai'], evLangPref: ['zh'] });
    const remoteZh = await seedSub({ categories: ['ai'], evLangPref: ['zh'], onlineOnly: true, locale: 'zh' });
    const { run, tr } = setup();
    expect(await run()).toMatchObject({ ok: true, sent: 3, failed: 0, status: 'sent' });
    expect(Object.fromEntries((await sends(issue.id)).map((r) => [r.subscriberId, r.variantKey]))).toEqual({
      [plain.id]: 'en:ai', [zh.id]: 'en:ai;l=zh', [remoteZh.id]: 'zh:ai;l=zh;o',
    });
    const byTo = Object.fromEntries(tr.sent().map((e) => [e.to, e]));
    expect(byTo[plain.email].subject).toBe(COPY.en.subject(3, 0));
    expect(byTo[plain.email].html).toContain('English Agents Night');
    expect(byTo[plain.email].html).not.toContain('You can change this in your preferences.');
    expect(byTo[zh.email].subject).toBe(COPY.en.subject(2, 0));
    expect(byTo[zh.email].html).not.toContain('English Agents Night');
    expect(byTo[zh.email].text).toContain(COPY.en.facetNote(COPY.en.facets.zh));
    expect(byTo[remoteZh.email].subject).toBe(COPY.zh.subject(1, 0));
    expect(byTo[remoteZh.email].text).toContain('只收：线上（含线上线下同步）的中文或双语活动。');
    expect(byTo[remoteZh.email].html).not.toContain(`/events/event-${en}`);
  });

  it('F19: a claim keeps its variant: a pre-F19 key replays byte-identically after the reader sets facets', async () => {
    await addEvent({ category: 'ai', titleEn: 'English Agents Night' });
    await addEvent({ category: 'ai', titleEn: 'Chinese Founders Dinner', eventLanguage: 'zh', startAt: new Date('2026-10-16T02:00:00Z') });
    const issue = await seedIssue();
    const sub = await seedSub({ categories: ['ai'] });
    const { tr, clock } = setup();
    const deps = { now: clock.now, sleep: clock.sleep, transport: tr.t, mode: 'live' as const, dailyCap: 1000 };
    await expect(runDigest({ ...deps, db: crashOnce(db, 'resend_id = v.rid') })).rejects.toThrow('connection lost');
    expect(await sends(issue.id)).toMatchObject([{ subscriberId: sub.id, variantKey: 'en:ai', resendId: null }]);
    // Mid-issue the reader narrows to Chinese events, online only: the claimed email doesn't change.
    await db.update(subscribers).set({ evLangPref: ['zh'], onlineOnly: true }).where(eq(subscribers.id, sub.id));
    clock.advance(11 * MIN);
    expect(await runDigest({ ...deps, db })).toMatchObject({ ok: true, replayed: 1, failed: 0, status: 'sent' });
    expect(tr.calls[1].key).toBe(tr.calls[0].key);
    expect(tr.calls[1].json).toBe(tr.calls[0].json);
    expect(tr.calls[1].emails[0].subject).toBe(COPY.en.subject(2, 0));
    expect(tr.calls[1].emails[0].text).not.toContain('Only:');
  });

  it('an over-size variant is refused as too_large by the real renderer, and the run fails', async () => {
    await addEvent({ category: 'ai' });
    // A very long English intro: the English digest is over 90 KB, the Chinese one is fine.
    const introEn = Array.from({ length: 400 }, (_, i) => `Line ${i}: ${'a long sentence of intro text, '.repeat(8)}`).join('\n');
    const issue = await seedIssue({ introEn });
    const en = await seedSub({ categories: ['ai'] });
    const zh = await seedSub({ categories: ['ai'], locale: 'zh' });
    const logs: string[] = [];
    vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => void logs.push(a.join(' ')));
    const { run, tr } = setup();
    const r = await run();
    expect(r).toMatchObject({
      ok: false, reason: 'render_failed', sent: 1, failed: 1, status: 'sent', buildFailures: { 'digest|en:ai': { error: 'too_large', rows: 1 } },
    });
    expect(tr.sent().map((e) => e.to)).toEqual([zh.email]);
    expect((await sends(issue.id)).find((x) => x.subscriberId === en.id)).toMatchObject({ resendId: null, error: 'too_large' });
    expect(logs.join('\n')).toMatch(/digest\|en:ai: .*bytes \(limit 90000\)/);
  });

  it('kill switches turned on mid-send narrow the rest of the issue, stored, and never widen it again', async () => {
    // A public "going" seal (listed platform) and an official cover from a non-Luma page (kept in email).
    await addEvent({
      id: 'evt_kill', category: 'ai', going: 'going', sourceUrl: 'https://partiful.com/e/evt0001',
      cover: { kind: 'official', attribution: 'Cover: Example Labs via Partiful' },
    });
    const issue = await seedIssue();
    await seedMany(3);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { run, tr, clock } = setup();
    expect(await run({ dailyCap: 1 })).toMatchObject({ ok: true, sent: 1, partial: true, reason: 'daily_cap', status: 'sending' });
    const monday = tr.calls[0].emails[0];
    expect(monday.subject).toBe(COPY.en.subject(1, 1));
    expect(monday.html).toContain('/og/seal/going');
    expect(monday.html).toContain('https://picks.test/og/email-cover/cov_kill');
    expect(monday.html).toContain('Cover: Example Labs via Partiful');

    // That night Victor turns attendance off and sends official covers to the template.
    await db.insert(settings).values([
      { key: 'show_attendance', value: { on: false } },
      { key: 'official_covers_to_template', value: { on: true } },
    ]);
    clock.advance(24 * HOUR); // Tuesday 01:00 UTC, still inside the 27 h window
    expect(await run({ dailyCap: 1 })).toMatchObject({ ok: true, sent: 1, narrowed: ['attendance_off', 'covers_to_template'], status: 'sending' });
    const tuesday = tr.calls[1].emails[0];
    expect(tuesday.subject).toBe(COPY.en.subject(1, 0));
    expect(tuesday.html).not.toContain('/og/seal/');
    expect(tuesday.html).not.toContain('/og/email-cover/');
    expect(tuesday.html).toContain('https://picks.test/og/template/ai?s=192');
    expect(tuesday.html).not.toContain('Example Labs');
    const stored = (await issueRow(issue.id)).snapshot as DigestSnapshot;
    expect(stored).toMatchObject({ showAttendance: false, events: [{ seal: null, coverCredit: null, coverUrl: 'https://picks.test/og/template/ai?s=192' }] });

    // Switching both back doesn't bring the seal or the cover back for the rest of this issue.
    await db.update(settings).set({ value: { on: true } }).where(eq(settings.key, 'show_attendance'));
    await db.update(settings).set({ value: { on: false } }).where(eq(settings.key, 'official_covers_to_template'));
    clock.advance(HOUR);
    const last = await run();
    expect(last).toMatchObject({ ok: true, sent: 1, status: 'sent' });
    expect(last.narrowed).toBeUndefined();
    expect(tr.calls[2].emails[0].subject).toBe(COPY.en.subject(1, 0));
    expect(tr.calls[2].emails[0].html).not.toContain('/og/seal/');
    expect(tr.calls[2].emails[0].html).not.toContain('/og/email-cover/');
    expect((await issueRow(issue.id)).snapshot).toEqual(stored);
  });

  it('a replay after the kill switch went off: the narrowed bytes get a 409, nobody is mailed twice', async () => {
    await addEvent({ category: 'ai', going: 'going' });
    const issue = await seedIssue();
    await seedMany(2);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { tr, clock } = setup(undefined, resendLike());
    const deps = { now: clock.now, sleep: clock.sleep, transport: tr.t, mode: 'live' as const, dailyCap: 1000 };
    await expect(runDigest({ ...deps, db: crashOnce(db, 'resend_id = v.rid') })).rejects.toThrow('connection lost');
    expect(tr.calls[0].emails[0].html).toContain('/og/seal/going');
    vi.stubEnv('SHOW_ATTENDANCE', 'false'); // the deploy-time override counts too
    clock.advance(11 * MIN);
    expect(await runDigest({ ...deps, db })).toMatchObject({ ok: true, replayed: 0, failed: 2, narrowed: ['attendance_off'], status: 'sent' });
    expect(tr.calls).toHaveLength(2);
    expect(tr.calls[1].key).toBe(tr.calls[0].key);
    expect(tr.calls[1].emails[0].html).not.toContain('/og/seal/');
    expect((await sends(issue.id)).every((r) => r.error === 'idem_conflict')).toBe(true);
  });
});
