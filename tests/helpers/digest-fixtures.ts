import type { DigestEvent, DigestSnapshot } from '@/lib/digest/types';

// Digest snapshot builders shared by the email and WeChat-text tests. Type-only imports, so test
// files can import this statically before their vi.mock()s take effect. Ids come from a counter
// local to each test file (vitest isolates modules per file), so a file always gets the same ids.

export const O = 'https://picks.example.com';

let n = 0;
/** A W42 (2026-10-12 – 10-18 PDT) in-person AI event, Wed 18:30–21:00 PDT, unless overridden. */
export const ev = (over: Partial<DigestEvent> = {}): DigestEvent => {
  const id = over.id ?? `evt_${String(++n).padStart(16, '0')}`;
  return {
    id, slug: `event-${id.slice(-6)}`, category: 'ai', startAt: '2026-10-14T01:30:00.000Z', endAt: '2026-10-14T04:00:00.000Z',
    tz: 'America/Los_Angeles', allDay: false, format: 'in_person', titleEn: 'Bay Area AI Builders Night', titleZh: '湾区 AI 开发者之夜',
    noteEn: null, noteZh: null, place: 'SoMa', priceText: null, access: 'open', sourceUrl: `https://luma.com/${id}`, platform: 'Luma',
    coverUrl: `${O}/og/template/ai?s=192`, coverCredit: null, seal: null, featured: false, ...over,
  };
};

/** The 2026-W42 snapshot (preview week W43), attendance on, both intros, no events unless given. */
export const snap = (over: Partial<DigestSnapshot> = {}): DigestSnapshot => ({
  version: 1, issueId: 'dig_0000000000000001', isoWeek: '2026-W42', from: '2026-10-12T07:00:00.000Z', to: '2026-10-19T07:00:00.000Z',
  previewWeek: '2026-W43', sendAfter: '2026-10-12T00:00:00.000Z', origin: O,
  introEn: 'A heavy AI week, and a hackathon I am hosting.\nSee you there.', introZh: '这周 AI 活动扎堆，还有一场我主办的黑客松。\n现场见。',
  showAttendance: true, events: [], preview: [], ...over,
});
