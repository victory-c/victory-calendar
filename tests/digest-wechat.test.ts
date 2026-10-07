import { describe, expect, it } from 'vitest';
import { type LiveRow, liveState, wechatText } from '@/lib/digest/wechat';
import type { DigestEvent } from '@/lib/digest/types';
import { CATEGORY_SLUGS } from '@/lib/taxonomy';
import { ev, O, snap } from './helpers/digest-fixtures';

// WeChat text export (M3 week 15, F17 "微信文字"): one Chinese plain text per issue for WeChat
// groups. Pure, so no mocks: a snapshot in, the text out.

const ORIGIN = 'https://victor-picks.example.app';
const opts = (subscribe = false) => ({ origin: ORIGIN, subscribe });
const must = (t: ReturnType<typeof wechatText>) => {
  if (!t) throw new Error('expected a text');
  return t;
};
const lines = (text: string) => text.split('\n');

// 2026-W42: Wed 18:30 in person (going), Thu 17:00 online (zh title + official English title),
// Sat 9:00 – Sun 17:00 hackathon.
const THREE: DigestEvent[] = [
  ev({
    id: 'evt_wc00000000000001', category: 'ai', startAt: '2026-10-15T01:30:00.000Z', endAt: '2026-10-15T04:00:00.000Z',
    titleEn: 'AI Tinkerers SF: Agents Demo Night', titleZh: 'AI Tinkerers SF: Agents Demo Night', place: 'SoMa', priceText: 'Free',
    access: 'apply', seal: 'going', platform: 'Luma', noteZh: '上次 demo 质量很高，名额少，早点申请。', noteEn: 'Strong demos last time.',
  }),
  ev({
    id: 'evt_wc00000000000002', category: 'vc', startAt: '2026-10-16T00:00:00.000Z', endAt: '2026-10-16T01:00:00.000Z', format: 'online',
    place: null, titleEn: 'Early-Stage Fundraising AMA', titleZh: '早期融资 AMA：怎么拿到第一张 term sheet', platform: 'Luma',
    noteZh: '适合还没融过钱的团队，可以匿名提问。',
  }),
  ev({
    id: 'evt_wc00000000000003', category: 'hackathon', startAt: '2026-10-17T16:00:00.000Z', endAt: '2026-10-19T00:00:00.000Z',
    titleEn: 'Berkeley AI Hackathon', titleZh: 'Berkeley AI Hackathon', place: 'Berkeley', priceText: 'Free', access: 'waitlist',
    platform: 'Partiful',
  }),
];
const week = (over: Parameters<typeof snap>[0] = {}) =>
  snap({ events: THREE, introZh: '周三晚上 AI Tinkerers 我会去，现场聊。\n周末伯克利有黑客松，学生免费，名额紧。', ...over });

