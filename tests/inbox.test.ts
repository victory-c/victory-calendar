import { readFileSync } from 'node:fs';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DB } from '@/lib/db';
import { candidates, candidateSightings, eventSources, events, jobsLog, syncState } from '@/lib/db/schema';
import {
  clearInbox, dismissCandidates, expireCandidates, listInbox, restoreCandidates, snoozeCandidates, upsertCandidate, viewOf,
} from '@/lib/inbox/candidates';
import { pushCandidates } from '@/lib/inbox/push';
import { parseFeed, snippetOf, syncIcsFeeds } from '@/lib/inbox/sync-ics';
import { SafeFetchError } from '@/lib/ingest/safe-fetch';
import { testDb } from './helpers/pglite';

const gcal = readFileSync('fixtures/gcal-feed.ics', 'utf8');
const luma = readFileSync('fixtures/luma-feed.ics', 'utf8');
const NOW = new Date('2026-10-01T12:00:00Z');
const URLS = { gcal: 'https://calendar.example.test/secret-gcal.ics', luma: 'https://api.example.test/secret-luma.ics' };

let db: DB;
beforeEach(async () => {
  db = (await testDb()).db as unknown as DB;
  process.env.GCAL_SECRET_ICS_URL = URLS.gcal;
  process.env.LUMA_PERSONAL_ICS_URL = URLS.luma;
  delete process.env.PARTIFUL_ICS_URL;
  process.env.INBOX_EMAILS = 'test@example.org';
});
afterEach(() => {
  delete process.env.GCAL_SECRET_ICS_URL;
  delete process.env.LUMA_PERSONAL_ICS_URL;
  delete process.env.INBOX_EMAILS;
});

const feeds: Record<string, string> = { [URLS.gcal]: gcal, [URLS.luma]: luma };
const fetchText = async (url: string) => {
  if (!(url in feeds)) throw new SafeFetchError('status', 'HTTP 404', 404);
  return feeds[url];
};
const sync = (over: Parameters<typeof syncIcsFeeds>[0] = {}) => syncIcsFeeds({ db, now: NOW, fetchText, cooldownMs: 0, ...over });

describe('parseFeed', () => {
  const entries = parseFeed(gcal, 'gcal', NOW, ['test@example.org']);
  const titles = entries.map((e) => e.title);

  it('keeps only linked Google Calendar entries inside the 14-day window', () => {
    expect(titles).not.toContain('Dentist'); // private, no link
    expect(titles).not.toContain('Weekly sync'); // Zoom and Meet links only
    expect(titles).not.toContain("Last month's thing");
    expect(titles).not.toContain('Too far out');
  });

  it('expands recurring entries into one row per occurrence', () => {
    const occ = entries.filter((e) => e.title === 'Bay Area Test Makers');
    expect(occ.map((e) => e.startAt.toISOString())).toEqual(['2026-10-02T01:00:00.000Z', '2026-10-09T01:00:00.000Z']);
    expect(new Set(occ.map((e) => e.icalUid)).size).toBe(2);
    expect(occ.every((e) => e.providerKey === null)).toBe(true);
  });

  it('reads the Luma id, scrubbed links, RSVP and a safe snippet', () => {
    const a = entries.find((e) => e.title.startsWith('Agent Builders'))!;
    expect(a.providerKey).toBe('luma:evt-TestLumaIcs001');
    expect(a.links).toEqual(['https://luma.com/testagent']);
    expect(a.rsvp).toBe('ACCEPTED');
    expect(a.snippet).not.toContain('someone@example.org');
    expect(a.snippet).not.toContain('<br>');
  });

  it('flags cancelled entries', () => {
    expect(entries.find((e) => e.title === 'Cancelled Demo Night')?.cancelled).toBe(true);
  });

  it('snippets never exceed 300 characters', () => {
    expect(snippetOf('x'.repeat(1000))!.length).toBe(300);
  });
});

