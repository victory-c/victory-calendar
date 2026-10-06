import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  cancelEvent, confirmAi, dismissDraft, fromWallTime, getAdminEvent, listDrafts, listLive, publish, saveEvent, setGoing,
  toWallTime, unpublish,
} from '@/lib/admin/events';
import type { DB } from '@/lib/db';
import { covers, events } from '@/lib/db/schema';
import { testDb } from './helpers/pglite';

let db: DB;
beforeEach(async () => {
  db = (await testDb()).db as unknown as DB;
  await db.insert(events).values({
    id: 'evt_1', slug: 'agent-night', status: 'draft', sourceUrl: 'https://luma.com/abcd1234', titleEn: 'Agent Night',
    titleZh: 'Agent 之夜', category: 'hackathon', startAt: new Date('2026-10-08T01:00:00Z'), tz: 'America/Los_Angeles',
    hostName: 'Example Labs', venueName: 'Example Labs', city: 'San Francisco', format: 'in_person',
    autoFields: ['title_zh', 'summary_en', 'category'],
  });
});
const get = async () => (await getAdminEvent('evt_1', db))!;

describe('wall time', () => {
  it('round-trips through the event zone, across DST', () => {
    expect(toWallTime(new Date('2026-10-08T01:00:00Z'), 'America/Los_Angeles')).toBe('2026-10-07T18:00');
    expect(fromWallTime('2026-10-07T18:00', 'America/Los_Angeles')?.toISOString()).toBe('2026-10-08T01:00:00.000Z');
    expect(fromWallTime('2026-11-10T18:00', 'America/Los_Angeles')?.toISOString()).toBe('2026-11-11T02:00:00.000Z');
    expect(fromWallTime('2026-10-07T18:00', 'Asia/Shanghai')?.toISOString()).toBe('2026-10-07T10:00:00.000Z');
    expect(fromWallTime('', 'UTC')).toBeNull();
    expect(fromWallTime('tomorrow', 'UTC')).toBeNull();
  });
});

describe('saveEvent', () => {
  it('saves changes, confirms edited AI fields, keeps others', async () => {
    const { changed } = await saveEvent('evt_1', { titleZh: 'Agent 开发之夜', summaryEn: '  Build agents.  ', summaryZh: '', start: '2026-10-07T19:00' }, db);
    expect(changed.sort()).toEqual(['startAt', 'summaryEn', 'titleZh'].sort());
    const e = await get();
    expect(e.titleZh).toBe('Agent 开发之夜');
    expect(e.summaryEn).toBe('Build agents.');
    expect(e.summaryZh).toBeNull(); // '' → null, unchanged, not in changed
    expect(e.startAt?.toISOString()).toBe('2026-10-08T02:00:00.000Z');
    expect(e.autoFields).toEqual(['category']);
    expect(e.sequence).toBe(0); // drafts don't bump SEQUENCE
  });

  it('bumps SEQUENCE for calendar-visible changes once published, not for text', async () => {
    await saveEvent('evt_1', { noteEn: 'Good one' }, db);
    await publish('evt_1', new Date(), db);
    await saveEvent('evt_1', { noteEn: 'Still good' }, db);
    expect((await get()).sequence).toBe(0);
    await saveEvent('evt_1', { venueName: 'Somewhere else' }, db);
    expect((await get()).sequence).toBe(1);
  });

  it('keeps the instant honest when the zone changes', async () => {
    await saveEvent('evt_1', { tz: 'America/New_York' }, db);
    const e = await get();
    expect(toWallTime(e.startAt, 'America/New_York')).toBe('2026-10-07T18:00');
  });

  it('rejects bad input', async () => {
    await expect(saveEvent('evt_1', { start: '2026-10-07T20:00', end: '2026-10-07T19:00' }, db)).rejects.toThrow('end_before_start');
    await expect(saveEvent('evt_1', { tz: 'Mars/Olympus' }, db)).rejects.toThrow();
    await expect(saveEvent('evt_1', { sourceUrl: 'https://u:p@example.org/e' }, db)).rejects.toThrow('source_url');
  });

  it('scrubs URLs and derives the region from the city', async () => {
    await saveEvent('evt_1', { sourceUrl: 'https://example.org/e?id=1&token=x', hostUrl: 'https://example.org/org?sig=1', city: 'Berkeley' }, db);
    const e = await get();
    expect(e.sourceUrl).toBe('https://example.org/e?id=1');
    expect(e.hostUrl).toBe('https://example.org/org');
    expect(e.region).toBe('east_bay');
  });

  it('re-points a template cover when the category changes', async () => {
    await saveEvent('evt_1', { noteEn: 'x' }, db);
    await publish('evt_1', new Date(), db);
    await saveEvent('evt_1', { category: 'ai' }, db);
    const e = await get();
    expect(e.cover?.url1600).toMatch(/\/og\/template\/ai\?/);
  });

  it('refuses to clear start or category on a published event', async () => {
    await saveEvent('evt_1', { noteEn: 'x' }, db);
    await publish('evt_1', new Date(), db);
    await expect(saveEvent('evt_1', { category: '' }, db)).rejects.toThrow('published_needs_start_and_category');
  });
});