describe('wechatText', () => {
  it('numbers the picks by start, grouped by Pacific day, with one public link at the end', () => {
    const t = must(wechatText(week(), opts()));
    expect(t.text).toMatchInlineSnapshot(`
      "Victor 精选 · 10月12日 这一周
      本周 3 场精选 · Victor 会去 1 场

      周三晚上 AI Tinkerers 我会去，现场聊。
      周末伯克利有黑客松，学生免费，名额紧。

      时间均为北美太平洋时间

      【10月14日周三】
      1. [会去] AI Tinkerers SF: Agents Demo Night
      18:30–21:00 · SoMa · 免费 · 需申请 · Luma
      上次 demo 质量很高，名额少，早点申请。

      【10月15日周四】
      2. 早期融资 AMA：怎么拿到第一张 term sheet
      Early-Stage Fundraising AMA
      17:00–18:00 · 线上 · 10月16日周五 8:00 北京时间 · Luma
      适合还没融过钱的团队，可以匿名提问。

      【10月17日周六】
      3. Berkeley AI Hackathon
      9:00 – 10月18日周日 17:00 · Berkeley · 免费 · 候补 · Partiful

      完整列表、报名和加入日历：
      https://victor-picks.example.app/zh/week/2026-W42

      无付费植入。"
    `);
    expect(t).toMatchObject({ picks: 3, going: 1, chars: [...t.text].length });
  });

  it('adds the subscribe link only while the newsletter is open, right before the footer line', () => {
    const closed = must(wechatText(week(), opts(false))).text;
    const open = must(wechatText(week(), opts(true))).text;
    expect(closed).not.toContain('/subscribe');
    expect(open.endsWith(`\n\n每周日收邮件版（可只选关心的类别）：\n${ORIGIN}/zh/subscribe\n\n无付费植入。`)).toBe(true);
  });

  it('every URL is https, alone on its line; one link, two with subscribe', () => {
    for (const [subscribe, count] of [[false, 1], [true, 2]] as const) {
      const text = must(wechatText(week({ preview: [ev({ startAt: '2026-10-21T01:00:00.000Z', featured: true })] }), opts(subscribe))).text;
      const urls = text.match(/https?:\/\/\S+/g) ?? [];
      expect(urls).toHaveLength(count);
      for (const url of urls) {
        expect(url.startsWith(`${ORIGIN}/zh/`)).toBe(true);
        expect(lines(text)).toContain(url); // nothing before or after it on the line
      }
    }
  });

  it('uses the origin it is given, not the one frozen in the snapshot; a trailing slash is dropped', () => {
    const text = must(wechatText(week(), { origin: `${ORIGIN}/`, subscribe: true })).text;
    expect(text).not.toContain(O);
    expect(text).toContain(`\n${ORIGIN}/zh/week/2026-W42\n`);
    expect(text).not.toContain('//zh');
  });

  it('carries no per-reader or per-event link: no token, preferences, unsubscribe or RSVP URL', () => {
    const text = must(wechatText(week({ events: [...THREE, ev({ sourceUrl: 'https://luma.com/secret-rsvp' })] }), opts(true))).text;
    for (const s of ['__VP_TOKEN__', '/prefs', '/unsubscribe', 'sub_', 'luma.com', 'partiful.com', '/events/', '/og/']) {
      expect(text).not.toContain(s);
    }
  });

  it('adds no emoji and no Markdown', () => {
    const text = must(wechatText(week({ preview: [ev({ startAt: '2026-10-21T01:00:00.000Z' })] }), opts(true))).text;
    expect(text).not.toMatch(/\p{Extended_Pictographic}/u);
    expect(text).not.toMatch(/\*\*|^#|^- |\[[^\]]*\]\(/m);
  });

  it('is deterministic', () => {
    const s = week();
    expect(wechatText(s, opts(true))).toEqual(wechatText(structuredClone(s), opts(true)));
  });

  it('is null when the week has no picks', () => {
    expect(wechatText(snap(), opts())).toBeNull();
    // Outside the covered week or of an unknown category: not picks either.
    const odd = [ev({ startAt: '2026-10-19T07:00:00.000Z' }), ev({ category: 'gaming' as DigestEvent['category'] })];
    expect(wechatText(snap({ events: odd, preview: [ev({ startAt: '2026-10-21T01:00:00.000Z' })] }), opts(true))).toBeNull();
  });

  it('refuses a snapshot version it does not know', () => {
    expect(() => wechatText({ ...week(), version: 2 } as unknown as ReturnType<typeof snap>, opts())).toThrow(/version/);
  });

  it('with attendance off: no seal label and no going count', () => {
    const t = must(wechatText(week({ showAttendance: false }), opts()));
    expect(t.going).toBe(0);
    expect(t.text).not.toContain('[会去]');
    expect(lines(t.text)[1]).toBe('本周 3 场精选');
    expect(t.text).toContain('\n1. AI Tinkerers SF: Agents Demo Night\n');
  });

  it('hosting and speaking seals carry their own labels', () => {
    const text = must(wechatText(snap({ events: [ev({ seal: 'hosting', titleZh: '黑客松' }), ev({ seal: 'speaking', titleZh: '分享会', startAt: '2026-10-15T01:30:00.000Z' })] }), opts())).text;
    expect(text).toContain('\n1. [主办] 黑客松\n');
    expect(text).toContain('\n2. [分享] 分享会\n');
    expect(lines(text)[1]).toBe('本周 2 场精选 · Victor 会去 2 场');
  });

  it('numbers across categories in start order, not by section', () => {
    const text = must(wechatText(snap({
      events: [
        ev({ category: 'ai', titleZh: '周四 AI', startAt: '2026-10-16T01:00:00.000Z' }),
        ev({ category: 'cycling', titleZh: '周一骑行', startAt: '2026-10-12T15:00:00.000Z' }),
        ev({ category: 'social', titleZh: '周四早些的聚会', startAt: '2026-10-15T20:00:00.000Z' }),
      ],
    }), opts())).text;
    const numbered = lines(text).filter((l) => /^\d+\. /.test(l));
    expect(numbered).toEqual(['1. 周一骑行', '2. 周四早些的聚会', '3. 周四 AI']);
    expect(text.match(/【10月15日周四】/g)).toHaveLength(1); // one header for the two Thursday events
  });

  it('Beijing time for online and hybrid events only, never for all-day ones', () => {
    const text = must(wechatText(snap({
      events: [
        ev({ titleZh: '线下', format: 'in_person' }),
        ev({ titleZh: '线上线下', format: 'hybrid', place: 'Palo Alto', startAt: '2026-10-15T01:30:00.000Z', endAt: null }),
        ev({ titleZh: '线上全天', format: 'online', place: null, allDay: true, startAt: '2026-10-16T07:00:00.000Z', endAt: '2026-10-17T07:00:00.000Z' }),
      ],
    }), opts())).text;
    expect(text.match(/北京时间/g)).toHaveLength(1);
    expect(text).toContain('\n18:30 · Palo Alto · 线上线下 · 10月15日周四 9:30 北京时间 · Luma\n');
    expect(text).toContain('\n全天 · 线上 · Luma\n');
  });

  it('times: same day, no end, across days, all day, several all days', () => {
    const text = must(wechatText(snap({
      events: [
        ev({ titleZh: 'A', startAt: '2026-10-13T16:00:00.000Z', endAt: '2026-10-13T18:30:00.000Z' }),
        ev({ titleZh: 'B', startAt: '2026-10-14T02:00:00.000Z', endAt: null }),
        ev({ titleZh: 'C', startAt: '2026-10-15T23:00:00.000Z', endAt: '2026-10-16T17:00:00.000Z' }),
        ev({ titleZh: 'D', allDay: true, startAt: '2026-10-16T07:00:00.000Z', endAt: '2026-10-17T07:00:00.000Z' }),
        ev({ titleZh: 'E', allDay: true, startAt: '2026-10-17T07:00:00.000Z', endAt: '2026-10-19T07:00:00.000Z' }),
      ],
    }), opts())).text;
    const meta = (title: string) => lines(text)[lines(text).findIndex((l) => l.endsWith(`. ${title}`)) + 2];
    expect(meta('A')).toBe('9:00–11:30 · SoMa · Luma');
    expect(meta('B')).toBe('19:00 · SoMa · Luma');
    expect(meta('C')).toBe('16:00 – 10月16日周五 10:00 · SoMa · Luma');
    expect(meta('D')).toBe('全天 · SoMa · Luma');
    expect(meta('E')).toBe('全天 · 10月17日周六–10月18日周日 · SoMa · Luma');
  });

  it('the official title only when it differs after normalising; long ones clipped', () => {
    const text = must(wechatText(snap({
      events: [
        ev({ titleZh: 'Evals in Practice', titleEn: 'Evals in practice!' }),
        ev({ titleZh: '', titleEn: 'English Only Title' }),
        ev({ titleZh: '很长的活动', titleEn: 'Word '.repeat(40).trim(), startAt: '2026-10-15T01:30:00.000Z' }),
      ],
    }), opts())).text;
    expect(text).not.toContain('Evals in practice!');
    expect(text).toContain('\n2. English Only Title\n18:30–21:00');
    const clipped = lines(text)[lines(text).indexOf('3. 很长的活动') + 1];
    expect(clipped.endsWith('…')).toBe(true);
    expect([...clipped].length).toBeLessThanOrEqual(121);
  });

  it('the note in Chinese, else the English one; clipped like the email', () => {
    const text = must(wechatText(snap({
      events: [
        ev({ titleZh: '中文点评', noteZh: '值得去。'.repeat(40), noteEn: 'English note' }),
        ev({ titleZh: '英文点评', noteZh: null, noteEn: 'Go for the panel.', startAt: '2026-10-15T01:30:00.000Z' }),
      ],
    }), opts())).text;
    const zh = lines(text).find((l) => l.startsWith('值得去。'))!;
    expect(zh.endsWith('…')).toBe(true);
    expect([...zh].length).toBeLessThanOrEqual(81);
    expect(text).not.toContain('English note');
    expect(text).toContain('\nGo for the panel.\n');
  });

  it('never prints the English intro, a street address or a cover credit', () => {
    const text = must(wechatText(week({ introZh: null, events: [ev({ coverCredit: 'Cover: Host via Luma', place: 'SoMa' })] }), opts())).text;
    expect(text).not.toContain('A heavy AI week');
    expect(text).not.toContain('Cover:');
    expect(lines(text).slice(2, 5)).toEqual(['', '时间均为北美太平洋时间', '']);
  });

  it('lists the featured events of next week by day', () => {
    const preview = [
      ev({ titleEn: 'Founders Dinner', titleZh: 'Founders Dinner', startAt: '2026-10-21T02:00:00.000Z', featured: true }),
      ev({ titleEn: 'Board Game Night', titleZh: '桌游夜', category: 'social', startAt: '2026-10-24T02:00:00.000Z', featured: true }),
    ];
    const text = must(wechatText(week({ preview }), opts())).text;
    expect(text).toContain('\n\n【下周预告】\n· Founders Dinner · 10月20日周二\n· 桌游夜 · 10月23日周五\n\n完整列表、报名和加入日历：\n');
  });

  it('a busy 30-event week stays under 4,000 characters, numbered 1 to 30; clipping bounds the worst case', () => {
    // A typical week: short titles, the official title on every other event, a one-line note on two in three.
    const at = (i: number, h = 0) => new Date(Date.parse('2026-10-12T16:00:00.000Z') + (i * 5 + h) * 3600_000).toISOString();
    const typical = Array.from({ length: 30 }, (_, i) =>
      ev({
        category: CATEGORY_SLUGS[i % CATEGORY_SLUGS.length], startAt: at(i), endAt: at(i, 2),
        titleZh: `湾区创业者交流会 ${i + 1}`, titleEn: i % 2 ? `Bay Area Founders Mixer ${i + 1}` : `湾区创业者交流会 ${i + 1}`,
        noteZh: i % 3 ? '人不多，适合认识早期团队。' : null, priceText: i % 4 ? 'Free' : '$20', access: i % 5 ? 'open' : 'apply',
        format: i % 6 ? 'in_person' : 'online', place: i % 6 ? 'Palo Alto' : null,
      }),
    );
    const t = must(wechatText(week({ events: typical }), opts(true)));
    expect(t.picks).toBe(30);
    expect(t.chars).toBeLessThan(4000);
    expect(lines(t.text).filter((l) => /^\d+\. /.test(l)).map((l) => Number(l.split('.')[0]))).toEqual(Array.from({ length: 30 }, (_, i) => i + 1));

    // Every event at the limits (long official title and note, both clipped) and a full 600-character intro.
    const maximal = typical.map((e) => ({ ...e, titleEn: 'Founders Evening '.repeat(12), noteZh: '值得去的理由写在这里。'.repeat(12), noteEn: null }));
    const worst = must(wechatText(week({ events: maximal, introZh: '一行写得比较长的导语。'.repeat(54) }), opts(true)));
    expect(worst.chars).toBeLessThan(10_000); // the one per-message figure found for WeChat
  });
});

describe('liveState: a frozen issue against the live rows (the archive\'s rules)', () => {
  // Sunday evening after the send; the Wednesday event is still ahead.
  const NOW = new Date('2026-10-12T02:00:00.000Z');
  /** The event's current row as publicEvents() returns it: unchanged unless overridden. */
  const row = (e: DigestEvent, over: Partial<LiveRow> = {}): LiveRow => ({
    id: e.id, status: 'published', going: e.seal ?? 'none', goingVisibility: 'public', category: e.category, format: e.format,
    privateVenue: false, sourceUrl: e.sourceUrl, startAt: new Date(e.startAt), endAt: e.endAt ? new Date(e.endAt) : null, ...over,
  });
  const PREVIEW = ev({ id: 'evt_wc00000000000009', titleZh: '下周路演日', startAt: '2026-10-21T01:00:00.000Z', featured: true });
  const frozen = week({ preview: [PREVIEW] });
  const rows = (over: Record<string, Partial<LiveRow> | null> = {}) =>
    [...THREE, PREVIEW].flatMap((e) => (over[e.id] === null ? [] : [row(e, over[e.id] ?? {})]));
  const text = (live: LiveRow[], show = true, s = frozen, now = NOW) => {
    const cur = liveState(s, live, now, show);
    return wechatText(cur.snap, { ...opts(), cancelled: cur.cancelled });
  };
  const [AI, VC, HACK] = THREE;

  it('nothing changed: the same text as the snapshot alone', () => {
    const cur = liveState(frozen, rows(), NOW, true);
    expect(cur.cancelled.size).toBe(0);
    expect(cur.snap.events).toEqual(frozen.events);
    expect(text(rows())).toEqual(wechatText(frozen, opts()));
  });

  it('kill switch off now: no seal label and no going count, whatever the snapshot holds', () => {
    const t = must(text(rows(), false));
    expect(t.text).not.toContain('[会去]');
    expect(lines(t.text)[1]).toBe('本周 3 场精选');
    expect(t.going).toBe(0);
    const cur = liveState(frozen, rows(), NOW, false);
    expect(cur.snap.showAttendance).toBe(false);
    expect(cur.snap.events.every((e) => e.seal === null)).toBe(true);
  });

  it('attendance off in the snapshot stays off when the switch is back on', () => {
    expect(liveState(week({ showAttendance: false }), rows(), NOW, true).snap.showAttendance).toBe(false);
  });

  it('an event unpublished since (no live row) is left out and the rest renumbered', () => {
    const t = must(text(rows({ [AI.id]: null, [PREVIEW.id]: null })));
    expect(t.text).not.toContain('Agents Demo Night'); // the intro, Victor's own words, may still mention it
    expect(t.text).not.toContain('下周路演日');
    expect(t.text).not.toContain('【下周预告】');
    expect(lines(t.text).filter((l) => /^\d+\. /.test(l))).toEqual(['1. 早期融资 AMA：怎么拿到第一张 term sheet', '2. Berkeley AI Hackathon']);
    expect(t).toMatchObject({ picks: 2, going: 0 });
  });

  it('a cancelled event stays in place, unnumbered and marked, with no seal or note; it is not a pick', () => {
    const t = must(text(rows({ [AI.id]: { status: 'cancelled' }, [PREVIEW.id]: { status: 'cancelled' } })));
    expect(lines(t.text)[1]).toBe('本周 2 场精选');
    expect(t).toMatchObject({ picks: 2, going: 0 });
    expect(t.text).toContain('\n【10月14日周三】\n[已取消] AI Tinkerers SF: Agents Demo Night\n18:30–21:00 · SoMa · 免费 · 需申请 · Luma\n\n');
    expect(t.text).not.toContain('[会去]');
    expect(t.text).not.toContain('上次 demo 质量很高');
    expect(t.text).toContain('\n1. 早期融资 AMA');
    expect(t.text).toContain('\n2. Berkeley AI Hackathon');
    expect(t.text).toContain('\n【下周预告】\n· [已取消] 下周路演日 · 10月20日周二\n');
  });

  it('every pick cancelled or taken down: nothing to post', () => {
    expect(text(rows({ [AI.id]: { status: 'cancelled' }, [VC.id]: null, [HACK.id]: { status: 'cancelled' } }))).toBeNull();
  });

  it('a seal stays only while publicGoing() on the live row still shows one', () => {
    const sealed = (over: Partial<LiveRow>, now = NOW) => must(text(rows({ [AI.id]: over }), true, frozen, now)).text;
    expect(sealed({ goingVisibility: 'hidden' })).not.toContain('[会去]');
    expect(sealed({ goingVisibility: 'after_event' })).not.toContain('[会去]');
    expect(sealed({ going: 'interested' })).not.toContain('[会去]');
    expect(sealed({ going: 'none' })).not.toContain('Victor 会去');
    expect(sealed({ category: 'cycling' })).not.toContain('[会去]');
    expect(sealed({ sourceUrl: 'https://example.com/rsvp' })).not.toContain('[会去]'); // auto after_event: not a listed platform
    // The live kind wins (going → hosting); after the event the snapshot's (a digest has no "went").
    expect(sealed({ going: 'hosting' })).toContain('\n1. [主办] AI Tinkerers');
    expect(sealed({}, new Date('2026-10-16T00:00:00.000Z'))).toContain('\n1. [会去] AI Tinkerers');
  });

  it('only narrows: an event with no seal in the snapshot never gains one', () => {
    const t = must(text(rows({ [VC.id]: { going: 'going' }, [HACK.id]: { going: 'speaking' } })));
    expect(t.text.match(/\[(会去|主办|分享)\]/g)).toEqual(['[会去]']);
    expect(t.going).toBe(1);
  });
});