describe('syncIcsFeeds', () => {
  it('merges the same event across feeds and never creates cancelled ones', async () => {
    const r = await sync();
    expect(r.ran).toBe(true);
    const rows = await db.select().from(candidates);
    expect(rows.map((c) => c.title).sort()).toEqual(['Agent Builders Night 🤖', 'Bay Area Test Makers', 'Bay Area Test Makers', 'Waitlisted Hack Day']);
    const agent = rows.find((c) => c.providerKey === 'luma:evt-TestLumaIcs001')!;
    expect(agent.sourceKinds.sort()).toEqual(['gcal', 'luma']);
    const hack = rows.find((c) => c.title === 'Waitlisted Hack Day')!;
    expect(hack.location).toBeNull(); // a URL in LOCATION isn't a place
  });

  it('is idempotent: a second run adds sightings, not rows', async () => {
    await sync();
    await sync({ now: new Date(NOW.getTime() + 60_000) });
    expect(await db.$count(candidates)).toBe(4);
    expect(await db.$count(candidateSightings)).toBe(5);
  });

  it('respects the cooldown and records the run', async () => {
    expect((await sync({ cooldownMs: 600_000 })).ran).toBe(true);
    expect(await sync({ cooldownMs: 600_000, now: new Date(NOW.getTime() + 60_000) })).toEqual({ ran: false, reason: 'cooldown' });
    const [job] = await db.select().from(jobsLog);
    expect(job.job).toBe('inbox_sync');
    expect(job.ok).toBe(true);
  });

  it('keeps a failing feed to an error code; the URL is never stored', async () => {
    process.env.LUMA_PERSONAL_ICS_URL = 'https://api.example.test/gone.ics';
    const r = await sync();
    expect(r.ran && r.feeds.find((f) => f.kind === 'luma')).toMatchObject({ ok: false, error: 'status_404' });
    const [row] = await db.select().from(syncState).where(eq(syncState.source, 'luma'));
    expect(row.error).toBe('status_404');
    expect(JSON.stringify(await db.select().from(jobsLog))).not.toContain('example.test');
  });

  it('does nothing without feeds', async () => {
    delete process.env.GCAL_SECRET_ICS_URL;
    delete process.env.LUMA_PERSONAL_ICS_URL;
    expect(await sync()).toEqual({ ran: false, reason: 'no_feeds' });
  });

  it('marks a later cancellation on an existing row', async () => {
    await sync();
    delete process.env.LUMA_PERSONAL_ICS_URL; // only Google has heard about it
    feeds[URLS.gcal] = gcal.replace('STATUS:CONFIRMED\nATTENDEE', 'STATUS:CANCELLED\nATTENDEE');
    await sync({ now: new Date(NOW.getTime() + 60_000) });
    feeds[URLS.gcal] = gcal;
    const [agent] = await db.select().from(candidates).where(eq(candidates.providerKey, 'luma:evt-TestLumaIcs001'));
    expect(agent.eventStatus).toBe('CANCELLED');
  });
});

async function seedEvent(id: string, externalId: string) {
  await db.insert(events).values({ id, slug: id, status: 'draft', sourceUrl: `https://luma.com/${externalId}`, createdVia: 'admin' });
  await db.insert(eventSources).values({ eventId: id, platform: 'luma', externalId, url: `https://luma.com/${externalId}` });
}

