import { beforeEach, describe, expect, it } from 'vitest';
import type { DB } from '@/lib/db';
import { covers, events } from '@/lib/db/schema';
import { templateCoverRow } from '@/lib/covers/template';
import { publicEvents } from '@/lib/events/public-rows';
import { testDb } from './helpers/pglite';

// The uncached public read behind the site's cached queries and the digest. A slug lookup must
// find the event whenever it starts (a regression once filtered it to an empty date range, so every
// event page 404'd with a database configured).

let db: DB;
beforeEach(async () => {
  db = (await testDb()).db as unknown as DB;
  await db.insert(covers).values({ id: 'cov_t', ...templateCoverRow('ai', null) });
  const base = { sourceUrl: 'https://luma.com/x', category: 'ai' as const, coverId: 'cov_t', createdVia: 'admin' as const, publishedAt: new Date() };
  await db.insert(events).values([
    { ...base, id: 'evt_past', slug: 'past', status: 'published' as const, titleEn: 'Past', startAt: new Date('2020-01-01T02:00:00Z') },
    { ...base, id: 'evt_next', slug: 'next', status: 'published' as const, titleEn: 'Next', startAt: new Date('2030-01-01T02:00:00Z') },
    { ...base, id: 'evt_gone', slug: 'gone', status: 'cancelled' as const, titleEn: 'Gone', startAt: new Date('2030-01-02T02:00:00Z') },
    { ...base, id: 'evt_draft', slug: 'draft', status: 'draft' as const, titleEn: 'Draft', startAt: new Date('2030-01-03T02:00:00Z') },
  ]);
});

describe('publicEvents', () => {
  it('finds a slug whatever the date', async () => {
    expect((await publicEvents({ slug: 'past', db })).map((e) => e.id)).toEqual(['evt_past']);
    expect((await publicEvents({ slug: 'next', db })).map((e) => e.id)).toEqual(['evt_next']);
  });

  it('never returns drafts; cancelled only when asked for', async () => {
    expect(await publicEvents({ slug: 'draft', db })).toEqual([]);
    expect((await publicEvents({ slug: 'gone', db })).map((e) => e.status)).toEqual(['cancelled']);
    expect(await publicEvents({ slug: 'gone', statuses: ['published'], db })).toEqual([]);
  });

  it('filters by start range and by ids', async () => {
    const r = await publicEvents({ from: new Date('2029-12-31T00:00:00Z'), to: new Date('2030-01-05T00:00:00Z'), statuses: ['published'], db });
    expect(r.map((e) => e.id)).toEqual(['evt_next']);
    expect((await publicEvents({ ids: ['evt_past', 'evt_draft'], db })).map((e) => e.id)).toEqual(['evt_past']);
    expect(await publicEvents({ ids: [], db })).toEqual([]);
  });
});
