import { readFileSync } from 'node:fs';
import { MockLanguageModelV4 } from 'ai/test';
import { describe, expect, it } from 'vitest';
import { readFacts } from '@/lib/ingest/adapters';
import { cleanTitle, enrich, type EventDraft } from '@/lib/ingest/extract';
import { normalizeUrl, platformRef } from '@/lib/ingest/normalize';

const luma = () => {
  const u = normalizeUrl('https://luma.com/abcd1234');
  return readFacts(readFileSync('fixtures/luma-event.html', 'utf8'), u, platformRef(u));
};

const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 20, text: 20, reasoning: undefined },
};
const model = (draft: Partial<EventDraft> | string) => {
  const calls: string[] = [];
  const m = new MockLanguageModelV4({
    doGenerate: async (opts) => {
      calls.push(JSON.stringify(opts.prompt));
      return {
        content: [{ type: 'text', text: typeof draft === 'string' ? draft : JSON.stringify(draft) }],
        finishReason: { unified: 'stop', raw: undefined },
        usage,
        warnings: [],
      };
    },
  });
  return { m, calls };
};

const full: EventDraft = {
  title_en: 'Agent Builders Night 🚀', title_zh: 'Agent Builders Night',
  summary_en: 'A hands-on evening for people building agents.', summary_zh: '动手做 agent 的晚上。',
  note_en: 'Great for first-time hackers', note_zh: '适合第一次参加的同学',
  start_at: '2027-01-01T00:00:00Z', end_at: null, tz: 'Asia/Shanghai',
  venue_name: 'Somewhere Else', city: 'Oakland', format: 'online',
  category: 'hackathon', category_confidence: 1.7, event_language: 'en',
  price_text: '$5', access: 'open', private_venue: false,
};

describe('enrich', () => {
  it('lets page facts win over the model and records AI fields', async () => {
    const { m, calls } = model(full);
    const r = await enrich(luma(), '适合第一次参加的同学', { model: m });
    expect(r.ai).toBe(true);
    const d = r.draft;
    // facts
    expect(d.title_en).toBe('Agent Builders Night');
    expect(d.start_at).toBe('2026-10-08T01:00:00.000Z');
    expect(d.tz).toBe('America/Los_Angeles');
    expect(d.venue_name).toBe('Example Labs');
    expect(d.city).toBe('San Francisco');
    expect(d.format).toBe('in_person');
    expect(d.price_text).toBe('Free');
    expect(d.access).toBe('apply');
    // model
    expect(d.category).toBe('hackathon');
    expect(d.category_confidence).toBe(1);
    expect(d.summary_zh).toBe('动手做 agent 的晚上。');
    // the comment stays verbatim in its language; the other side is the model's translation
    expect(d.note_zh).toBe('适合第一次参加的同学');
    expect(d.note_en).toBe('Great for first-time hackers');
    expect(r.autoFields.sort()).toEqual(['category', 'event_language', 'note_en', 'summary_en', 'summary_zh', 'title_zh'].sort());
    // page text is fenced as untrusted data
    expect(calls[0]).toContain('untrusted data');
  });

  it('lets the model fill facts the page did not have', async () => {
    const f = { ...luma(), startAt: null, endAt: null, tz: null, venueName: null, city: null };
    const { m } = model({ ...full, tz: 'America/Los_Angeles', start_at: '2026-10-08T01:00:00Z' });
    const r = await enrich(f, null, { model: m });
    expect(r.draft.start_at).toBe('2026-10-08T01:00:00Z');
    expect(r.draft.venue_name).toBe('Somewhere Else');
    expect(r.draft.note_en).toBeNull();
    expect(r.draft.note_zh).toBeNull();
    expect(r.autoFields).toEqual(expect.arrayContaining(['start_at', 'tz', 'venue_name', 'city']));
  });

  it('never lets the model clear a private venue, but lets it set one', async () => {
    const priv = { ...luma(), privateVenue: true, venueName: null };
    expect((await enrich(priv, null, { model: model({ ...full, private_venue: false }).m })).draft.private_venue).toBe(true);
    expect((await enrich(priv, null, { model: model(full).m })).draft.venue_name).toBeNull();
    const pub = luma();
    const r = await enrich(pub, null, { model: model({ ...full, private_venue: true }).m });
    expect(r.draft.private_venue).toBe(true);
    expect(r.autoFields).toContain('private_venue');
  });

  it('trims long summaries instead of failing', async () => {
    const r = await enrich(luma(), null, { model: model({ ...full, summary_en: 'x'.repeat(400), summary_zh: '长'.repeat(300) }).m });
    expect(r.draft.summary_en.length).toBe(240);
    expect(r.draft.summary_zh.length).toBe(120);
  });

  it('falls back to a facts-only draft when the model fails', async () => {
    const r = await enrich(luma(), 'Bring a laptop', { model: model('not json').m });
    expect(r.ai).toBe(false);
    expect(r.aiError).toBeTruthy();
    expect(r.draft.title_zh).toBe('Agent Builders Night');
    expect(r.draft.note_en).toBe('Bring a laptop');
    expect(r.draft.note_zh).toBeNull();
    expect(r.draft.category).toBe('ai'); // Luma cat-ai hint
    expect(r.draft.category_confidence).toBe(0.5);
    expect(r.autoFields).toEqual([]);
  });

  it('skips the model entirely when no gateway is configured', async () => {
    const prev = process.env.INGEST_AI;
    process.env.INGEST_AI = 'off';
    try {
      const r = await enrich(luma(), null);
      expect(r).toMatchObject({ ai: false, aiError: 'not_configured' });
    } finally {
      process.env.INGEST_AI = prev;
    }
  });
});

describe('cleanTitle', () => {
  it('drops decorative emoji', () => {
    expect(cleanTitle('⚕️ HealthTech Startup Pitch Competition⚕️')).toBe('HealthTech Startup Pitch Competition');
    expect(cleanTitle('🎉 Founders Mixer 🎉')).toBe('Founders Mixer');
    expect(cleanTitle('AI 创业者聚会 #3')).toBe('AI 创业者聚会 #3');
  });
});
