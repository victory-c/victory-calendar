import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DigestEvent } from '@/lib/digest/types';
import { ev, O, snap } from './helpers/digest-fixtures';
import { testDb } from './helpers/pglite';

// F17 (M4): the export model shared by the WeChat text, the 1080 px long image and the
// Xiaohongshu pages; its pagination, caption and URL check; the chunked font loader (fetch
// mocked); the cover conversion (PGlite, safe-fetch mocked); the SocialExport panel's markup.
const h = vi.hoisted(() => ({ db: null as unknown, fetchBytes: null as null | ((url: string) => Promise<Buffer>), fetched: [] as string[] }));
vi.mock('@/lib/db', async (orig) => ({ ...(await orig()), db: new Proxy({}, { get: (_t, p) => Reflect.get(h.db as object, p) }), hasDatabase: () => true }));
vi.mock('@/lib/ingest/safe-fetch', async (orig) => ({
  ...(await orig()),
  safeFetchBytes: async (url: string) => {
    h.fetched.push(url);
    return h.fetchBytes!(url);
  },
}));

const social = await import('@/lib/digest/social');
const { exportModel, imageModel, itemsOf, lineCount, longPlan, xhsPlan, xhsCaption, urlLike, xhsStrings, exportWarnings, exportHash, parseImageName, LONG, XHS, XHS_SLOT } = social;
const { fitCredit, longItemLines, monoEm, CREDIT_LINES, LONG_TEXT_W } = social;
const { wechatText, wechatTextOf, liveState } = await import('@/lib/digest/wechat');
const { coverImages } = await import('@/lib/digest/social-covers');
const { chunkChars, textFonts, _resetTextFonts, FONT_MAX_BYTES, TEXT_CHUNK } = await import('@/lib/og/fonts');
const { fitBytes, imageText, LongImage } = await import('@/lib/og/social');
const { SocialExport, imageProblem, statusLine, focusIfDropped } = await import('@/components/admin/SocialExport');
const { covers } = await import('@/lib/db/schema');
const { CATEGORY_SLUGS } = await import('@/lib/taxonomy');
type DB = import('@/lib/db').DB;

const ORIGIN = 'https://victor-picks.example.app';
const opts = (o: Partial<Parameters<typeof exportModel>[1]> = {}) => ({ origin: ORIGIN, subscribe: false, ...o });
const must = <T,>(v: T | null | undefined): T => {
  if (v == null) throw new Error('expected a value');
  return v;
};

// 2026-W42: Wed 18:30 in person (going), Thu 17:00 online, Sat–Sun hackathon (as digest-wechat.test.ts).
const THREE: DigestEvent[] = [
  ev({
    id: 'evt_sx00000000000001', category: 'ai', startAt: '2026-10-15T01:30:00.000Z', endAt: '2026-10-15T04:00:00.000Z',
    titleEn: 'AI Tinkerers SF: Agents Demo Night', titleZh: 'AI Tinkerers SF: Agents Demo Night', priceText: 'Free', access: 'apply',
    seal: 'going', noteZh: '上次 demo 质量很高，名额少，早点申请。',
  }),
  ev({
    id: 'evt_sx00000000000002', category: 'vc', startAt: '2026-10-16T00:00:00.000Z', endAt: '2026-10-16T01:00:00.000Z', format: 'online',
    place: null, titleEn: 'Early-Stage Fundraising AMA', titleZh: '早期融资 AMA：怎么拿到第一张 term sheet', noteZh: '适合还没融过钱的团队。',
  }),
  ev({
    id: 'evt_sx00000000000003', category: 'hackathon', startAt: '2026-10-17T16:00:00.000Z', endAt: '2026-10-19T00:00:00.000Z',
    titleEn: 'Berkeley AI Hackathon', titleZh: 'Berkeley AI Hackathon', place: 'Berkeley', platform: 'Partiful',
  }),
];
const week = (over: Parameters<typeof snap>[0] = {}) => snap({ events: THREE, introZh: '周三晚上 AI Tinkerers 我会去。\n周末有黑客松。', ...over });

