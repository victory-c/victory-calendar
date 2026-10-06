import { load } from 'cheerio';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pretty } from 'react-email';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ev, O, snap } from './helpers/digest-fixtures';
import { testDb } from './helpers/pglite';

// Weekly digest template and render (M3 week 14, builder A): selection rules (F06 "only your
// sections"), the rendered email (snapshots, email-client constraints, 90 KB cap, kill switch,
// per-recipient placeholder), and the two image routes the email points at.

const h = vi.hoisted(() => ({
  db: null as unknown,
  hasDb: true,
  fonts: [] as { name: string; data: ArrayBuffer; weight: 500 | 600; style: 'normal' }[],
  fetchBytes: null as null | ((url: string) => Promise<Buffer>),
  fetched: [] as string[],
}));
vi.mock('@/lib/db', async (orig) => ({
  ...(await orig()),
  db: new Proxy({}, { get: (_t, p) => Reflect.get(h.db as object, p) }),
  hasDatabase: () => h.hasDb,
}));
vi.mock('@/lib/og/fonts', () => ({ ogFonts: async () => h.fonts }));
vi.mock('@/lib/ingest/safe-fetch', async (orig) => ({
  ...(await orig()),
  safeFetchBytes: async (url: string) => {
    h.fetched.push(url);
    if (!h.fetchBytes) throw new Error('network touched');
    return h.fetchBytes(url);
  },
}));

const { DigestTooLargeError, MAX_HTML_BYTES, TOKEN, digestLinks, personalize, renderEmptyNotice, renderVariant } = await import('@/lib/digest/render');
const { categoriesWithPicks, isEmptyFor, pickCells, selectForVariant } = await import('@/lib/digest/select');
const { parseVariantKey } = await import('@/lib/digest/variant');
const { clip, NOTE_MAX } = await import('@/lib/digest/fields');
const { covers } = await import('@/lib/db/schema');
type DigestEvent = import('@/lib/digest/types').DigestEvent;
type DigestSnapshot = import('@/lib/digest/types').DigestSnapshot;
type RenderedEmail = import('@/lib/digest/types').RenderedEmail;

const REAL_TOKEN = `sub_0123456789abcdef.${'Ab3_-'.repeat(8)}Ab3`; // the shape linkToken() returns: 64 chars

const v =(key: string) => {
  const parsed = parseVariantKey(key);
  if (!parsed) throw new Error(`bad key ${key}`);
  return parsed;
};

// Week 2026-W42 = Mon Oct 12 – Sun Oct 18 (PDT). Covers every chip, format and seal kind; cycling
// is in the snapshot but not in the snapshot-test variants, to show F06.
const EVENTS: DigestEvent[] = [
  ev({
    id: 'evt_ai00000000000001', slug: 'ai-builders-night', category: 'ai', startAt: '2026-10-14T01:30:00.000Z', endAt: '2026-10-14T04:00:00.000Z',
    noteEn: 'Small room, strong demos. Go for the agents panel.', noteZh: '人不多，demo 质量高。冲着 agents 圆桌去。',
    priceText: 'Free', access: 'apply', seal: 'going', platform: 'Partiful', sourceUrl: 'https://partiful.com/e/abc',
    coverUrl: `${O}/og/email-cover/cov_0000000000000001`, coverCredit: 'Cover: AI Builders via Partiful',
  }),
  ev({
    id: 'evt_ai00000000000002', slug: 'evals-in-practice', category: 'ai', startAt: '2026-10-15T19:00:00.000Z', endAt: '2026-10-15T20:00:00.000Z',
    format: 'online', place: null, titleEn: 'Evals in Practice', titleZh: 'Evals in Practice', noteEn: 'The best hour on evals I know of.',
    platform: null, sourceUrl: 'https://example.org/evals',
  }),
  ev({
    id: 'evt_hk00000000000001', slug: 'cal-hacks-weekend', category: 'hackathon', allDay: true, startAt: '2026-10-17T07:00:00.000Z',
    endAt: '2026-10-18T07:00:00.000Z', titleEn: 'Cal Hacks Weekend', titleZh: 'Cal Hacks 黑客松周末', place: 'Berkeley', priceText: '$25',
    access: 'waitlist', seal: 'hosting', coverUrl: `${O}/og/template/hackathon?s=192`,
  }),
  ev({
    id: 'evt_vc00000000000001', slug: 'founder-office-hours', category: 'vc', startAt: '2026-10-15T00:00:00.000Z', endAt: '2026-10-15T02:00:00.000Z',
    format: 'hybrid', place: 'Palo Alto', titleEn: 'Founder Office Hours', titleZh: '创业者答疑会', priceText: 'free', access: 'sold_out',
    seal: 'speaking', platform: 'Eventbrite', sourceUrl: 'https://www.eventbrite.com/e/123', coverUrl: `${O}/og/template/vc?s=192`,
  }),
  // Sunday 23:30 PDT: still this week, on Sunday's page (Monday in UTC).
  ev({
    id: 'evt_so00000000000001', slug: 'late-night-boba', category: 'social', startAt: '2026-10-19T06:30:00.000Z', endAt: null,
    titleEn: 'Late-night Boba Meetup', titleZh: '深夜奶茶局', place: 'Mission', coverUrl: `${O}/og/template/social?s=192`,
  }),
  ev({
    id: 'evt_cy00000000000001', slug: 'sunday-ride', category: 'cycling', startAt: '2026-10-18T15:00:00.000Z', endAt: '2026-10-18T19:00:00.000Z',
    titleEn: 'Sunday Ride to Tiburon', titleZh: '周日骑行去蒂伯龙', place: 'San Francisco', coverUrl: `${O}/og/template/cycling?s=192`,
  }),
];
const PREVIEW: DigestEvent[] = [
  ev({
    id: 'evt_pv00000000000001', slug: 'ai-infra-meetup', category: 'ai', startAt: '2026-10-21T01:00:00.000Z', endAt: '2026-10-21T03:00:00.000Z',
    titleEn: 'AI Infra Meetup', titleZh: 'AI 基础设施聚会', place: 'Mountain View', featured: true,
  }),
  ev({
    id: 'evt_pv00000000000002', slug: 'board-game-night', category: 'social', startAt: '2026-10-24T02:00:00.000Z', endAt: null,
    titleEn: 'Board Game Night', titleZh: '桌游夜', place: 'Oakland', featured: true,
  }),
  ev({ id: 'evt_pv00000000000003', slug: 'gravel-day', category: 'cycling', startAt: '2026-10-24T16:00:00.000Z', titleEn: 'Gravel Day', titleZh: '砾石路骑行日', featured: true }),
];
const fixture = (over: Partial<DigestSnapshot> = {}) => snap({ events: EVENTS, preview: PREVIEW, ...over });
const VARIANT = (l: 'en' | 'zh') => v(`${l}:ai,hackathon,social,vc`);

async function must(p: Promise<RenderedEmail | null>) {
  const e = await p;
  if (!e) throw new Error('expected an email');
  return e;
}