describe('dedupe with events and the skill', () => {
  it('shows 已添加 for an event that is already on the site', async () => {
    await seedEvent('evt_existing', 'evt-TestLumaIcs001');
    await sync();
    const [agent] = await db.select().from(candidates).where(eq(candidates.providerKey, 'luma:evt-TestLumaIcs001'));
    expect(agent.eventId).toBe('evt_existing');
    expect(agent.state).toBe('added');
    // The calendar UID is remembered on the event's source row.
    const [src] = await db.select().from(eventSources).where(eq(eventSources.eventId, 'evt_existing'));
    expect(src.icalUid).toBe('evt-TestLumaIcs001@events.lu.ma');
  });

  it('folds a skill pick into the feed row by the fuzzy key', async () => {
    await sync();
    const out = await pushCandidates(
      [{ url: 'https://lu.ma/testhack?utm_source=skill', title: 'Waitlisted Hack Day!', start_at: '2026-10-10T17:05:00Z', comment: '早申请', suggest_going: true }],
      { db, now: NOW },
    );
    expect(out.results[0].status).toBe('merged');
    const [hack] = await db.select().from(candidates).where(eq(candidates.title, 'Waitlisted Hack Day!'));
    expect(hack.sourceKinds.sort()).toEqual(['luma', 'skill']);
    expect(hack.suggestComment).toBe('早申请');
    expect(hack.suggestGoing).toBe(true);
    expect(hack.links).toContain('https://luma.com/testhack');
    expect(await db.$count(candidates)).toBe(4);
  });

  it('reports bad skill links per item', async () => {
    const out = await pushCandidates([{ url: 'ftp://x', title: 'x', start_at: '2026-10-10T17:00:00Z' }], { db, now: NOW });
    expect(out.results[0]).toMatchObject({ status: 'error' });
  });
});

describe('triage', () => {
  const base = {
    sourceKind: 'skill' as const, sourceRef: 'b1', providerKey: null, icalUid: null, location: null, links: ['https://luma.com/x'], snippet: null,
    endAt: new Date('2026-10-05T03:00:00Z'),
  };
  it('dismiss hides for 90 days and survives new sightings', async () => {
    const r = (await upsertCandidate({ ...base, title: 'A', startAt: new Date('2026-10-05T01:00:00Z') }, { db, now: NOW }))!;
    await dismissCandidates([r.id], NOW, db);
    await upsertCandidate({ ...base, sourceRef: 'b2', title: 'A', startAt: new Date('2026-10-05T01:00:00Z') }, { db, now: NOW });
    const [row] = await db.select().from(candidates).where(eq(candidates.id, r.id));
    expect(row.state).toBe('dismissed');
    expect(viewOf(row, NOW)).toBe('dismissed');
    expect(viewOf(row, new Date(NOW.getTime() + 91 * 864e5))).toBe('inbox');
  });

  it('snooze comes back when it runs out; restore clears it', async () => {
    const r = (await upsertCandidate({ ...base, title: 'B', startAt: new Date('2026-10-05T01:00:00Z') }, { db, now: NOW }))!;
    await snoozeCandidates([r.id], new Date('2026-10-02T15:00:00Z'), db);
    let [row] = (await listInbox(NOW, db)).filter((x) => x.id === r.id);
    expect(row.view).toBe('snoozed');
    [row] = (await listInbox(new Date('2026-10-02T16:00:00Z'), db)).filter((x) => x.id === r.id);
    expect(row.view).toBe('inbox');
    await restoreCandidates([r.id], db);
    const [back] = await db.select().from(candidates).where(eq(candidates.id, r.id));
    expect(back.state).toBe('inbox');
    expect(back.snoozedUntil).toBeNull();
  });

  it('rows expire 7 days after they end', async () => {
    await upsertCandidate({ ...base, title: 'Old', startAt: new Date('2026-09-20T01:00:00Z'), endAt: new Date('2026-09-20T03:00:00Z') }, { db, now: NOW });
    await upsertCandidate({ ...base, title: 'Recent', startAt: new Date('2026-09-28T01:00:00Z'), endAt: new Date('2026-09-28T03:00:00Z') }, { db, now: NOW });
    expect(await expireCandidates(NOW, db)).toBe(1);
    expect((await db.select().from(candidates)).map((c) => c.title)).toEqual(['Recent']);
  });

  it('clearInbox removes candidates, sightings and feed status', async () => {
    await sync();
    await clearInbox(db);
    expect(await db.$count(candidates)).toBe(0);
    expect(await db.$count(candidateSightings)).toBe(0);
    expect(await db.$count(syncState)).toBe(0);
  });
});
