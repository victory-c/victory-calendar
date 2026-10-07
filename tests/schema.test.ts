import { eq, sql } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { alertSends, covers, eventSources, events, eventsPublic, goingMarks, settings, subscribers } from '@/lib/db/schema';
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

describe('migration 0004: going alerts (F20)', () => {
  const SUB = 'sub_0000000000000001';
  const send = (over: Partial<typeof alertSends.$inferInsert> = {}) =>
    h.db.insert(alertSends).values({ alertDay: '2026-10-07', subscriberId: SUB, eventIds: ['e1'], variantKey: 'en:e1', ...over });

  beforeAll(async () => {
    await h.db.insert(subscribers).values({ id: SUB, email: 'reader@example.org', status: 'active', categories: ['ai'] });
  });

  it('subscribers.going_alerts_since is a nullable timestamptz', async () => {
    const [row] = await h.db.select().from(subscribers).where(eq(subscribers.id, SUB));
    expect(row.goingAlertsSince).toBeNull();
    const at = new Date('2026-10-01T15:00:00Z');
    await h.db.update(subscribers).set({ goingAlertsSince: at }).where(eq(subscribers.id, SUB));
    expect((await h.db.select().from(subscribers).where(eq(subscribers.id, SUB)))[0].goingAlertsSince?.getTime()).toBe(at.getTime());
  });

  it('going_marks: one row per event, alert on by default, gone with its event', async () => {
    await h.db.insert(events).values({ id: 'e_mark', slug: 'e-mark', sourceUrl: 'https://luma.com/mark' });
    await h.db.insert(goingMarks).values({ eventId: 'e_mark', markedAt: new Date('2026-10-06T18:00:00Z') });
    expect((await h.db.select().from(goingMarks)).map((r) => [r.eventId, r.alert])).toEqual([['e_mark', true]]);
    await expect(h.db.insert(goingMarks).values({ eventId: 'e_mark', markedAt: new Date() })).rejects.toThrow();
    await expect(h.db.insert(goingMarks).values({ eventId: 'no_such_event', markedAt: new Date() })).rejects.toThrow();
    await h.db.execute(sql`delete from events where id = 'e_mark'`);
    expect(await h.db.select().from(goingMarks)).toEqual([]);
  });

  it('alert_sends: at most one row per subscriber per day (A2)', async () => {
    await send();
    await expect(send({ eventIds: ['e2'], variantKey: 'en:e2' })).rejects.toThrow();
    await send({ alertDay: '2026-10-08' });
    const rows = await h.db.select().from(alertSends);
    expect(rows.map((r) => r.alertDay).sort()).toEqual(['2026-10-07', '2026-10-08']);
    expect(rows[0].claimedAt).toBeInstanceOf(Date);
    expect(rows.every((r) => r.resendId === null && r.error === null && r.batchKey === null)).toBe(true);
  });

  it('alert_sends: a yyyy-mm-dd day, 1–20 events and a real subscriber', async () => {
    for (const alertDay of ['2026-10-7', '20261009', 'today', '2026-10-09T00:00']) {
      await expect(send({ alertDay })).rejects.toThrow();
    }
    await expect(send({ alertDay: '2026-10-10', eventIds: [] })).rejects.toThrow();
    await expect(send({ alertDay: '2026-10-11', eventIds: Array.from({ length: 21 }, (_, i) => `e${i}`) })).rejects.toThrow();
    await send({ alertDay: '2026-10-12', eventIds: Array.from({ length: 20 }, (_, i) => `e${i}`) });
    await expect(send({ alertDay: '2026-10-13', subscriberId: 'sub_0000000000000999' })).rejects.toThrow();
  });

  it('indexes the pending claims (partial) and the event ids (GIN)', async () => {
    const res = await h.db.execute(sql`select indexname, indexdef from pg_indexes where tablename = 'alert_sends' order by 1`);
    const defs = Object.fromEntries((res.rows as { indexname: string; indexdef: string }[]).map((r) => [r.indexname, r.indexdef]));
    expect(defs.alert_sends_pending).toMatch(/\(alert_day, batch_key\) WHERE \(\(resend_id IS NULL\) AND \(error IS NULL\)\)/);
    expect(defs.alert_sends_events).toMatch(/USING gin \(event_ids\)/);
  });
});