/** Everything that must hold for any digest or notice we send. */
function expectEmailSafe(html: string, locale: 'en' | 'zh') {
  const lang = locale === 'zh' ? 'zh-Hans' : 'en';
  expect(html).toMatch(/^<!DOCTYPE html PUBLIC "-\/\/W3C\/\/DTD XHTML 1\.0 Transitional\/\/EN"/);
  expect(html).toMatch(new RegExp(`<html[^>]*\\slang="${lang}"`));
  expect(html).toMatch(new RegExp(`<body[^>]*\\slang="${lang}"`));
  expect(html).not.toMatch(/display:\s*(flex|grid)|position:|float:|var\(--|oklch\(|\d(\.\d+)?rem\b|<svg|src="data:|<script|<link/);
  const imgs = html.match(/<img\b[^>]*>/g) ?? [];
  for (const tag of imgs) {
    expect(tag).toMatch(/\ssrc="https:\/\/[^"]+"/);
    expect(tag).toMatch(/\salt="[^"]+"/);
    expect(tag).toMatch(/\swidth="\d+"/);
    expect(tag).toMatch(/\sheight="\d+"/);
  }
  // No address anywhere (the only @ allowed is the dark-mode media query).
  expect(html.replace(/@media/g, '')).not.toContain('@');
  expect(html).toContain('name="color-scheme" content="light dark"');
  expect(html).toMatch(/\[data-ogsc\]/);
  // Dark mode: every element painting a background carries a class the dark rules recolour, or it
  // stays light around the dark column (react-email's <Body> td did exactly that).
  const painted = (html.match(/<[a-z]+\b[^>]*>/g) ?? []).filter((tag) => /background-color:|\sbgcolor="/.test(tag));
  expect(painted.length).toBeGreaterThanOrEqual(3); // body, full-width wrapper, 600 px column
  for (const tag of painted) expect(tag, tag).toMatch(/\sclass="[^"]*\b(bg|btn|chip)\b/);
  expect(html).toMatch(/<body\b[^>]*\sclass="bg"/);
  // Classic Outlook: a 600 px ghost table around the column (it ignores max-width) and 96 DPI.
  const open = html.indexOf('<!--[if mso]><table role="presentation" width="600" align="center"');
  const column = html.indexOf('max-width:600px');
  const close = html.indexOf('<!--[if mso]></td></tr></table><![endif]-->');
  expect(open).toBeGreaterThan(0);
  expect(open).toBeLessThan(column);
  expect(close).toBeGreaterThan(column);
  expect(html).toMatch(/<html\b[^>]*\sxmlns:o="urn:schemas-microsoft-com:office:office"/);
  expect(html).toMatch(/<o:PixelsPerInch>96<\/o:PixelsPerInch>[^]*<\/head>/);
  expect(html).not.toContain('data-vp-mso');
  return imgs;
}

/** Plain-text part: every URL sits in <…>, so no linkifier runs it into the text after it. */
function expectTextLinksDelimited(text: string) {
  const urls = [...text.matchAll(/(.?)(https?:\/\/[^\s<>]+)(.?)/g)];
  expect(urls.length).toBeGreaterThan(0);
  for (const [whole, before, , after] of urls) expect([before, after], whole).toEqual(['<', '>']);
}

const between = (s: string, from: string, to: string) => {
  const i = s.indexOf(from);
  if (i < 0) return '';
  const j = s.indexOf(to, i + from.length);
  return s.slice(i, j < 0 ? undefined : j);
};

describe('selectForVariant', () => {
  it('one section per picked category in taxonomy order, whatever order they are asked in', () => {
    const sel = selectForVariant(fixture(), ['social', 'vc', 'ai', 'nonsense']);
    expect(sel.sections.map((s) => s.category)).toEqual(['ai', 'vc', 'social']);
    expect(sel.picks).toBe(4);
  });

  it('groups by Pacific day: a Sunday 23:30 PT event stays on Sunday', () => {
    const sel = selectForVariant(fixture(), ['ai', 'social']);
    const ai = sel.sections.find((s) => s.category === 'ai')!;
    expect(ai.days.map((d) => d.key)).toEqual(['2026-10-13', '2026-10-15']);
    expect(ai.days[0].labels).toEqual({ en: { date: 'Oct 13', weekday: 'Tue' }, zh: { date: '10月13日', weekday: '周二' } });
    const social = sel.sections.find((s) => s.category === 'social')!;
    expect(social.days.map((d) => d.key)).toEqual(['2026-10-18']);
  });

  it('F06: going and the preview are restricted to the picked categories too', () => {
    const sel = selectForVariant(fixture(), ['ai']);
    expect(sel.going.map((e) => e.slug)).toEqual(['ai-builders-night']);
    expect(sel.preview.map((e) => e.slug)).toEqual(['ai-infra-meetup']);
    const all = [...sel.sections.flatMap((s) => s.days.flatMap((d) => d.events)), ...sel.going, ...sel.preview];
    expect(all.every((e) => e.category === 'ai')).toBe(true);
  });

  it('going lists only public seals, by start time, and nothing when attendance is off', () => {
    const sel = selectForVariant(fixture(), ['ai', 'hackathon', 'vc', 'social', 'cycling']);
    expect(sel.going.map((e) => e.seal)).toEqual(['going', 'speaking', 'hosting']);
    // Even if a snapshot still carried seals, the switch wins.
    expect(selectForVariant(fixture({ showAttendance: false }), ['ai', 'hackathon', 'vc']).going).toEqual([]);
    // A seal the digest never shows (or a missing one from old JSON) is not "going".
    const odd = [ev({ seal: 'went' as unknown as DigestEvent['seal'] }), { ...ev(), seal: undefined as unknown as null }];
    expect(selectForVariant(snap({ events: odd }), ['ai']).going).toEqual([]);
  });

  it('defensively drops events outside the week, duplicates and previews outside the next week', () => {
    const s = fixture({
      events: [
        ...EVENTS,
        EVENTS[0],
        ev({ category: 'ai', startAt: '2026-10-12T06:59:00.000Z', titleEn: 'Sunday before' }),
        ev({ category: 'ai', startAt: '2026-10-19T07:00:00.000Z', titleEn: 'Monday after' }),
      ],
      preview: [...PREVIEW, ev({ category: 'ai', startAt: '2026-10-26T07:00:00.000Z', titleEn: 'Two weeks out' })],
    });
    const sel = selectForVariant(s, ['ai']);
    expect(sel.picks).toBe(2);
    expect(sel.preview.map((e) => e.slug)).toEqual(['ai-infra-meetup']);
  });

  it('isEmptyFor / categoriesWithPicks agree with the sections', () => {
    const s = fixture();
    expect(categoriesWithPicks(s)).toEqual(['ai', 'hackathon', 'vc', 'cycling', 'social']);
    expect(isEmptyFor(s, ['campus', 'conference'])).toBe(true);
    expect(isEmptyFor(s, ['campus', 'cycling'])).toBe(false);
    expect(isEmptyFor(s, [])).toBe(true);
    expect(selectForVariant(s, ['campus']).picks).toBe(0);
  });
});

describe('renderVariant: snapshots', () => {
  it.each(['en', 'zh'] as const)('%s html and text', async (l) => {
    const e = await must(renderVariant(fixture(), VARIANT(l)));
    await expect(await pretty(e.html)).toMatchFileSnapshot(`./__snapshots__/digest-email.${l}.html`);
    await expect(e.text).toMatchFileSnapshot(`./__snapshots__/digest-email.${l}.txt`);
  });

  it.each(['en', 'zh'] as const)('%s empty notice', async (l) => {
    const e = await renderEmptyNotice(fixture(), v(`${l}:campus`));
    await expect(await pretty(e.html)).toMatchFileSnapshot(`./__snapshots__/digest-email.empty.${l}.html`);
    await expect(e.text).toMatchFileSnapshot(`./__snapshots__/digest-email.empty.${l}.txt`);
  });
});

describe('renderVariant: content', () => {
  it('honest subjects per variant, with a going count only when there is one', async () => {
    const en = await must(renderVariant(fixture(), VARIANT('en')));
    expect([en.subject, en.picks, en.going]).toEqual(['5 picks this week · Victor is going to 3', 5, 3]);
    const zh = await must(renderVariant(fixture(), VARIANT('zh')));
    expect(zh.subject).toBe('本周 5 场精选 · Victor 会去 3 场');
    expect((await must(renderVariant(fixture(), v('en:social')))).subject).toBe('1 pick this week');
    expect((await must(renderVariant(fixture(), v('zh:social')))).subject).toBe('本周 1 场精选');
    for (const e of [en, zh]) expect(e.subject).not.toMatch(/\p{Extended_Pictographic}/u);
  });

  it('preheader is the first intro line, or a default when there is no intro', async () => {
    const e = await must(renderVariant(fixture(), VARIANT('en')));
    expect(e.preheader).toBe('A heavy AI week, and a hackathon I am hosting.');
    expect(e.html).toContain('<p class="fg" style="margin:0 0 12px">See you there.</p>');
    const bare = await must(renderVariant(fixture({ introZh: null }), VARIANT('zh')));
    expect(bare.preheader).toBe('这周值得去的湾区 tech 活动。');
    expect(bare.text).not.toContain('现场见');
  });

  it('section order: intro, going, categories, next week, footer', async () => {
    for (const [l, marks] of [
      ['en', ['See you there.', 'Victor is going', 'AI &amp; Tech', 'Hackathons', 'VC &amp; Founders', 'Social &amp; Fun', 'Next week']],
      ['zh', ['现场见。', '我会去', 'AI 与技术', '黑客松', '创投与创业者', '社交与玩乐', '下周预告']],
    ] as const) {
      const html = (await must(renderVariant(fixture(), VARIANT(l)))).html;
      const at = [...marks.map((m) => html.indexOf(`>${m}</`)), html.indexOf(l === 'en' ? 'No paid placements.' : '无付费植入。')];
      expect(at.every((i) => i > 0)).toBe(true);
      expect([...at].sort((a, b) => a - b)).toEqual(at);
    }
  });

  it('F06: an event of a category the reader did not pick never appears anywhere', async () => {
    for (const l of ['en', 'zh'] as const) {
      const e = await must(renderVariant(fixture(), v(`${l}:ai`)));
      for (const other of [...EVENTS, ...PREVIEW].filter((x) => x.category !== 'ai')) {
        for (const s of [e.html, e.text]) {
          expect(s).not.toContain(other.slug);
          expect(s).not.toContain(other.titleEn);
          expect(s).not.toContain(other.titleZh);
        }
      }
      expect(e.html).not.toContain('og/seal/hosting');
      expect(e.html).not.toContain('og/seal/speaking');
      expect([e.picks, e.going]).toEqual([2, 1]);
    }
  });

  it('kill switch off: no going section, no seal image or alt text, no going count', async () => {
    // The snapshot still carries seals here: the flag alone must hide them.
    for (const l of ['en', 'zh'] as const) {
      const e = await must(renderVariant(fixture({ showAttendance: false }), VARIANT(l)));
      expectEmailSafe(e.html, l);
      expect(e.going).toBe(0);
      for (const s of [e.html, e.text]) {
        expect(s).not.toContain('/og/seal/');
        expect(s).not.toMatch(/\[(GOING|HOST|TALK|会去|主办|分享)\]/);
        expect(s).not.toContain(l === 'en' ? 'Victor is going' : '我会去');
        expect(s).not.toContain(l === 'en' ? 'I plan to go' : '打算去');
      }
      expect(e.subject).toBe(l === 'en' ? '5 picks this week' : '本周 5 场精选');
    }
  });

  it('seals: hosted PNG per language at 48 px, alt in one language, a text twin for the plain part', async () => {
    const en = await must(renderVariant(fixture(), VARIANT('en')));
    const seals = en.html.match(/<img\b[^>]*\/og\/seal\/[^>]*>/g) ?? [];
    expect(seals).toHaveLength(6); // three in the going list, three on the cards
    for (const tag of seals) {
      expect(tag).toMatch(/src="https:\/\/picks\.example\.com\/og\/seal\/(going|hosting|speaking)\?l=en"/);
      expect(tag).toMatch(/width="48"[^>]*|height="48"/);
      expect(tag).toMatch(/alt="\[(GOING|HOST|TALK)\]"/);
    }
    expect(en.text).toContain('[GOING] Bay Area AI Builders Night');
    expect(en.text).toContain('[HOST] Cal Hacks Weekend');
    expect(en.text).toContain('[TALK] Founder Office Hours');
    const zh = await must(renderVariant(fixture(), VARIANT('zh')));
    expect(zh.html).toContain('/og/seal/going?l=zh');
    expect(zh.html).toContain('alt="[会去]"');
    expect(zh.html).not.toMatch(/alt="\[(GOING|HOST|TALK)\]"/);
    expect(zh.text).toContain('[主办] Cal Hacks 黑客松周末');
    expect(zh.text).toContain('[分享] 创业者答疑会');
  });

  it('going list shows the day and "I plan to go", never a clock time', async () => {
    const en = await must(renderVariant(fixture(), VARIANT('en')));
    const going = between(en.html, 'Victor is going</h2>', '<h2');
    expect(going).toContain('I plan to go · Tue, Oct 13 · SoMa');
    expect(going).toContain('I plan to go · Sat, Oct 17 · Berkeley');
    expect(going).not.toMatch(/\d{1,2}:\d{2}/);
    const zh = await must(renderVariant(fixture(), VARIANT('zh')));
    expect(between(zh.html, '我会去</h2>', '<h2')).toContain('打算去 · 10月13日周二 · SoMa');
    expect(between(zh.html, '我会去</h2>', '<h2')).not.toMatch(/\d{1,2}:\d{2}/);
  });

  it('items: titles, other-language title only when different, time in PT, place, chips, note, RSVP', async () => {
    const zh = await must(renderVariant(fixture(), VARIANT('zh')));
    expect(zh.html).toContain(`href="${O}/zh/events/ai-builders-night"`);
    expect(zh.html).toContain('<div lang="en" class="mut" style="font-size:13px;color:#6e7278">Bay Area AI Builders Night</div>');
    expect(zh.text).toContain('10月13日周二 18:30–21:00 北美太平洋时间 · SoMa');
    expect(zh.text).toContain('10月15日周四 12:00–13:00 北美太平洋时间 · 线上');
    expect(zh.text).toContain('全天 · Berkeley');
    expect(zh.text).toContain('10月14日周三 17:00–19:00 北美太平洋时间 · Palo Alto · 线上线下');
    for (const chip of ['免费', '需申请', '$25', '候补', '已售罄']) expect(zh.html).toContain(`style="padding:1px 7px;border-radius:9px;background-color:#d8dcdf;font-size:12px">${chip}</span>`);
    // Note in the email's language with the seal-coloured rule; falls back to the other language, tagged.
    expect(zh.html).toContain('border-left:2px solid #e54f36;font-size:15px">人不多，demo 质量高。冲着 agents 圆桌去。<br/>');
    expect(zh.html).toContain('<span lang="en">The best hour on evals I know of.</span>');
    expect(zh.text).toContain('— Victor');
    expect(zh.text).toContain('去 Partiful 报名 <https://partiful.com/e/abc>');
    expect(zh.text).toContain('报名 <https://example.org/evals>'); // unknown platform: plain label
    expect(zh.text).toContain('Cover: AI Builders via Partiful');

    const en = await must(renderVariant(fixture(), VARIANT('en')));
    expect(en.html).toContain(`href="${O}/events/ai-builders-night"`);
    // Same title in both languages: no grey duplicate.
    expect(en.html.match(/Evals in Practice/g)).toHaveLength(1);
    expect(en.html).toContain('<div lang="zh-Hans" class="mut" style="font-size:13px;color:#6e7278">湾区 AI 开发者之夜</div>');
    expect(en.text).toContain('Tue, Oct 13 · 6:30 – 9:00 PM PT · SoMa');
    expect(en.text).toContain('All day · Berkeley');
    for (const chip of ['Free', 'Apply', '$25', 'Waitlist', 'Sold out']) expect(en.html).toContain(`>${chip}</span>`);
    expect(en.html).not.toContain('>free</span>');
    expect(en.text).toContain('RSVP on Eventbrite <https://www.eventbrite.com/e/123>');
    expect(en.text).toContain('RSVP <https://example.org/evals>');
    // Covers: 96 px slot, alt = category, never in the plain-text part.
    expect(en.html).toContain(`src="${O}/og/email-cover/cov_0000000000000001" width="96" height="96" alt="AI &amp; Tech"`);
    expect(en.text).not.toMatch(/og\/(template|email-cover|seal)/);
  });

  it('all-day events spanning several days give the day span', async () => {
    const conf = ev({ allDay: true, startAt: '2026-10-14T07:00:00.000Z', endAt: '2026-10-17T07:00:00.000Z', titleEn: 'DevDay' });
    const oneDay = ev({ allDay: true, startAt: '2026-10-13T07:00:00.000Z', endAt: '2026-10-14T07:00:00.000Z', titleEn: 'One day' });
    const zh = await must(renderVariant(snap({ events: [conf, oneDay] }), v('zh:ai')));
    expect(zh.text).toContain('全天 · 10月14日周三–10月16日周五 · SoMa');
    expect(zh.text).toMatch(/\n全天 · SoMa\n/);
    const en = await must(renderVariant(snap({ events: [conf] }), v('en:ai')));
    expect(en.text).toContain('All day · Wed, Oct 14\u2009–\u2009Fri, Oct 16 · SoMa');
  });

  it('next week has no day headers, so a single-day all-day preview row carries its day', async () => {
    const demo = ev({ allDay: true, startAt: '2026-10-24T07:00:00.000Z', endAt: '2026-10-25T07:00:00.000Z', titleEn: 'Demo Day', titleZh: '演示日', place: 'Berkeley' });
    const open = ev({ allDay: true, startAt: '2026-10-22T07:00:00.000Z', endAt: null, titleEn: 'Open Studio', titleZh: '开放工作室', place: 'Oakland' });
    const s = snap({ events: [ev()], preview: [demo, open] });
    const en = await must(renderVariant(s, v('en:ai')));
    expect(en.text).toContain('Thu, Oct 22 · All day · Oakland');
    expect(en.text).toContain('Sat, Oct 24 · All day · Berkeley');
    const zh = await must(renderVariant(s, v('zh:ai')));
    expect(zh.text).toContain('10月22日周四 · 全天 · Oakland');
    expect(zh.text).toContain('10月24日周六 · 全天 · Berkeley');
    // Under a category's day header the bare label stays.
    const inWeek = await must(renderVariant(snap({ events: [{ ...demo, startAt: '2026-10-13T07:00:00.000Z', endAt: null }] }), v('en:ai')));
    expect(inWeek.text).toMatch(/\nAll day · Berkeley\n/);
  });

  it('chips read "Free · Apply" in the plain-text part; the separator is hidden between the pills', async () => {
    const en = await must(renderVariant(fixture(), VARIANT('en')));
    for (const pair of ['Free · Apply', '$25 · Waitlist', 'Free · Sold out']) expect(en.text).toContain(pair);
    expect(en.html).toContain('>Free</span><span style="display:none;mso-hide:all"> ·</span> <span class="chip"');
    const zh = await must(renderVariant(fixture(), VARIANT('zh')));
    for (const pair of ['免费 · 需申请', '$25 · 候补', '免费 · 已售罄']) expect(zh.text).toContain(pair);
  });

  it('only http(s) links and images leave the email', async () => {
    const bad = ev({ slug: 'odd-links', sourceUrl: 'javascript:alert(1)', coverUrl: 'data:image/png;base64,AAAA' });
    const e = await must(renderVariant(snap({ events: [bad] }), v('en:ai')));
    expect(e.html).not.toMatch(/javascript:|data:image/);
    expect(e.html).toContain(`<a href="${O}/events/odd-links" class="btn"`);
    expect(e.html).toContain(`src="${O}/og/template/ai?s=192"`);
  });

  describe('cover credit', () => {
    const PAGE = 'https://www.flickr.example/photos/a-person/1';
    const BY_SA = 'https://creativecommons.org/licenses/by-sa/2.0/';
    const CREDIT = '"Golden Gate at Dusk" by A. Person · CC BY-SA 2.0 · cropped';
    const openverse = (over: Partial<DigestEvent> = {}) =>
      ev({ slug: 'bridge-walk', coverUrl: `${O}/og/email-cover/cov_00000000000000ov`, coverCredit: CREDIT, coverSourceUrl: PAGE, coverLicenseUrl: BY_SA, ...over });
    const render = async (e: DigestEvent, l: 'en' | 'zh' = 'en') => {
      const out = await must(renderVariant(snap({ events: [e] }), v(`${l}:ai`)));
      const $ = load(out.html);
      const line = $('div').filter((_, d) => $(d).text().includes('A. Person') || $(d).text().includes('Host')).last();
      return { out, line, links: line.find('a').map((_, a) => [[$(a).text(), $(a).attr('href')]]).get() as unknown as [string, string][] };
    };

    it.each(['en', 'zh'] as const)('%s: Openverse links the work to its page and the licence to its deed, in html and text', async (l) => {
      const { out, line, links } = await render(openverse(), l);
      expect(line.text()).toBe(CREDIT);
      expect(links).toEqual([['"Golden Gate at Dusk" by A. Person', PAGE], ['CC BY-SA 2.0', BY_SA]]);
      expect(line.find('a').get().every((a) => a.attribs.class === 'mut')).toBe(true);
      expect(out.text).toContain(`"Golden Gate at Dusk" by A. Person <${PAGE}> · CC BY-SA 2.0 <${BY_SA}> · cropped`);
      expectEmailSafe(out.html, l);
      expectTextLinksDelimited(out.text);
    });

    it('CC0 without an edit, and a work without a page: only the deed is linked', async () => {
      const cc0 = 'https://creativecommons.org/publicdomain/zero/1.0/';
      const { out, links } = await render(openverse({ coverCredit: 'Untitled image by A. Person · CC0 1.0', coverLicenseUrl: cc0, coverSourceUrl: null }));
      expect(links).toEqual([['CC0 1.0', cc0]]);
      expect(out.text).toContain(`Untitled image by A. Person · CC0 1.0 <${cc0}>`);
    });

    it('a credit not in the stored shape is linked whole, with the deed after it', async () => {
      const { line, links } = await render(openverse({ coverCredit: 'Photo by A. Person' }));
      expect(line.text()).toBe('Photo by A. Person · CC BY-SA 2.0');
      expect(links).toEqual([['Photo by A. Person', PAGE], ['CC BY-SA 2.0', BY_SA]]);
    });

    it('a snapshot frozen before the links, other covers, and links that are not http(s) or a CC deed: plain text', async () => {
      for (const e of [
        openverse({ coverSourceUrl: undefined, coverLicenseUrl: undefined }),
        openverse({ coverSourceUrl: 'javascript:alert(1)', coverLicenseUrl: 'https://evil.example/licenses/by-sa/2.0/' }),
        ev({ coverUrl: `${O}/og/email-cover/cov_0000000000000001`, coverCredit: 'Cover: Host via Partiful' }),
      ]) {
        const { out, line, links } = await render(e);
        expect(line.text()).toBe(e.coverCredit);
        expect(links).toEqual([]);
        expect(line.html()).toBe(load(`<i>${e.coverCredit}</i>`)('i').html());
        expect(out.html).not.toMatch(/javascript:|evil\.example/);
      }
    });

    it('thirty Openverse credits still fit under the size cap', async () => {
      const cats = ['ai', 'hackathon', 'vc', 'campus', 'conference', 'cycling', 'social'] as const;
      const events = Array.from({ length: 30 }, (_, i) =>
        openverse({ id: `evt_ov${String(i).padStart(14, '0')}`, slug: `bridge-walk-${i}`, category: cats[i % 7], noteEn: 'A '.repeat(150) }),
      );
      const e = await must(renderVariant(snap({ events }), v(`en:${cats.join(',')}`)));
      expect(e.bytes).toBeLessThan(MAX_HTML_BYTES);
    });
  });

  it('cuts a long note to about three lines and keeps the rest for the site', async () => {
    const long = 'Worth it for the hallway track alone. '.repeat(30);
    const e = await must(renderVariant(fixture({ events: [ev({ noteEn: long, noteZh: '值得去，走廊交流就够本。'.repeat(30) })] }), v('en:ai')));
    const shown = between(e.html, 'font-size:15px">', '<br/>').slice('font-size:15px">'.length);
    expect(shown.endsWith('…')).toBe(true);
    expect([...shown].length).toBeLessThanOrEqual(NOTE_MAX.en + 1);
    expect(clip('短短一句。', 80)).toBe('短短一句。');
    expect(clip('一二三四五六七八九十', 5)).toBe('一二三四五…');
    expect(clip('alpha beta gamma delta', 13)).toBe('alpha beta…');
  });

  it('masthead names the covered week; the footer is in both languages with every link', async () => {
    const zh = await must(renderVariant(fixture(), VARIANT('zh')));
    expect(zh.text).toMatch(/^Victor 精选 · 10月12日 这一周/);
    for (const s of ['Victor 精选 · Victor 亲自挑选的湾区 tech 活动 · 无付费植入。', "Victor's Picks · Bay Area tech events, picked by Victor · No paid placements."]) {
      expect(zh.text).toContain(s);
    }
    expect(zh.text).toContain(`订阅设置 Preferences <${O}/zh/prefs/${TOKEN}>`);
    expect(zh.text).toContain(`退订 Unsubscribe <${O}/zh/unsubscribe?t=${TOKEN}>`);
    // The switch opens the other-language page with ?lang=, which offers the one-tap change.
    expect(zh.text).toContain(`改收英文版 Switch to English <${O}/prefs/${TOKEN}?lang=en>`);
    expect(zh.text).toContain(`网页版 View in browser <${O}/zh/weekly/2026-W42>`);
    expect(zh.text).toContain(`隐私 Privacy <${O}/zh/privacy>`);
    const en = await must(renderVariant(fixture(), VARIANT('en')));
    expect(en.text).toMatch(/^Victor's Picks · Week of Oct 12/);
    expect(en.text).toContain(`Switch to Chinese 改收中文版 <${O}/zh/prefs/${TOKEN}?lang=zh>`);
    expect(en.text).toContain(`View in browser 网页版 <${O}/weekly/2026-W42>`);
    expect(en.text).toContain(`Privacy 隐私 <${O}/privacy>`);
    for (const e of [zh, en]) expectTextLinksDelimited(e.text);
    expect(en.html).not.toMatch(/mailing address|PO Box/i);
  });

  it('headings keep their case in the plain-text part and events are separated', async () => {
    const en = await must(renderVariant(fixture(), VARIANT('en')));
    expect(en.text).toContain('Victor is going');
    expect(en.text).not.toContain('VICTOR IS GOING');
    expect(en.text).toContain('Cover: AI Builders via Partiful\n\nOct 15 Thu\n\nEvals in Practice');
    const twoOnADay = await must(
      renderVariant(snap({ events: [ev({ id: 'evt_sameday000000001', titleEn: 'First' }), ev({ id: 'evt_sameday000000002', titleEn: 'Second' })] }), v('en:ai')),
    );
    expect(twoOnADay.text).toContain('RSVP on Luma <https://luma.com/evt_sameday000000001>\n\nSecond <https://');
  });

  it('returns null when the variant has no picks; refuses unknown snapshot versions', async () => {
    expect(await renderVariant(fixture(), v('en:campus,conference'))).toBeNull();
    await expect(renderVariant({ ...fixture(), version: 2 } as unknown as DigestSnapshot, VARIANT('en'))).rejects.toThrow(/version/);
  });

  it('is byte-identical for the same snapshot (a retried batch sends the same payload)', async () => {
    const a = await must(renderVariant(fixture(), VARIANT('zh')));
    const b = await must(renderVariant(structuredClone(fixture()), VARIANT('zh')));
    expect(b).toEqual(a);
  });

  it('refuses a snapshot that carries the link placeholder anywhere (it would leak each reader’s token)', async () => {
    const poisoned: Partial<DigestSnapshot>[] = [
      { events: [ev({ sourceUrl: `https://evil.example/rsvp/${TOKEN}` })] }, // the RSVP link: a third-party site
      { events: [ev({ noteEn: `See ${TOKEN}` })] },
      { events: [ev()], preview: [ev({ startAt: '2026-10-21T01:00:00.000Z', titleEn: TOKEN })] },
      { events: [ev()], introEn: `hi ${TOKEN}` },
    ];
    for (const over of poisoned) {
      await expect(renderVariant(snap(over), v('en:ai'))).rejects.toThrow(/link placeholder/);
      await expect(renderEmptyNotice(snap(over), v('en:campus'))).rejects.toThrow(/link placeholder/);
    }
  });
});

describe('renderVariant: email-client constraints', () => {
  it.each(['en', 'zh'] as const)('%s: doctype, lang, tables only, safe images, dark mode, no addresses', async (l) => {
    const e = await must(renderVariant(fixture(), VARIANT(l)));
    const imgs = expectEmailSafe(e.html, l);
    expect(imgs.length).toBe(5 + 6); // covers + seals
    expect(e.html).toContain('max-width:600px');
    expect(e.html).not.toContain('<Button');
    expect(e.html).not.toMatch(/mso-padding-alt/); // react-email <Button> markup
  });

  it.each(['en', 'zh'] as const)('%s: three placeholder links, all replaced by personalize', async (l) => {
    const e = await must(renderVariant(fixture(), VARIANT(l)));
    expect(e.html.split(TOKEN).length - 1).toBe(3); // prefs, unsubscribe, other-language prefs
    expect(e.text.split(TOKEN).length - 1).toBe(3);
    const out = personalize(e, REAL_TOKEN);
    expect(out.subject).toBe(e.subject);
    expect(out.html).not.toContain(TOKEN);
    expect(out.text).not.toContain(TOKEN);
    expect(out.html.split(REAL_TOKEN).length - 1).toBe(3);
    expect(out.text).toContain(`/unsubscribe?t=${REAL_TOKEN}`);
    // `bytes` is the size as delivered, with a real 64-character token in place.
    expect(Buffer.byteLength(out.html, 'utf8')).toBe(e.bytes);
  });

  it('personalize fails closed unless the placeholder count is exactly the links we render', async () => {
    const e = await must(renderVariant(fixture(), VARIANT('en')));
    const extra = { ...e, html: e.html.replace('</body>', `<a href="https://evil.example/${TOKEN}">x</a></body>`) };
    expect(() => personalize(extra, REAL_TOKEN)).toThrow(/personalize: unexpected placeholder count/);
    expect(() => personalize({ ...e, text: `${e.text} ${TOKEN}` }, REAL_TOKEN)).toThrow(/placeholder count/);
    expect(() => personalize({ ...e, html: e.html.replace(TOKEN, 'x') }, REAL_TOKEN)).toThrow(/placeholder count/);
    expect(() => personalize({ ...e, subject: `${e.subject} ${TOKEN}` }, REAL_TOKEN)).toThrow(/placeholder count/);
    // The empty notice has four (its body link + the footer's three); a digest's three won't pass as one.
    const empty = await renderEmptyNotice(fixture(), v('en:campus'));
    expect(personalize(empty, REAL_TOKEN).html.split(REAL_TOKEN).length - 1).toBe(4);
    expect(() => personalize({ ...e, picks: 0 }, REAL_TOKEN)).toThrow(/placeholder count/);
  });

  it.each(['en', 'zh'] as const)('%s: worst case (7 categories, 30 events, long everything) stays under 90 KB', async (l) => {
    const cats = ['ai', 'hackathon', 'vc', 'campus', 'conference', 'cycling', 'social'] as const;
    const events = Array.from({ length: 30 }, (_, i) =>
      ev({
        category: cats[i % 7],
        startAt: new Date(Date.parse('2026-10-12T16:00:00.000Z') + (i % 7) * 864e5 + i * 6e5).toISOString(),
        endAt: new Date(Date.parse('2026-10-12T19:00:00.000Z') + (i % 7) * 864e5 + i * 6e5).toISOString(),
        titleEn: 'Founders and Builders Summit: Agents, Infra and the Next Platform Shift', titleZh: '创始人与开发者峰会：智能体、基础设施与下一次平台迁移',
        noteEn: 'A long note about why this one is worth going to, and who you will meet there. '.repeat(25),
        noteZh: '为什么值得去，以及你会在那里遇到谁的一段很长的说明。'.repeat(40),
        place: 'Mission District, San Francisco', priceText: '$1,200 early bird', access: 'apply',
        coverCredit: 'Cover: Some Very Long Host Name Collective via Luma', seal: i % 4 === 0 && cats[i % 7] !== 'cycling' ? 'going' : null,
        coverUrl: `${O}/og/email-cover/cov_${String(i).padStart(16, '0')}`, sourceUrl: `https://luma.com/very-long-event-slug-${i}-abcdefgh`,
      }),
    );
    const preview = Array.from({ length: 8 }, (_, i) =>
      ev({
        category: cats[i % 7], startAt: new Date(Date.parse('2026-10-20T01:00:00.000Z') + i * 432e5).toISOString(),
        titleEn: 'A Featured Event Next Week With a Fairly Long Name', titleZh: '下周的一场名字相当长的精选活动',
      }),
    );
    const s = snap({ events, preview, introEn: 'An intro line that runs on for a while. '.repeat(6), introZh: '一行写得比较长的导语。'.repeat(12) });
    const e = await must(renderVariant(s, v(`${l}:ai,campus,conference,cycling,hackathon,social,vc`)));
    expect(e.picks).toBe(30);
    expect(e.bytes).toBeLessThan(MAX_HTML_BYTES);
    expectEmailSafe(e.html, l);
    expectTextLinksDelimited(e.text);
    expect(Buffer.byteLength(personalize(e, REAL_TOKEN).html)).toBeLessThanOrEqual(MAX_HTML_BYTES);
  });

  it('refuses to render a variant over the cap rather than letting Gmail clip it', async () => {
    const events = Array.from({ length: 80 }, (_, i) =>
      ev({ startAt: new Date(Date.parse('2026-10-12T16:00:00.000Z') + i * 6e6).toISOString(), endAt: null, noteZh: '值得去的理由写在这里，写得长一点。'.repeat(10), priceText: '$20', access: 'apply' }),
    );
    const p = renderVariant(snap({ events }), v('zh:ai'));
    await expect(p).rejects.toBeInstanceOf(DigestTooLargeError);
    await expect(p).rejects.toThrow(/limit 90000/);
  });

  it('personalize refuses a personalised copy over the cap with the same typed error', async () => {
    const e = await must(renderVariant(fixture(), VARIANT('en')));
    const padded = { ...e, html: e.html.replace('</body>', `<p>${'x'.repeat(MAX_HTML_BYTES)}</p></body>`) };
    expect(() => personalize(padded, REAL_TOKEN)).toThrow(DigestTooLargeError);
  });
});

describe('renderEmptyNotice', () => {
  it.each(['en', 'zh'] as const)('%s: short body, a link to add categories, the full footer', async (l) => {
    const e = await renderEmptyNotice(fixture(), v(`${l}:campus,conference`));
    expectEmailSafe(e.html, l);
    expect([e.picks, e.going]).toEqual([0, 0]);
    expect(e.subject).toBe(l === 'en' ? "Nothing I'd recommend this week" : '本周没有想推荐的');
    expect(e.preheader).toBe(l === 'en' ? "Nothing in your categories this week that I'd recommend." : '这周你选的类别里没有我想推荐的活动。');
    const prefs = `${O}${l === 'zh' ? '/zh' : ''}/prefs/${TOKEN}`;
    // The URL is delimited, so a linkifier can't run it into the Chinese that follows.
    expect(e.text).toContain(l === 'en' ? `You can add categories in your preferences <${prefs}>.` : `可以在订阅设置 <${prefs}>里多选几类。`);
    expectTextLinksDelimited(e.text);
    expect(e.html.split(TOKEN).length - 1).toBe(4); // body link + the footer's three
    expect(e.text).toContain('No paid placements.');
    expect(e.text).toContain('无付费植入。');
    for (const x of EVENTS) expect(e.html).not.toContain(x.slug);
    expect(e.html).not.toContain('/og/seal/');
  });
});

// F19: event-language and online-only facets. The same week with languages set: AI builders night
// (en, in person, going), evals (zh, online), Cal Hacks (bilingual, in person, hosting), office
// hours (en, hybrid, speaking), boba (zh, in person), ride (en); preview: AI infra (zh), board games (en).
const LANGS: Record<string, DigestEvent['eventLanguage']> = {
  'evals-in-practice': 'zh', 'cal-hacks-weekend': 'bilingual', 'founder-office-hours': 'en', 'late-night-boba': 'zh', 'ai-infra-meetup': 'zh',
  'board-game-night': 'en',
};
const withLang = (e: DigestEvent): DigestEvent => (LANGS[e.slug] ? { ...e, eventLanguage: LANGS[e.slug] } : e);
const facetFixture = () => fixture({ events: EVENTS.map(withLang), preview: PREVIEW.map(withLang) });
const CATS = ['ai', 'hackathon', 'vc', 'social'];
const slugsOf = (sel: ReturnType<typeof selectForVariant>) => sel.sections.flatMap((x) => x.days.flatMap((d) => d.events.map((e) => e.slug)));

describe('F19 facets', () => {
  it('sections, going, preview and the picks count all follow the facets', () => {
    const s = facetFixture();
    const zh = selectForVariant(s, CATS, { evLang: 'zh', onlineOnly: false });
    expect(slugsOf(zh)).toEqual(['evals-in-practice', 'cal-hacks-weekend', 'late-night-boba']);
    expect([zh.picks, zh.going.map((e) => e.slug), zh.preview.map((e) => e.slug)]).toEqual([3, ['cal-hacks-weekend'], ['ai-infra-meetup']]);
    const en = selectForVariant(s, CATS, { evLang: 'en', onlineOnly: false });
    expect(slugsOf(en)).toEqual(['ai-builders-night', 'cal-hacks-weekend', 'founder-office-hours']);
    expect(en.preview.map((e) => e.slug)).toEqual(['board-game-night']);
    const bi = selectForVariant(s, CATS, { evLang: 'bilingual', onlineOnly: false });
    expect(slugsOf(bi)).toEqual(['cal-hacks-weekend']);
    // Online only keeps online and hybrid; the preview's in-person events go.
    const online = selectForVariant(s, CATS, { evLang: null, onlineOnly: true });
    expect(slugsOf(online)).toEqual(['evals-in-practice', 'founder-office-hours']);
    expect([online.going.map((e) => e.slug), online.preview]).toEqual([['founder-office-hours'], []]);
    expect(selectForVariant(s, CATS, { evLang: 'zh', onlineOnly: true }).picks).toBe(1);
    // A variant passes as the facets (it carries evLang / onlineOnly).
    expect(selectForVariant(s, CATS, v('en:ai,hackathon,social,vc;l=zh;o'))).toEqual(selectForVariant(s, CATS, { evLang: 'zh', onlineOnly: true }));
  });

  it('isEmptyFor and pickCells agree with the selection', () => {
    const s = facetFixture();
    expect(isEmptyFor(s, ['social'], { evLang: 'en', onlineOnly: false })).toBe(true);
    expect(isEmptyFor(s, ['social'], { evLang: 'zh', onlineOnly: false })).toBe(false);
    expect(isEmptyFor(s, ['hackathon'], { evLang: 'en', onlineOnly: true })).toBe(true);
    expect(isEmptyFor(s, ['vc'], { evLang: 'en', onlineOnly: true })).toBe(false); // hybrid counts as online
    expect(pickCells(s)).toEqual([
      { category: 'ai', lang: 'en', online: false },
      { category: 'ai', lang: 'zh', online: true },
      { category: 'hackathon', lang: 'bilingual', online: false },
      { category: 'vc', lang: 'en', online: true },
      { category: 'cycling', lang: 'en', online: false },
      { category: 'social', lang: 'zh', online: false },
    ]);
  });

  it('a snapshot frozen before F19 (no eventLanguage) reads every event as English', () => {
    const old = fixture();
    expect(old.events.every((e) => !('eventLanguage' in e))).toBe(true);
    expect(selectForVariant(old, CATS, { evLang: 'en', onlineOnly: false }).picks).toBe(selectForVariant(old, CATS).picks);
    expect(isEmptyFor(old, CATS, { evLang: 'zh', onlineOnly: false })).toBe(true);
    expect(pickCells(old).every((c) => c.lang === 'en')).toBe(true);
  });

  it.each(['en', 'zh'] as const)('%s: subject counts follow the facets; one facet line in html and text', async (l) => {
    const e = await must(renderVariant(facetFixture(), v(`${l}:ai,hackathon,social,vc;l=zh`)));
    expectEmailSafe(e.html, l);
    expect([e.picks, e.going]).toEqual([3, 1]);
    expect(e.subject).toBe(l === 'en' ? '3 picks this week · Victor is going to 1' : '本周 3 场精选 · Victor 会去 1 场');
    const note = l === 'en' ? 'Only Chinese or bilingual events. You can change this in your preferences.' : '只收：中文或双语活动。可以在订阅设置里修改。';
    expect(e.html.split(note).length - 1).toBe(1);
    expect(e.text.split(note).length - 1).toBe(1);
    expect(e.html).not.toContain('ai-builders-night');
    expect(e.html).not.toContain('board-game-night');
    expect(e.html.split(TOKEN).length - 1).toBe(3); // the facet line adds no link
    const both = await must(renderVariant(facetFixture(), v(`${l}:ai,hackathon,social,vc;l=en;o`)));
    // Both facets AND together, so they read as one phrase, not a list.
    expect(both.text).toContain(
      l === 'en' ? 'Only online (incl. hybrid) English or bilingual events.' : '只收：线上（含线上线下同步）的英文或双语活动。',
    );
    expect([both.picks, both.going]).toEqual([1, 1]);
  });

  it('facets that leave the content as it is only add the facet line: the rest is byte-identical', async () => {
    // fixture() has no eventLanguage (all English): an English-or-bilingual reader sees every event.
    const plain = await must(renderVariant(fixture(), VARIANT('en')));
    const faceted = await must(renderVariant(fixture(), v('en:ai,hackathon,social,vc;l=en')));
    const line = /<p class="mut" style="margin:0 0 6px;font-size:12px;color:#[0-9a-f]{6};margin-bottom:10px">Only [^<]*<\/p>/;
    expect(faceted.html).toMatch(line);
    expect(faceted.html.replace(line, '')).toBe(plain.html);
    expect(faceted.subject).toBe(plain.subject);
  });

  it.each(['en', 'zh'] as const)('%s empty notice with facets: the filters are named, and widening them is suggested', async (l) => {
    const e = await renderEmptyNotice(facetFixture(), v(`${l}:social;l=en;o`));
    expectEmailSafe(e.html, l);
    const prefs = `${O}${l === 'zh' ? '/zh' : ''}/prefs/${TOKEN}`;
    expect(e.preheader).toBe(l === 'en' ? "Nothing in your categories and filters this week that I'd recommend." : '这周你选的类别和筛选条件里没有我想推荐的活动。');
    expect(e.text).toContain(
      l === 'en' ? `You can add categories or widen your filters in your preferences <${prefs}>.` : `可以在订阅设置 <${prefs}>里多选几类，或者放宽筛选。`,
    );
    expect(e.text).toContain(l === 'en' ? 'Only online (incl. hybrid) English or bilingual events.' : '只收：线上（含线上线下同步）的英文或双语活动。');
    expect(e.html.split(TOKEN).length - 1).toBe(4);
    // Without facets the notice is the pre-F19 one.
    const plain = await renderEmptyNotice(facetFixture(), v(`${l}:campus`));
    expect(plain.preheader).toBe(l === 'en' ? "Nothing in your categories this week that I'd recommend." : '这周你选的类别里没有我想推荐的活动。');
    expect(plain.text).not.toContain(l === 'en' ? 'You can change this in your preferences.' : '只收：');
  });

  it('facetNote: one facet is named as is; both read as ONE phrase (they AND), in each language', async () => {
    const { facetNote } = await import('@/emails/copy');
    const tail = { en: ' You can change this in your preferences.', zh: '可以在订阅设置里修改。' };
    const cases = [
      [{ evLang: 'zh', onlineOnly: false }, 'Only Chinese or bilingual events.', '只收：中文或双语活动。'],
      [{ evLang: 'bilingual', onlineOnly: false }, 'Only bilingual events.', '只收：双语活动。'],
      [{ evLang: null, onlineOnly: true }, 'Only online events (incl. hybrid).', '只收：线上活动（含线上线下同步）。'],
      [{ evLang: 'zh', onlineOnly: true }, 'Only online (incl. hybrid) Chinese or bilingual events.', '只收：线上（含线上线下同步）的中文或双语活动。'],
      [{ evLang: 'en', onlineOnly: true }, 'Only online (incl. hybrid) English or bilingual events.', '只收：线上（含线上线下同步）的英文或双语活动。'],
    ] as const;
    for (const [f, en, zh] of cases) {
      expect(facetNote('en', f)).toBe(en + tail.en);
      expect(facetNote('zh', f)).toBe(zh + tail.zh);
    }
    expect(facetNote('en', { evLang: null, onlineOnly: false })).toBeNull();
  });

  it('a variant without picks under its facets renders no digest (the claim sends the notice instead)', async () => {
    expect(await renderVariant(facetFixture(), v('en:social;l=en'))).toBeNull();
    expect(await renderVariant(facetFixture(), v('en:hackathon;o'))).toBeNull();
  });
});

describe('personalize', () => {
  it('rejects anything that is not a plain link token', async () => {
    const e = await must(renderVariant(fixture(), VARIANT('en')));
    for (const bad of ['', 'a b', 'x"y', 'me@example.org', '../x', '<t>', 'tok&x=1', `x${TOKEN}y`]) {
      expect(() => personalize(e, bad), bad).toThrow(/personalize/);
    }
  });
});

describe('digestLinks', () => {
  it('builds each language from the snapshot origin, with the other language (and ?lang=) as the switch', () => {
    expect(digestLinks(fixture(), 'zh', 'TKN')).toEqual({
      prefs: `${O}/zh/prefs/TKN`,
      unsubscribe: `${O}/zh/unsubscribe?t=TKN`,
      otherLanguage: `${O}/prefs/TKN?lang=en`,
      web: `${O}/zh/weekly/2026-W42`,
      privacy: `${O}/zh/privacy`,
    });
    expect(digestLinks(fixture({ origin: 'https://other.example' }), 'en', 'TKN')).toEqual({
      prefs: 'https://other.example/prefs/TKN',
      unsubscribe: 'https://other.example/unsubscribe?t=TKN',
      otherLanguage: 'https://other.example/zh/prefs/TKN?lang=zh',
      web: 'https://other.example/weekly/2026-W42',
      privacy: 'https://other.example/privacy',
    });
  });

  it('a snapshot without events (empty notices only) has no archive page, so "view in browser" opens the week', () => {
    expect(digestLinks(snap(), 'zh', 'TKN').web).toBe(`${O}/zh/week/2026-W42`);
    expect(digestLinks(snap(), 'en', 'TKN').web).toBe(`${O}/week/2026-W42`);
  });
});

// ---- image routes ------------------------------------------------------------------------------

const require = createRequire(import.meta.url);
const GEIST = (() => {
  const buf = readFileSync(require.resolve('next/dist/compiled/@vercel/og/Geist-Regular.ttf'));
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
})();

describe('/og/seal/[kind]', () => {
  const route = () => import('@/app/og/seal/[kind]/route');
  const get = async (kind: string, q = '') => (await route()).GET(new Request(`${O}/og/seal/${kind}${q}`), { params: Promise.resolve({ kind }) });
  beforeEach(() => {
    // Satori fetches fallback glyphs from Google Fonts for anything the given fonts lack; keep tests offline.
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    h.fonts = [];
  });

  it('404s for anything but going, hosting and speaking (never "went" or "interested")', async () => {
    for (const k of ['went', 'interested', 'none', 'GOING', '..']) expect((await get(k)).status).toBe(404);
  });

  it('renders a 96 px PNG, cached for a year once the label font loaded', async () => {
    h.fonts = [{ name: 'Geist Mono', data: GEIST, weight: 500, style: 'normal' }];
    const res = await get('going', '?l=en');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(res.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    const meta = await sharp(Buffer.from(await res.arrayBuffer())).metadata();
    expect([meta.format, meta.width, meta.height, meta.hasAlpha]).toEqual(['png', 96, 96, true]);
  });

  it('a missing font still renders but is only cached briefly (zh, or no fonts at all)', async () => {
    h.fonts = [{ name: 'Geist Mono', data: GEIST, weight: 500, style: 'normal' }]; // no Noto Serif SC
    const zh = await get('hosting', '?l=zh');
    expect(zh.status).toBe(200);
    expect(zh.headers.get('cache-control')).toBe('public, max-age=300');
    expect((await sharp(Buffer.from(await zh.arrayBuffer())).metadata()).width).toBe(96);
    h.fonts = [];
    const bare = await get('speaking');
    expect(bare.status).toBe(200);
    expect(bare.headers.get('cache-control')).toBe('public, max-age=300');
  });
});

describe('/og/template/[category] email size', () => {
  afterEach(() => {
    h.fonts = [];
  });
  it('accepts s=192 for the 96 px email slot', async () => {
    h.fonts = [{ name: 'Fraunces', data: GEIST, weight: 600, style: 'normal' }];
    const { GET } = await import('@/app/og/template/[category]/route');
    const res = await GET(new Request(`${O}/og/template/ai?s=192`), { params: Promise.resolve({ category: 'ai' }) });
    const meta = await sharp(Buffer.from(await res.arrayBuffer())).metadata();
    expect([res.status, meta.width, meta.height]).toEqual([200, 192, 192]);
  });
});

describe('/og/email-cover/[coverId]', () => {
  const BLOB = 'https://abc123.public.blob.vercel-storage.com/covers/evt_x/0011-400.webp';
  const route = () => import('@/app/og/email-cover/[coverId]/route');
  const get = async (coverId: string) => (await route()).GET(new Request(`${O}/og/email-cover/${coverId}`), { params: Promise.resolve({ coverId }) });
  const row = (id: string, over: Partial<typeof covers.$inferInsert> = {}) => ({
    id, kind: 'official' as const, url1600: BLOB, url800: BLOB, url400: BLOB, urlOgEn: '', urlOgZh: '', thumbhash: '', dominant: '', bytes: 1, ...over,
  });
  beforeEach(async () => {
    h.db = (await testDb()).db;
    h.hasDb = true;
    h.fetched = [];
    h.fetchBytes = async () => sharp({ create: { width: 400, height: 400, channels: 4, background: { r: 200, g: 60, b: 40, alpha: 1 } } }).webp().toBuffer();
    const db = h.db as import('@/lib/db').DB;
    await db.insert(covers).values([
      row('cov_0000000000000001'),
      row('cov_0000000000000002', { kind: 'template', url400: `${O}/og/template/ai?s=400` }),
      row('cov_0000000000000003', { kind: 'upload', url400: 'https://evil.example/x.webp' }),
    ]);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    h.fetchBytes = null;
  });

  it('turns the stored WebP into a 192 px JPEG cached for a year', async () => {
    const res = await get('cov_0000000000000001');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/jpeg');
    expect(res.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    const meta = await sharp(Buffer.from(await res.arrayBuffer())).metadata();
    expect([meta.format, meta.width, meta.height]).toEqual(['jpeg', 192, 192]);
    expect(h.fetched).toEqual([BLOB]);
  });

  it('404s for unknown ids, junk ids, template covers and files that are not ours, without fetching', async () => {
    for (const id of ['cov_zzzzzzzzzzzzzzzz', 'nope', 'cov_0000000000000001x', 'cov_0000000000000002', 'cov_0000000000000003']) {
      const res = await get(id);
      expect(res.status, id).toBe(404);
    }
    expect(h.fetched).toEqual([]);
    h.hasDb = false;
    h.db = new Proxy({}, { get: () => { throw new Error('database touched'); } });
    expect((await get('cov_0000000000000001')).status).toBe(404);
  });

  it('a failed fetch is a 502 that is never cached', async () => {
    h.fetchBytes = async () => { throw new Error('HTTP 500'); };
    const res = await get('cov_0000000000000001');
    expect(res.status).toBe(502);
    expect(res.headers.get('cache-control')).toBe('no-store');
    h.fetchBytes = async () => Buffer.from('<html>not an image</html>');
    expect((await get('cov_0000000000000001')).status).toBe(502);
  });
});
