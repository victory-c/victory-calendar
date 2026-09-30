import { readFileSync } from 'node:fs';
import { MockLanguageModelV4 } from 'ai/test';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import type { DB } from '@/lib/db';
import { covers, eventSources, events } from '@/lib/db/schema';
import type { EventDraft } from '@/lib/ingest/extract';
import { ingest, publishedIndex, regionFor, slugify, type IngestInput } from '@/lib/ingest/pipeline';
import { SafeFetchError } from '@/lib/ingest/safe-fetch';
import { testDb } from './helpers/pglite';

let db: DB;
beforeEach(async () => {
  db = (await testDb()).db as unknown as DB;
});

const pages: Record<string, { url: string; file: string }> = {
  'https://luma.com/abcd1234': { url: 'https://luma.com/abcd1234', file: 'luma-event.html' },
  'https://luma.link/short': { url: 'https://luma.com/abcd1234', file: 'luma-event.html' },
  'https://luma.com/event/evt-TestLuma000001': { url: 'https://luma.com/event/evt-TestLuma000001', file: 'luma-event.html' },
  'https://partiful.com/e/TestPartiful00001abc': { url: 'https://partiful.com/e/TestPartiful00001abc', file: 'partiful-event.html' },
};
const fetchPage = async (url: URL) => {
  const p = pages[url.toString()];
  if (!p) throw new SafeFetchError('status', 'HTTP 404', 404);
  return { url: p.url, text: readFileSync(`fixtures/${p.file}`, 'utf8') };
};

const model = (over: Partial<EventDraft> = {}) =>
  new MockLanguageModelV4({
    doGenerate: async () => ({
      content: [{ type: 'text', text: JSON.stringify({
        title_en: 'x', title_zh: 'Agent Builders 之夜', summary_en: 'Build an agent in an evening.', summary_zh: '一晚上做一个 agent。',
        note_en: 'Good first hackathon', note_zh: '适合第一次参加', start_at: null, end_at: null, tz: 'America/Los_Angeles',
        venue_name: null, city: null, format: 'in_person', category: 'hackathon', category_confidence: 0.91,
        event_language: 'en', price_text: null, access: 'open', private_venue: false, ...over,
      }) }],
      finishReason: { unified: 'stop', raw: undefined },
      usage: { inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined }, outputTokens: { total: 1, text: 1, reasoning: undefined } },
      warnings: [],
    }),
  });

const input = (over: Partial<IngestInput> = {}): IngestInput => ({
  url: 'https://lu.ma/abcd1234?utm_source=ios', comment: '适合第一次参加', mode: 'draft', name: null, createdVia: 'shortcut', ...over,
});
const run = (over: Partial<IngestInput> = {}, m = model()) => ingest(input(over), { db, fetchPage, model: m });

