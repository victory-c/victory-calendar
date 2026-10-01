import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { testDb } from './helpers/pglite';

// PRD F15 acceptance: ticking 6 rows makes 6 drafts; going on a row is independent of publishing.
const h = vi.hoisted(() => ({ db: null as unknown, tags: [] as string[] }));
vi.mock('@/lib/db', async (orig) => ({ ...(await orig()), db: new Proxy({}, { get: (_t, p) => Reflect.get(h.db as object, p) }), hasDatabase: () => true }));
vi.mock('@/lib/admin-session', () => ({ requireAdmin: async () => ({ user: { email: 'v@example.org' } }) }));
vi.mock('next/cache', () => ({ refresh: () => {}, updateTag: (t: string) => h.tags.push(t), revalidateTag: (t: string) => h.tags.push(t) }));
vi.mock('next/server', async (orig) => ({ ...(await orig()), after: () => {} }));

const { addCandidates, setCandidateGoing } = await import('@/app/admin/inbox-actions');
const { upsertCandidate } = await import('@/lib/inbox/candidates');
const { candidates, events } = await import('@/lib/db/schema');
const { __setHopForTests } = await import('@/lib/ingest/safe-fetch');
type DB = import('@/lib/db').DB;

let restoreHop: () => void;
beforeAll(() => {
  process.env.INGEST_AI = 'off';
  // Every page is unreadable, so each row becomes a minimal draft titled from the calendar.
  restoreHop = __setHopForTests(async () => ({ status: 404, headers: {}, body: { async *[Symbol.asyncIterator]() {}, destroy() {} } }));
});
afterAll(() => {
  restoreHop();
  delete process.env.INGEST_AI;
});
beforeEach(async () => {
  h.db = (await testDb()).db;
  h.tags = [];
});
const db = () => h.db as DB;

async function seed(n: number, links = true) {
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    const r = await upsertCandidate(
      {
        sourceKind: 'gcal', sourceRef: `uid-${i}`, providerKey: null, icalUid: `uid-${i}`, title: `Candidate ${i}`,
        startAt: new Date(Date.UTC(2026, 9, 10 + i, 1)), endAt: null, location: null,
        links: links ? [`https://example.org/event-${i}`] : [], snippet: null,
      },
      { db: db() },
    );
    ids.push(r!.id);
  }
  return ids;
}

describe('addCandidates', () => {
  it('six ticked rows become six drafts, and the rows show 已添加', async () => {
    const ids = await seed(6);
    const r = await addCandidates(ids, false);
    expect(r).toMatchObject({ ok: true });
    const evs = await db().select().from(events);
    expect(evs).toHaveLength(6);
    expect(evs.every((e) => e.status === 'draft' && e.createdVia === 'inbox')).toBe(true);
    expect(evs.map((e) => e.titleEn).sort()).toEqual(ids.map((_, i) => `Candidate ${i}`));
    const rows = await db().select().from(candidates);
    expect(rows.every((c) => c.state === 'added' && c.eventId)).toBe(true);
    expect(h.tags).toEqual([]); // nothing published, nothing public changed
    // Adding again is a no-op.
    await addCandidates(ids, false);
    expect(await db().$count(events)).toBe(6);
  });

  it('rows without a link are reported, not dropped silently', async () => {
    const [id] = await seed(1, false);
    const r = await addCandidates([id], false);
    expect(r?.ok).toBe(false);
    expect(r?.message).toContain('没有链接');
  });
});

describe('setCandidateGoing', () => {
  it('records going on a draft without publishing it', async () => {
    const [id] = await seed(1);
    expect(await setCandidateGoing(id, 'going')).toMatchObject({ ok: true });
    const [c] = await db().select().from(candidates).where(eq(candidates.id, id));
    const [e] = await db().select().from(events).where(eq(events.id, c.eventId!));
    expect(e.status).toBe('draft');
    expect(e.going).toBe('going');
    await setCandidateGoing(id, 'none');
    const [again] = await db().select().from(events).where(eq(events.id, c.eventId!));
    expect(again.going).toBe('none');
    expect(await db().$count(events)).toBe(1);
  });

  it("'none' on a row that isn't added does nothing", async () => {
    const [id] = await seed(1);
    await setCandidateGoing(id, 'none');
    expect(await db().$count(events)).toBe(0);
  });
});