describe('status', () => {
  it('publish checks the gate and adds a template cover', async () => {
    expect(await publish('evt_1', new Date(), db)).toEqual({ ok: false, blockers: ['note'] });
    await saveEvent('evt_1', { noteZh: '值得去' }, db);
    const at = new Date('2026-10-01T00:00:00Z');
    expect((await publish('evt_1', at, db)).ok).toBe(true);
    const e = await get();
    expect(e).toMatchObject({ status: 'published', publishedAt: at });
    expect(e.cover?.kind).toBe('template');
    expect(await db.select().from(covers)).toHaveLength(1);
  });

  it('cancel, restore, unpublish, dismiss', async () => {
    await saveEvent('evt_1', { noteEn: 'x' }, db);
    await publish('evt_1', new Date(), db);
    await cancelEvent('evt_1', db);
    expect(await get()).toMatchObject({ status: 'cancelled', sequence: 1 });
    await publish('evt_1', new Date(), db);
    expect(await get()).toMatchObject({ status: 'published', sequence: 2 });
    await unpublish('evt_1', db);
    expect((await get()).status).toBe('archived');
    await db.insert(events).values({ id: 'evt_2', slug: 'x', sourceUrl: 'https://example.org/x' });
    await dismissDraft('evt_2', db);
    expect((await getAdminEvent('evt_2', db))!.status).toBe('archived');
  });

  it('confirmAi clears chips', async () => {
    await confirmAi('evt_1', ['category'], db);
    expect((await get()).autoFields).toEqual(['title_zh', 'summary_en']);
    await confirmAi('evt_1', undefined, db);
    expect((await get()).autoFields).toEqual([]);
  });

  it('lists drafts and live groups', async () => {
    expect((await listDrafts(db)).map((e) => e.id)).toEqual(['evt_1']);
    await saveEvent('evt_1', { noteEn: 'x' }, db);
    await publish('evt_1', new Date(), db);
    const live = await listLive(new Date('2026-10-05T00:00:00Z'), db);
    expect(live.week.map((e) => e.id)).toEqual(['evt_1']);
    const later = await listLive(new Date('2026-09-20T00:00:00Z'), db);
    expect(later.later.map((e) => e.id)).toEqual(['evt_1']);
    const past = await listLive(new Date('2026-10-20T00:00:00Z'), db);
    expect(past.past.map((e) => e.id)).toEqual(['evt_1']);
  });
});

describe('setGoing (safety rules)', () => {
  it('keeps a public going on a listed platform and public venue', async () => {
    // A draft: nothing is publicly going yet, so no alert (tests/alerts-marks.test.ts covers marks).
    expect(await setGoing('evt_1', 'going', 'public', db)).toEqual({ going: 'going', visibility: 'public', reason: null, alert: 'none', startAt: expect.any(Date) });
  });

  it('downgrades to after_event with the reason', async () => {
    await db.update(events).set({ privateVenue: true }).where(eq(events.id, 'evt_1'));
    expect(await setGoing('evt_1', 'going', 'public', db)).toMatchObject({ visibility: 'after_event', reason: 'private_venue' });
    await db.update(events).set({ privateVenue: false, category: 'cycling' }).where(eq(events.id, 'evt_1'));
    expect((await setGoing('evt_1', 'going', 'public', db)).reason).toBe('cycling');
    await db.update(events).set({ category: 'ai', sourceUrl: 'https://example.org/party' }).where(eq(events.id, 'evt_1'));
    expect((await setGoing('evt_1', 'going', 'public', db)).reason).toBe('not_on_listed_platform');
  });

  it('treats same host and venue within 4 weeks as recurring', async () => {
    await db.insert(events).values({
      id: 'evt_2', slug: 'agent-night-2', sourceUrl: 'https://luma.com/efgh5678', hostName: 'Example Labs',
      venueName: 'Example Labs', startAt: new Date('2026-10-22T01:00:00Z'),
    });
    expect((await setGoing('evt_1', 'going', 'public', db)).reason).toBe('recurring');
  });

  it('never touches hosting/speaking or non-public choices', async () => {
    await db.update(events).set({ privateVenue: true }).where(eq(events.id, 'evt_1'));
    expect(await setGoing('evt_1', 'hosting', 'public', db)).toMatchObject({ visibility: 'public', reason: null });
    expect(await setGoing('evt_1', 'going', 'hidden', db)).toMatchObject({ visibility: 'hidden', reason: null });
  });
});