describe('ingest', () => {
  it('creates a draft with facts, model fields and both source ids', async () => {
    const r = await run();
    expect(r.status).toBe(201);
    if (r.status !== 201) return;
    expect(r.body).toMatchObject({
      status: 'draft', title_en: 'Agent Builders Night', title_zh: 'Agent Builders 之夜',
      start_at: '2026-10-08T01:00:00.000Z', tz: 'America/Los_Angeles', category: 'hackathon',
      category_confidence: 0.91, cover_status: 'pending', public_url: null, ai: true,
    });
    expect(r.coverSource).toBe('https://images.lumacdn.com/uploads/op/00000000-cover.png');
    const [e] = await db.select().from(events).where(eq(events.id, r.body.id));
    expect(e).toMatchObject({
      slug: 'agent-builders-night', sourceUrl: 'https://luma.com/abcd1234', venueName: 'Example Labs', city: 'San Francisco',
      region: 'sf', noteZh: '适合第一次参加', noteEn: 'Good first hackathon', createdVia: 'shortcut', addressPublic: false,
      hostName: 'Example Labs', priceText: 'Free', access: 'apply',
    });
    expect(e.autoFields).toEqual(expect.arrayContaining(['title_zh', 'summary_en', 'note_en', 'category']));
    const src = await db.select().from(eventSources).where(eq(eventSources.eventId, r.body.id));
    expect(src.map((s) => s.externalId).sort()).toEqual(['abcd1234', 'evt-TestLuma000001']);
  });

  it('answers 409 for the same link, a lu.ma alias, a short link, or the evt- id', async () => {
    const first = await run();
    if (first.status !== 201) throw new Error('setup');
    for (const url of ['https://luma.com/abcd1234', 'lu.ma/abcd1234#x', 'https://luma.link/short', 'https://luma.com/event/evt-TestLuma000001']) {
      const r = await run({ url });
      expect(r.status, url).toBe(409);
      if (r.status === 409) expect(r.body.existing_id).toBe(first.body.id);
    }
  });

  it('keeps unreadable links as a minimal draft (202, needs_manual)', async () => {
    const r = await run({ url: 'https://example.org/private-invite', comment: 'Invite from a friend', name: 'Dinner' });
    expect(r.status).toBe(202);
    if (r.status !== 202) return;
    expect(r.body).toMatchObject({ needs_manual: true, reason: 'fetch_status' });
    const [e] = await db.select().from(events).where(eq(events.id, r.body.id));
    expect(e).toMatchObject({ status: 'draft', titleEn: 'Dinner', noteEn: 'Invite from a friend', startAt: null, category: null });
    expect((await run({ url: 'https://example.org/private-invite' })).status).toBe(409);
  });

  it('publishes with a template cover when everything is there', async () => {
    const r = await run({ mode: 'publish' });
    expect(r.status).toBe(201);
    if (r.status !== 201) return;
    expect(r.body.status).toBe('published');
    expect(r.body.cover_status).toBe('template_pending_official');
    expect(r.body.public_url).toMatch(/\/events\/agent-builders-night$/);
    const [e] = await db.select().from(events).where(eq(events.id, r.body.id));
    expect(e.publishedAt).toBeInstanceOf(Date);
    const [c] = await db.select().from(covers).where(eq(covers.id, e.coverId!));
    expect(c).toMatchObject({ kind: 'template', url1600: 'template:hackathon' });
    expect((await publishedIndex(db)).map((x) => x.external_ids.sort())).toEqual([['luma:abcd1234', 'luma:evt-TestLuma000001']]);
  });

  it('saves a publish request without a comment as a draft and says why', async () => {
    const r = await run({ mode: 'publish', comment: null }, model({ note_en: null, note_zh: null }));
    expect(r.status).toBe(201);
    if (r.status !== 201) return;
    expect(r.body.status).toBe('draft');
    expect(r.body.not_published).toEqual(['note']);
    expect(await db.select().from(covers)).toHaveLength(0);
  });

  it('works without a model: facts-only draft, Victor fills the rest', async () => {
    const broken = new MockLanguageModelV4({ doGenerate: async () => { throw new Error('gateway: no credit'); } });
    const r = await run({ url: 'https://partiful.com/e/TestPartiful00001abc', comment: 'Fun crowd', mode: 'publish' }, broken);
    expect(r.status).toBe(201);
    if (r.status !== 201) return;
    expect(r.body).toMatchObject({ ai: false, status: 'draft', title_en: 'Founders Mixer', title_zh: 'Founders Mixer', category: null });
    expect(r.body.not_published).toEqual(['category']);
  });

  it('applies the name override and a unique slug', async () => {
    await run();
    const r = await run({ url: 'https://partiful.com/e/TestPartiful00001abc', name: 'Agent Builders Night' });
    if (r.status !== 201) throw new Error('expected 201');
    const [e] = await db.select().from(events).where(eq(events.id, r.body.id));
    expect(e.titleEn).toBe('Agent Builders Night');
    expect(e.slug).toBe('agent-builders-night-2');
    expect(e.autoFields).not.toContain('title_en');
  });

  it('rejects things that are not links', async () => {
    expect((await run({ url: 'javascript:alert(1)' })).status).toBe(400);
  });
});

describe('helpers', () => {
  it('slugify', () => {
    expect(slugify('Agents & Evals Night — SF!')).toBe('agents-and-evals-night-sf');
    expect(slugify('Café Día')).toBe('cafe-dia');
    expect(slugify('华人创业者聚会')).toBe('');
  });

  it('regionFor', () => {
    expect(regionFor('Berkeley', 'in_person')).toBe('east_bay');
    expect(regionFor('Palo Alto', 'hybrid')).toBe('peninsula');
    expect(regionFor('Anywhere', 'online')).toBe('online');
    expect(regionFor('Seattle', 'in_person')).toBeNull();
  });
});