/** n events from Monday 9:00 PT, two hours apart (up to 79 fit the week), every category, an official title on every other one, a note on two in three. */
function many(n: number, over: (i: number) => Partial<DigestEvent> = () => ({})): DigestEvent[] {
  const at = (i: number, hr = 0) => new Date(Date.parse('2026-10-12T16:00:00.000Z') + (i * 2 + hr) * 3600_000).toISOString();
  return Array.from({ length: n }, (_, i) =>
    ev({
      id: `evt_mn${String(i).padStart(14, '0')}`, category: CATEGORY_SLUGS[i % CATEGORY_SLUGS.length], startAt: at(i), endAt: at(i, 1),
      titleZh: `湾区创业者交流会 ${i + 1}`, titleEn: i % 2 ? `Bay Area Founders Mixer ${i + 1}` : `湾区创业者交流会 ${i + 1}`,
      noteZh: i % 3 ? '人不多，适合认识早期团队，可以带上你的 demo。' : null, ...over(i),
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('exportModel: one model for the text and the images', () => {
  it('prints exactly the WeChat text, numbering included', () => {
    for (const s of [week(), week({ events: many(30), preview: [ev({ startAt: '2026-10-21T01:00:00.000Z' })] })]) {
      const m = must(exportModel(s, opts({ subscribe: true })));
      expect(wechatTextOf(m)).toEqual(wechatText(s, opts({ subscribe: true })));
      const numbered = wechatTextOf(m).text.split('\n').filter((l) => /^\d+\. /.test(l)).map((l) => Number(l.split('.')[0]));
      expect(itemsOf(m).map((it) => it.n)).toEqual(numbered);
    }
  });

  it('numbers by start across categories, grouped by Pacific day, with the fields each image prints', () => {
    const m = must(exportModel(week(), opts()));
    expect(m).toMatchObject({ isoWeek: '2026-W42', site: 'Victor 精选', monday: '10月12日', weekOf: '10月12日 这一周', subject: '本周 3 场精选 · Victor 会去 1 场', picks: 3, going: 1 });
    expect(m.weekUrl).toBe(`${ORIGIN}/zh/week/2026-W42`);
    expect(m.days.map((d) => d.label)).toEqual(['10月14日周三', '10月15日周四', '10月17日周六']);
    expect(itemsOf(m)[0]).toMatchObject({ n: 1, seal: 'going', time: '18:30–21:00', meta: '18:30–21:00 · SoMa · 免费 · 需申请 · Luma', dayLabel: '10月14日周三' });
    expect(itemsOf(m)[1]).toMatchObject({ n: 2, title: '早期融资 AMA：怎么拿到第一张 term sheet', alt: 'Early-Stage Fundraising AMA', seal: null });
  });

  it('a cancelled event keeps its place, unnumbered, without seal or note; attendance off drops every seal', () => {
    const cur = liveState(week(), [], new Date(), true); // no live rows: everything taken down
    expect(exportModel(cur.snap, opts())).toBeNull();
    const m = must(exportModel(week(), opts({ cancelled: new Set([THREE[0].id]) })));
    expect(itemsOf(m).map((it) => it.n)).toEqual([null, 1, 2]);
    expect(itemsOf(m)[0]).toMatchObject({ seal: null, note: null });
    expect(m).toMatchObject({ picks: 2, going: 0 });
    const off = must(exportModel(week({ showAttendance: false }), opts()));
    expect(itemsOf(off).every((it) => it.seal === null)).toBe(true);
    expect(off.going).toBe(0);
  });

  it('the cover id comes from the email cover URL; the template has no id and no credit', () => {
    const m = must(
      exportModel(
        snap({
          events: [
            ev({ coverUrl: `${O}/og/email-cover/cov_0000000000000abc`, coverCredit: 'Cover: Host via Luma' }),
            ev({ coverUrl: `${O}/og/template/ai?s=192`, coverCredit: 'stale', startAt: '2026-10-15T01:30:00.000Z' }),
            ev({ coverUrl: 'https://elsewhere.example.org/og/email-cover/cov_x', coverCredit: 'x', startAt: '2026-10-16T01:30:00.000Z' }),
          ],
        }),
        opts(),
      ),
    );
    expect(itemsOf(m).map((it) => [it.coverId, it.credit])).toEqual([['cov_0000000000000abc', 'Cover: Host via Luma'], [null, null], [null, null]]);
  });

  it('null when nothing is picked; refuses an unknown snapshot version', () => {
    expect(exportModel(snap(), opts())).toBeNull();
    expect(() => exportModel({ ...week(), version: 2 } as unknown as ReturnType<typeof snap>, opts())).toThrow(/version/);
  });
});

describe('images: emoji, line counts, pagination', () => {
  it('images drop emoji; the text keeps the words exactly as they are', () => {
    const s = week({ events: [ev({ titleZh: '🚀 发布会 Launch Night 🎉', noteZh: '一定要来 👍🏽' })], introZh: '本周推荐 🇺🇸 见' });
    const m = must(exportModel(s, opts()));
    expect(itemsOf(m)[0].title).toBe('🚀 发布会 Launch Night 🎉');
    const im = imageModel(m);
    expect(itemsOf(im)[0]).toMatchObject({ title: '发布会 Launch Night', note: '一定要来' });
    expect(im.intro).toEqual(['本周推荐 见']);
    for (const s2 of Object.values(imageText(m))) expect(s2).not.toMatch(/\p{Extended_Pictographic}/u);
    // Without emoji the image model is the model.
    expect(imageModel(must(exportModel(week(), opts())))).toEqual(must(exportModel(week(), opts())));
  });

  it('lineCount: CJK by the em, Latin words kept whole, closing punctuation travels with its character', () => {
    expect(lineCount('', 10)).toBe(0);
    expect(lineCount('一二三四五六七八九十', 10.6)).toBe(1);
    expect(lineCount('一二三四五六七八九十一', 10.6)).toBe(2);
    expect(lineCount('一二三四五六七八九，', 9.6)).toBe(2); // "九，" can't be split, so 九 moves down too
    expect(lineCount('Mm Mm', 4)).toBe(2);
    expect(lineCount('Mm Mm', 5)).toBe(1);
    expect(lineCount('a'.repeat(30), 10)).toBeGreaterThanOrEqual(2); // a word wider than the box wraps by force
  });

  it('cover credits: measured for Geist Mono, up to three lines, the licence never cut', () => {
    const creditW = LONG_TEXT_W / LONG.item.credit.size;
    const typical = '"Golden Gate Bridge from the Marin Headlands at dusk" by Jane Example · CC BY 2.0 · cropped';
    const it0 = itemsOf(must(exportModel(week(), opts())))[0];
    expect(fitCredit(typical)).toBe(typical);
    expect(longItemLines({ ...it0, credit: typical }).credit).toBe(2); // ~60 mono characters a line
    expect(longItemLines({ ...it0, credit: 'Cover: Host via Luma' }).credit).toBe(1);

    // The longest credit.ts makes: a 120-character title and an 80-character creator.
    const creator = 'Photographer With A Very Long Name And Several Middle Names For Testing Purposes';
    const long = `"${'Sunset over the bay '.repeat(6).trim()}" by ${creator} · CC BY-SA 2.0 · padded to square`;
    expect(lineCount(long, creditW, monoEm)).toBeGreaterThan(CREDIT_LINES);
    const fit = fitCredit(long);
    expect(fit).toMatch(/^"Sunset over the bay .*…" by /);
    expect(fit.endsWith(` by ${creator} · CC BY-SA 2.0 · padded to square`)).toBe(true);
    expect(lineCount(fit, creditW, monoEm)).toBeLessThanOrEqual(CREDIT_LINES);
    expect(lineCount(fitCredit(long.replace(/ · CC BY-SA 2\.0/, '')), creditW, monoEm)).toBeGreaterThan(CREDIT_LINES); // nothing to keep: left to the clamp

    // In the plan and in the drawing: the item's credit is the fitted one, three lines of 26 px.
    const m = must(
      exportModel(week({ events: [{ ...THREE[0], coverUrl: `${O}/og/email-cover/cov_0000000000000abc`, coverCredit: long }] }), { origin: O, subscribe: false }),
    );
    const part = longPlan(m)[0];
    const b = part.blocks.find((x) => x.kind === 'item');
    if (b?.kind !== 'item') throw new Error('no item');
    expect([b.item.credit, b.lines.credit]).toEqual([fit, 3]);
    const f = { serif: 'serif', sans: 'sans', mono: 'mono' };
    const out = renderToStaticMarkup(createElement(LongImage, { m: imageModel(m), part, f, covers: new Map([[b.item.eventId, 'data:image/jpeg;base64,AA']]) }));
    const credit = [...out.matchAll(/<div style="([^"]*)">([^<]*)<\/div>/g)].find((x) => x[2].includes('CC BY-SA 2.0'));
    expect(credit?.[1]).toContain(`height:${3 * LONG.item.credit.lh}px`);
    expect(credit?.[1]).toContain('line-clamp:3');
  });

  it('long image: one part for a normal week, block heights add up, masthead first and footer last', () => {
    const m = must(exportModel(week({ preview: [ev({ startAt: '2026-10-21T01:00:00.000Z' })] }), opts()));
    const parts = longPlan(m);
    expect(parts).toHaveLength(1);
    const [p] = parts;
    expect(p.height).toBe(p.blocks.reduce((a, b) => a + b.height, 0));
    expect(p.blocks.map((b) => b.kind)).toEqual(['masthead', 'day', 'item', 'day', 'item', 'day', 'item', 'preview', 'footer']);
    for (const b of p.blocks) {
      if (b.kind !== 'item') continue;
      expect(b.height).toBeGreaterThanOrEqual(LONG.item.cover + 2 * LONG.item.padY);
      expect(b.lines.title).toBeGreaterThanOrEqual(1);
      expect(b.lines.title).toBeLessThanOrEqual(2);
      expect(b.lines.note).toBeLessThanOrEqual(3);
    }
    expect(longPlan(structuredClone(m))).toEqual(parts); // deterministic
  });

  it('a long week splits between items into parts of at most 9,000 px; every item exactly once, in order', () => {
    const m = must(exportModel(week({ events: many(60) }), opts()));
    const parts = longPlan(m);
    expect(parts.length).toBeGreaterThanOrEqual(2);
    for (const p of parts) {
      expect(p.height).toBeLessThanOrEqual(LONG.maxHeight);
      expect(p.height).toBe(p.blocks.reduce((a, b) => a + b.height, 0));
      expect(p.total).toBe(parts.length);
    }
    const ns = parts.flatMap((p) => p.blocks.flatMap((b) => (b.kind === 'item' ? [b.item.n] : [])));
    expect(ns).toEqual(Array.from({ length: 60 }, (_, i) => i + 1));
    expect(parts[0].blocks[0].kind).toBe('masthead');
    for (const p of parts.slice(1)) {
      expect(p.blocks[0].kind).toBe('header');
      expect(p.blocks[1].kind).toBe('day'); // the day continues (or starts) right under the header
    }
    expect(parts.flatMap((p) => p.blocks).filter((b) => b.kind === 'footer')).toHaveLength(1);
    expect(parts.at(-1)!.blocks.at(-1)!.kind).toBe('footer');
    const cont = parts.slice(1).map((p) => p.blocks[1]);
    expect(cont.some((b) => b.kind === 'day' && b.cont)).toBe(true);
  });

  it('Xiaohongshu: a cover and four items a page, at most nine images; the last page counts what is left', () => {
    const small = xhsPlan(must(exportModel(week(), opts())));
    expect(small.map((p) => p.kind)).toEqual(['cover', 'items']);
    expect(small[0]).toMatchObject({ index: 0, total: 2, categories: [{ category: 'ai', count: 1 }, { category: 'hackathon', count: 1 }, { category: 'vc', count: 1 }] });

    const m = must(exportModel(week({ events: many(40) }), opts({ cancelled: new Set([many(40)[39].id]) })));
    const pages = xhsPlan(m);
    expect(pages).toHaveLength(9);
    expect(pages.every((p) => p.total === 9)).toBe(true);
    const itemPages = pages.filter((p) => p.kind === 'items');
    expect(itemPages.every((p) => p.items.length === XHS.perPage)).toBe(true);
    expect(itemPages.flatMap((p) => p.items.map((it) => it.n))).toEqual(Array.from({ length: 32 }, (_, i) => i + 1));
    expect(itemPages.map((p) => p.more)).toEqual([0, 0, 0, 0, 0, 0, 0, 7]); // 8 left, one of them cancelled
    expect(pages[0].kind === 'cover' && pages[0].categories.reduce((a, c) => a + c.count, 0)).toBe(39);
    expect(xhsPlan(must(exportModel(week({ events: many(32) }), opts()))).at(-1)).toMatchObject({ kind: 'items', more: 0 });
  });

  it('an item at its longest still fits its Xiaohongshu slot', () => {
    const X = XHS;
    const tallest = X.kicker.lh + 2 * X.title.lh + 2 * X.meta.lh + 2 * X.note.lh + 3 * X.gapY;
    expect(tallest + 2 * X.padY).toBeLessThanOrEqual(XHS_SLOT);
    expect(X.head + X.perPage * XHS_SLOT + X.foot).toBe(X.height);
  });
});

describe('Xiaohongshu text: caption, no links', () => {
  it('a title of at most 20 characters, a numbered body of at most 1,000, the fixed hashtags', () => {
    const c = xhsCaption(must(exportModel(week(), opts())));
    expect(c.title).toBe('10月12日这一周｜湾区科技活动精选');
    expect([...c.title].length).toBeLessThanOrEqual(20);
    expect(c.body).toContain('周三晚上 AI Tinkerers 我会去。\n周末有黑客松。');
    expect(c.body).toContain('\n1. [会去] 10月14日周三 18:30–21:00 AI Tinkerers SF: Agents Demo Night\n');
    expect(c.body).toContain('本周 3 场精选 · Victor 会去 1 场\n时间均为北美太平洋时间');
    expect(c.body.endsWith('\n\n无付费植入。\n\n#湾区 #硅谷 #科技活动 #活动推荐')).toBe(true);
  });

  it('a long week is trimmed to 1,000 characters and says how many more there are', () => {
    const long = many(40, (i) => ({ titleZh: `这是一个名字非常非常长的湾区创业者与投资人周末交流活动第 ${i + 1} 场` }));
    const c = xhsCaption(must(exportModel(week({ events: long, introZh: '导语写得比较长。'.repeat(60) }), opts())));
    expect([...c.body].length).toBeLessThanOrEqual(1000);
    expect(c.body).toMatch(/\n还有 \d+ 场\n/);
    expect(c.body.endsWith('#活动推荐')).toBe(true);
  });

  it('urlLike finds schemes, www., domains with a common TLD and "vercel"; ordinary titles pass', () => {
    expect(urlLike('报名 https://x.example.com/a?b=1 现场')).toEqual(['https://x.example.com/a?b=1']);
    expect(urlLike('www.example.org')).toContain('www.example.org');
    expect(urlLike('报名见 lu.ma/abc')).toEqual(['lu.ma/abc']);
    expect(urlLike('victor-picks.vercel.app')).toEqual(['victor-picks.vercel.app']);
    expect(urlLike('Vercel Ship 2026')).toEqual(['Vercel']);
    expect(urlLike('Cursor.ai Meetup')).toEqual(['Cursor.ai']);
    // Generic TLDs event links use.
    expect(urlLike('18:30–21:00 · SoMa · forms.gle')).toEqual(['forms.gle']);
    expect(urlLike('报名见 posh.vip/e/abc')).toEqual(['posh.vip/e/abc']);
    for (const host of ['a16z.capital', 'sf.ventures', 'foo.studio', 'demo.build', 'goo.gle/x']) expect(urlLike(`见 ${host}`)).toEqual([host]);
    for (const ok of ['Next.js Conf', 'Node.js 读书会', 'Dr.Li 分享', 'AI 与技术', 'GPT-4.5 发布会', 'e.g. 早期团队', 'v1.2 Launch', '3.5 小时', 'Ph.D. 学生', '10月14日周三 18:30–21:00']) {
      expect(urlLike(ok)).toEqual([]);
    }
  });

  it('nothing on the Xiaohongshu pages or in the caption looks like a URL; the WeChat image carries the week page', () => {
    // Events from sites platformName() has no name for: their platform is the bare host.
    const hosted = [
      ev({ id: 'evt_hs00000000000001', sourceUrl: 'https://events.stanford.edu/event/x', platform: 'events.stanford.edu', startAt: '2026-10-14T03:00:00.000Z' }),
      ev({ id: 'evt_hs00000000000002', sourceUrl: 'https://forms.gle/abc', platform: 'forms.gle', format: 'online', place: null, startAt: '2026-10-16T03:30:00.000Z' }),
    ];
    const m = must(exportModel(week({ events: [...THREE, ...hosted, ...many(12)], preview: [ev({ startAt: '2026-10-21T01:00:00.000Z' })] }), { origin: 'https://victor-picks.vercel.app', subscribe: true }));
    const [stanford, forms] = hosted.map((e) => must(itemsOf(m).find((it) => it.eventId === e.id)));
    // The WeChat text and long image keep the host (the event can be found by it); Xiaohongshu doesn't.
    expect(stanford.meta).toBe('20:00–21:00 · SoMa · events.stanford.edu');
    expect(stanford.xhsMeta).toBe('20:00–21:00 · SoMa');
    expect(forms.meta.endsWith(' · forms.gle')).toBe(true);
    expect(forms.xhsMeta).not.toContain('forms.gle');
    expect(itemsOf(m)[0].xhsMeta).toBe(itemsOf(m)[0].meta); // a named platform (Luma) stays
    expect(wechatTextOf(m).text).toContain('\n20:00–21:00 · SoMa · events.stanford.edu\n');
    expect(exportWarnings(m).filter((w) => w.startsWith('Looks like a link'))).toEqual([]); // nothing Victor could edit away
    const c = xhsCaption(m);
    for (const s of [...xhsStrings(m), c.title, c.body]) {
      expect(urlLike(s)).toEqual([]);
      expect(s).not.toMatch(/https?:|www\.|vercel|victor-picks|\/zh\//i);
    }
    expect(longPlan(m).at(-1)!.blocks.at(-1)!.kind).toBe('footer');
    expect(imageText(m).mono).toContain('victor-picks.vercel.app/zh/week/2026-W42');
  });

  it('warnings name URL-like text, a split long image and events past the Xiaohongshu cap', () => {
    expect(exportWarnings(must(exportModel(week(), opts())))).toEqual([]);
    const linky = must(exportModel(week({ events: [ev({ titleZh: 'Cursor.ai 线下聚会' })] }), opts()));
    const w = exportWarnings(linky);
    expect(w).toHaveLength(1);
    expect(w[0]).toContain('「Cursor.ai」');
    expect(w[0]).toContain('1. Cursor.ai 线下聚会');
    const big = exportWarnings(must(exportModel(week({ events: many(60) }), opts())));
    expect(big.some((x) => /comes in \d parts · 本周较长，长图分成 \d 张/.test(x))).toBe(true);
    expect(big.some((x) => x.includes('first 32 of 60'))).toBe(true);
  });
});

describe('exportHash and image names', () => {
  it('stable for the same content; changes with a note, the kind, and (WeChat only) the covers switch', () => {
    const m = must(exportModel(week(), opts()));
    const v = exportHash(m, 'wechat');
    expect(v).toMatch(/^[\w-]{16}$/);
    expect(exportHash(structuredClone(m), 'wechat')).toBe(v);
    const edited = must(exportModel(week({ events: [{ ...THREE[0], noteZh: '改过的点评' }, THREE[1], THREE[2]] }), opts()));
    expect(exportHash(edited, 'wechat')).not.toBe(v);
    expect(exportHash(m, 'xhs')).not.toBe(v);
    expect(exportHash(m, 'wechat', true)).not.toBe(v);
    expect(exportHash(m, 'xhs', true)).toBe(exportHash(m, 'xhs'));
  });

  it('wechat-1…9 and xhs-0…8 only', () => {
    expect(parseImageName('wechat-1')).toEqual({ kind: 'wechat', index: 1 });
    expect(parseImageName('xhs-0')).toEqual({ kind: 'xhs', index: 0 });
    expect(parseImageName('xhs-8')).toEqual({ kind: 'xhs', index: 8 });
    for (const bad of ['wechat-0', 'wechat-10', 'xhs-9', 'xhs-1.png', 'WECHAT-1', 'wechat', '', '../xhs-1']) expect(parseImageName(bad)).toBeNull();
  });
});

// ---- fonts ------------------------------------------------------------------------------------

describe('textFonts: chunked Google Fonts requests', () => {
  const FONT = new Uint8Array(1234).buffer;
  /** A CSS answer whose font URL names the family (NotoSerifSC-0.ttf), so a test can pick one file. */
  const css = (family: string, n = 1) =>
    Array.from({ length: n }, (_, i) => `@font-face { src: url(https://fonts.gstatic.com/s/x/${family}-${i}.ttf) format('truetype'); }`).join('\n');
  /** Google Fonts stand-in; `over` may answer a request itself. Returns every URL fetched. */
  function stubFetch(over: (url: URL) => Response | null = () => null) {
    const calls: URL[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL) => {
        const url = new URL(String(input));
        calls.push(url);
        const answer = over(url);
        if (answer) return answer;
        if (url.hostname !== 'fonts.googleapis.com') return new Response(FONT);
        return new Response(css(url.searchParams.get('family')!.split(':')[0].replace(/\W/g, '')));
      }),
    );
    return calls;
  }
  beforeEach(() => _resetTextFonts());

  it('chunks are distinct sorted characters, at most 400 each, without line breaks', () => {
    const text = Array.from({ length: 1000 }, (_, i) => String.fromCodePoint(0x4e00 + i)).join('') + '\n\t一一';
    const chunks = chunkChars(text);
    expect(chunks.map((c) => [...c].length)).toEqual([400, 400, 200]);
    const all = chunks.flatMap((c) => [...c]);
    expect(new Set(all).size).toBe(1000);
    expect(all).toEqual([...all].sort());
    expect(all.join('')).not.toMatch(/[\n\t]/);
  });

  it('one font per chunk, named in order, every text= request at most 400 characters', async () => {
    const calls = stubFetch();
    const serif = Array.from({ length: 700 }, (_, i) => String.fromCodePoint(0x4e00 + i)).join('');
    const f = await textFonts({ serif, sans: '早期融资', mono: '2026-W42 会' });
    expect(f.complete).toBe(true);
    expect(f.fonts.map((x) => x.name)).toEqual(['Noto Serif SC 1', 'Noto Serif SC 2', 'Noto Sans SC 1', 'Geist Mono 1']);
    expect(f.fonts.map((x) => x.weight)).toEqual([600, 600, 400, 500]);
    expect(f.family).toEqual({
      serif: 'Noto Serif SC 1, Noto Serif SC 2, Noto Sans SC 1',
      sans: 'Noto Sans SC 1',
      mono: 'Geist Mono 1, Noto Sans SC 1',
    });
    const texts = calls.filter((u) => u.hostname === 'fonts.googleapis.com').map((u) => u.searchParams.get('text')!);
    expect(texts).toHaveLength(4);
    for (const t of texts) expect([...t].length).toBeLessThanOrEqual(TEXT_CHUNK);
    expect(texts.some((t) => t.includes('…'))).toBe(true); // the line-clamp ellipsis is always there
    expect(texts.at(-1)).not.toMatch(/会/); // Geist Mono gets ASCII only
    expect(calls.filter((u) => u.hostname === 'fonts.gstatic.com')).toHaveLength(4);
  });

  it('a font file over 2 MB is refused, by its declared length or its actual bytes', async () => {
    for (const big of [
      () => new Response(FONT, { headers: { 'content-length': String(FONT_MAX_BYTES + 1) } }),
      () => new Response(new ReadableStream({ start(c) { c.enqueue(new Uint8Array(FONT_MAX_BYTES)); c.enqueue(new Uint8Array(10)); c.close(); } })),
    ]) {
      _resetTextFonts();
      stubFetch((url) => (url.pathname.includes('NotoSerifSC') ? big() : null));
      const f = await textFonts({ serif: '标题', sans: '正文', mono: '42' });
      expect(f.complete).toBe(false);
      expect(f.fonts.map((x) => x.name)).toEqual(['Noto Sans SC 1', 'Geist Mono 1']);
    }
  });

  it('a failed or ignored chunk makes it incomplete, and is fetched again next time', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    let fail = true;
    stubFetch((url) => (fail && url.searchParams.get('family')?.startsWith('Noto Sans') ? new Response('', { status: 500 }) : null));
    expect((await textFonts({ serif: '标题', sans: '正文', mono: '' })).complete).toBe(false);
    fail = false;
    const again = await textFonts({ serif: '标题', sans: '正文', mono: '' });
    expect(again.complete).toBe(true);
    expect(again.family.mono).toBe('Noto Sans SC 1'); // nothing for Geist Mono: digits fall back to sans

    _resetTextFonts();
    // Several faces in the CSS means Google ignored text= (unicode-range slices of the full font).
    stubFetch((url) => (url.hostname === 'fonts.googleapis.com' ? new Response(css('x', 3)) : null));
    expect((await textFonts({ serif: '标题', sans: '', mono: '' })).complete).toBe(false);
  });
});

// ---- covers -----------------------------------------------------------------------------------

describe('coverImages: real covers as JPEG data URLs, everything else the template', () => {
  const BLOB = 'https://abc123.public.blob.vercel-storage.com/covers/';
  const db = () => h.db as DB;
  const webp = () => sharp({ create: { width: 640, height: 480, channels: 3, background: '#336699' } }).webp().toBuffer();
  async function cover(id: string, kind: 'official' | 'host_composite' | 'template' | 'upload', url400 = `${BLOB}${id}-400.webp`) {
    await db().insert(covers).values({ id, kind, url1600: url400, url800: url400, url400, urlOgEn: '', urlOgZh: '', thumbhash: '', dominant: '', bytes: 1 });
  }
  const items = (...ids: (string | null)[]) => ids.map((coverId, i) => ({ eventId: `evt_${i}`, coverId }));

  beforeEach(async () => {
    h.db = (await testDb()).db;
    h.fetched = [];
    h.fetchBytes = () => webp();
  });

  it('WeChat: an official Blob cover becomes a 400² JPEG; template, missing and foreign rows are the template', async () => {
    await cover('cov_official', 'official');
    await cover('cov_template', 'template', 'https://picks.test/og/template/ai?s=400');
    await cover('cov_foreign', 'upload', 'https://evil.example.com/x.webp');
    const r = await coverImages(items('cov_official', 'cov_template', 'cov_missing', 'cov_foreign', null), { kind: 'wechat', allToTemplate: false });
    expect(r.degraded).toBe(false);
    expect(h.fetched).toEqual([`${BLOB}cov_official-400.webp`]);
    const src = r.images.get('evt_0')!;
    expect(src).toMatch(/^data:image\/jpeg;base64,/);
    const meta = await sharp(Buffer.from(src.split(',')[1], 'base64')).metadata();
    expect([meta.format, meta.width, meta.height]).toEqual(['jpeg', 400, 400]);
    expect([...r.images.entries()].slice(1).map(([, v]) => v)).toEqual([null, null, null, null]);
  });

  it('Xiaohongshu never fetches a cover', async () => {
    await cover('cov_official', 'official');
    const r = await coverImages(items('cov_official'), { kind: 'xhs', allToTemplate: false });
    expect(r.images.get('evt_0')).toBeNull();
    expect(h.fetched).toEqual([]);
  });

  it('the official-covers switch, turned on after the freeze, sends official covers back to the template', async () => {
    await cover('cov_official', 'official');
    await cover('cov_hosts', 'host_composite');
    await cover('cov_upload', 'upload');
    const r = await coverImages(items('cov_official', 'cov_hosts', 'cov_upload'), { kind: 'wechat', allToTemplate: true });
    expect([r.images.get('evt_0'), r.images.get('evt_1')]).toEqual([null, null]);
    expect(r.images.get('evt_2')).toMatch(/^data:image\/jpeg/);
  });

  it('a failed fetch or decode, or the time budget, falls back to the template and marks the result degraded', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    await cover('cov_a', 'official');
    await cover('cov_b', 'official');
    h.fetchBytes = async (url) => (url.includes('cov_a') ? Promise.reject(new Error('HTTP 404')) : Buffer.from('not an image'));
    const r = await coverImages(items('cov_a', 'cov_b'), { kind: 'wechat', allToTemplate: false });
    expect(r).toEqual({ images: new Map([['evt_0', null], ['evt_1', null]]), degraded: true });

    h.fetchBytes = () => new Promise(() => {}); // never answers
    const slow = await coverImages(items('cov_a'), { kind: 'wechat', allToTemplate: false, budgetMs: 30 });
    expect(slow).toEqual({ images: new Map([['evt_0', null]]), degraded: true });
  });
});

describe('fitBytes: under Vercel\'s 4.5 MB response limit', () => {
  it('keeps a small PNG and re-encodes a large one as JPEG', async () => {
    const png = await sharp({ create: { width: 300, height: 300, channels: 3, background: '#808080', noise: { type: 'gaussian', mean: 128, sigma: 60 } } }).png().toBuffer();
    expect(await fitBytes(png)).toEqual({ body: png, type: 'image/png' });
    const small = await fitBytes(png, 1000);
    expect(small.type).toBe('image/jpeg');
    expect([...small.body.subarray(0, 3)]).toEqual([0xff, 0xd8, 0xff]);
  });
});

// ---- panel markup -----------------------------------------------------------------------------

describe('SocialExport markup', () => {
  type Props = Parameters<typeof SocialExport>[0];
  const props = (over: Partial<Props> = {}): Props => ({
    week: '2026-W42', draft: false, introDrafted: false, error: null,
    wechat: { parts: 2, v: 'wv0000000000000a' },
    xhs: { pages: 3, v: 'xv0000000000000b', caption: { title: '10月12日这一周｜湾区科技活动精选', body: '本周 3 场精选 & 更多\n#湾区' } },
    warnings: [], ...over,
  });
  const html = (p: Props) => renderToStaticMarkup(createElement(SocialExport, p));

  it('two build buttons as phone-sized targets; Save appears only once the images are built', () => {
    const out = html(props());
    expect(out).toContain('Long image &amp; Xiaohongshu · 长图与小红书');
    expect(out).toMatch(/<button type="button" class="[^"]*\bh-11\b[^"]*">生成长图 · Build image<\/button>/);
    expect(out).toMatch(/<button type="button" class="[^"]*\bh-11\b[^"]*">小红书 · Build<\/button>/);
    expect(out).not.toContain('保存/分享');
    expect(out).not.toContain('<img');
    expect(out).toContain('勾选「原图」');
  });

  it('download links for every image, carrying the fingerprint; the desktop fallback needs no script', () => {
    const out = html(props());
    const links = [...out.matchAll(/<a href="([^"]+)" download=""[^>]*>([^<]+)<\/a>/g)].map((m) => [m[1], m[2]]);
    expect(links).toEqual([
      ['/admin/digest/image/2026-W42/wechat-1?v=wv0000000000000a', '长图 1/2'],
      ['/admin/digest/image/2026-W42/wechat-2?v=wv0000000000000a', '长图 2/2'],
      ['/admin/digest/image/2026-W42/xhs-0?v=xv0000000000000b', '封面 1/3'],
      ['/admin/digest/image/2026-W42/xhs-1?v=xv0000000000000b', '2/3'],
      ['/admin/digest/image/2026-W42/xhs-2?v=xv0000000000000b', '3/3'],
    ]);
    expect(out.match(/<a [^>]*class="[^"]*\bmin-h-11\b/g)).toHaveLength(5);
  });

  it('the caption in a read-only textarea with its lengths', () => {
    const out = html(props());
    expect(out).toMatch(/<textarea[^>]*readOnly=""[^>]*>10月12日这一周｜湾区科技活动精选\n\n本周 3 场精选 &amp; 更多\n#湾区<\/textarea>/i);
    expect(out).toContain('Title 18/20 · body 17/1000');
  });

  it('a status line per panel, always in the page and announced politely, empty before any build', () => {
    const out = html(props());
    expect(out.match(/<p role="status" aria-live="polite" class="min-h-5 text-sm text-muted"><\/p>/g)).toHaveLength(2);
    expect(statusLine(undefined, 2)).toBeNull();
    expect(statusLine({ v: 'x', state: 'building' }, 3)).toEqual({ text: 'Building 3 images… · 正在生成 3 张…', alert: false });
    expect(statusLine({ v: 'x', state: 'ready' }, 1)).toEqual({ text: 'Ready: tap Save · 已生成，点「保存」', alert: false });
    expect(statusLine({ v: 'x', state: 'stale' }, 1)).toEqual({ text: 'Page is out of date; reload so text and images match · 内容已更新，请刷新页面', alert: true });
    expect(statusLine({ v: 'x', state: 'error', message: 'Signed out; reload and sign in · 登录已过期，请刷新后登录' }, 1)?.alert).toBe(true);
  });

  it('Save takes focus when the build is ready only if focus fell to the page', () => {
    const body = {} as HTMLElement;
    const save = { focus: vi.fn() };
    focusIfDropped(save, { activeElement: body, body });
    focusIfDropped(save, { activeElement: null, body });
    expect(save.focus).toHaveBeenCalledTimes(2);
    focusIfDropped(save, { activeElement: {} as Element, body }); // the admin moved on: leave focus alone
    focusIfDropped(null, { activeElement: body, body });
    expect(save.focus).toHaveBeenCalledTimes(2);
  });

  it('imageProblem: a sign-in page, a stale page and a missing part are never saved as images', () => {
    const res = (status: number, headers: Record<string, string> = {}, over: Partial<Pick<Response, 'redirected' | 'type'>> = {}) =>
      ({ ok: status >= 200 && status < 300, status, redirected: false, type: 'basic', headers: new Headers(headers), ...over }) as Response;
    const png = { 'content-type': 'image/png', 'x-export-v': 'v1' };
    expect(imageProblem(res(200, png), 'v1')).toBeNull();
    expect(imageProblem(res(200, { ...png, 'content-type': 'image/jpeg' }), 'v1')).toBeNull();
    // proxy.ts redirects a browser without the session cookie to /admin/sign-in (200 HTML when followed).
    expect(imageProblem(res(0, {}, { type: 'opaqueredirect' }), 'v1')).toBe('signed-out');
    expect(imageProblem(res(200, { 'content-type': 'text/html; charset=utf-8' }, { redirected: true }), 'v1')).toBe('signed-out');
    expect(imageProblem(res(200, { 'content-type': 'text/html; charset=utf-8', 'x-export-v': 'v1' }), 'v1')).toBe('signed-out');
    expect(imageProblem(res(401), 'v1')).toBe('signed-out');
    expect(imageProblem(res(503), 'v1')).toBe('fonts');
    // The route draws what the issue shows now; the page's text is older.
    expect(imageProblem(res(200, { ...png, 'x-export-v': 'v2' }), 'v1')).toBe('stale');
    expect(imageProblem(res(200, { 'content-type': 'image/png' }), 'v1')).toBe('stale');
    expect(imageProblem(res(404), 'v1')).toBe('stale'); // fewer parts now
    expect(imageProblem(res(500), 'v1')).toBe('HTTP 500');
  });

  it('draft, AI-intro and export warnings are listed; no picks or an error replace the panel', () => {
    const out = html(props({ draft: true, introDrafted: true, warnings: ['Looks like a link: 「Cursor.ai」'] }));
    expect(out).toContain('草稿：内容还可能改');
    expect(out).toContain('中文开场白还是没确认的 AI 草稿');
    expect(out).toContain('Looks like a link: 「Cursor.ai」');
    const none = html(props({ wechat: null, xhs: null }));
    expect(none).toContain('本周没有精选，无需导出');
    expect(none).not.toContain('<button');
    const err = html(props({ error: 'assembly failed: boom', wechat: null, xhs: null }));
    expect(err).toContain('role="alert"');
    expect(err).toContain('assembly failed: boom');
  });
});
