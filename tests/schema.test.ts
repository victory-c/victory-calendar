import { eq, sql } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { covers, eventSources, events, eventsPublic, settings } from '@/lib/db/schema';
import { testDb } from './helpers/pglite';

let h: Awaited<ReturnType<typeof testDb>>;
beforeAll(async () => {
  h = await testDb();
});

const cover = {
  id: 'cov_1', kind: 'template' as const, url1600: 'x', url800: 'x', url400: 'x', urlOgEn: 'x', urlOgZh: 'x',
  thumbhash: 'x', dominant: 'rgb(0 0 0)', bytes: 1,
};

describe('schema', () => {
  it('rejects publishing without start_at, category and cover', async () => {
    await expect(
      h.db.insert(events).values({ id: 'e0', slug: 'e0', status: 'published', sourceUrl: 'https://luma.com/x' }),
    ).rejects.toThrow();
  });

  it('accepts a complete published event and defaults going to interested/public', async () => {
    await h.db.insert(covers).values(cover);
    await h.db.insert(events).values({
      id: 'e1', slug: 'ai-tinkerers-oct', status: 'published', sourceUrl: 'https://luma.com/abc',
      startAt: new Date('2026-10-08T01:30:00Z'), category: 'ai', coverId: 'cov_1',
      address: '123 Main St Apt 4', titleEn: 'AI Tinkerers SF',
    });
    const [row] = await h.db.select().from(events).where(eq(events.id, 'e1'));
    expect(row.going).toBe('interested');
    expect(row.goingVisibility).toBe('public');
    expect(row.addressPublic).toBe(false);
  });

  it('rejects categories outside the fixed 7', async () => {
    await expect(
      h.db.execute(sql`insert into events (id, slug, source_url, category) values ('e2','e2','u','crypto')`),
    ).rejects.toThrow();
  });

  it('dedupes on (platform, external_id)', async () => {
    await h.db.insert(eventSources).values({ eventId: 'e1', platform: 'luma', externalId: 'evt-1', url: 'u' });
    await h.db.insert(events).values({ id: 'e3', slug: 'e3', sourceUrl: 'https://luma.com/abc2' });
    await expect(
      h.db.insert(eventSources).values({ eventId: 'e3', platform: 'luma', externalId: 'evt-1', url: 'u' }),
    ).rejects.toThrow();
  });

  it('events_public hides private addresses and internal columns', async () => {
    const [row] = await h.db.select().from(eventsPublic).where(eq(eventsPublic.id, 'e1'));
    expect(row.address).toBeNull();
    expect('autoFields' in row).toBe(false);
    expect('createdVia' in row).toBe(false);
    await h.db.update(events).set({ addressPublic: true }).where(eq(events.id, 'e1'));
    const [pub] = await h.db.select().from(eventsPublic).where(eq(eventsPublic.id, 'e1'));
    expect(pub.address).toBe('123 Main St Apt 4');
  });

  it('settings holds jsonb rows', async () => {
    await h.db.insert(settings).values({ key: 'show_attendance', value: { on: true } });
    const [row] = await h.db.select().from(settings);
    expect(row.value).toEqual({ on: true });
  });

  it('indexes the canonical URL columns ingest dedupes on', async () => {
    const res = await h.db.execute(sql`select indexname from pg_indexes where indexname in ('events_source_url', 'event_sources_url') order by 1`);
    expect((res.rows as { indexname: string }[]).map((r) => r.indexname)).toEqual(['event_sources_url', 'events_source_url']);
  });
});
