import { load } from 'cheerio';
import { pretty } from 'react-email';
import { describe, expect, it } from 'vitest';
import { ev, O } from './helpers/digest-fixtures';
import { expectEmailSafe, expectTextLinksDelimited } from './helpers/email-checks';

// F20 going alert email (DESIGN-F20 G10, A5): the template and render.ts. The day only (no clock
// time), never "invited", seals with a text twin, ≤ 90 KB, three per-reader links swapped per
// recipient, both languages in the footer, RSVP links only to http(s) pages.

const { ALERT_LINKS, MAX_ALERT_EVENTS, alertLinks, alertSubject, renderAlert } = await import('@/lib/alerts/render');
const { DigestTooLargeError, MAX_HTML_BYTES, TOKEN, personalize } = await import('@/lib/digest/render');
const { ALERT_NOTE_MAX } = await import('@/emails/going-alert');
type DigestEvent = import('@/lib/digest/types').DigestEvent;

const REAL_TOKEN = `sub_0123456789abcdef.${'Ab3_-'.repeat(8)}Ab3`; // linkToken()'s shape: 64 chars

// Week 2026-W42 (PDT). One of each seal; the going one starts 18:30 and the speaking one 17:00, so a
// clock time would show if any row printed one.
const GOING = ev({
  id: 'evt_ai00000000000001', slug: 'ai-builders-night', category: 'ai', startAt: '2026-10-14T01:30:00.000Z', endAt: '2026-10-14T04:00:00.000Z',
  noteEn: 'Small room, strong demos. Go for the agents panel.', noteZh: '人不多，demo 质量高。冲着 agents 圆桌去。',
  seal: 'going', platform: 'Partiful', sourceUrl: 'https://partiful.com/e/abc',
});
const HOSTING = ev({
  id: 'evt_hk00000000000001', slug: 'cal-hacks-weekend', category: 'hackathon', allDay: true, startAt: '2026-10-17T07:00:00.000Z',
  endAt: '2026-10-18T07:00:00.000Z', titleEn: 'Cal Hacks Weekend', titleZh: 'Cal Hacks 黑客松周末', place: 'Berkeley', seal: 'hosting',
  platform: null, sourceUrl: 'https://example.org/cal-hacks',
});
const SPEAKING = ev({
  id: 'evt_vc00000000000001', slug: 'founder-office-hours', category: 'vc', startAt: '2026-10-15T00:00:00.000Z', endAt: '2026-10-15T02:00:00.000Z',
  format: 'hybrid', place: 'Palo Alto', titleEn: 'Founder Office Hours', titleZh: '', noteEn: null, noteZh: '这次分享讲早期融资。',
  seal: 'speaking', platform: 'Eventbrite', sourceUrl: 'https://www.eventbrite.com/e/123',
});
const ALL = [GOING, HOSTING, SPEAKING];
const LOCALES = ['en', 'zh'] as const;

const placeholders = (s: string) => s.split(TOKEN).length - 1;

describe('renderAlert: snapshots', () => {
  it.each(LOCALES)('%s html and text', async (l) => {
    const e = await renderAlert(ALL, l, O);
    await expect(await pretty(e.html)).toMatchFileSnapshot(`./__snapshots__/going-alert.${l}.html`);
    await expect(e.text).toMatchFileSnapshot(`./__snapshots__/going-alert.${l}.txt`);
  });
});

describe('renderAlert: content', () => {
  it('subjects: the title for one event, the count for several, in each language', async () => {
    expect((await renderAlert([GOING], 'en', O)).subject).toBe('Victor plans to go: Bay Area AI Builders Night');
    expect((await renderAlert([GOING], 'zh', O)).subject).toBe('Victor 打算去：湾区 AI 开发者之夜');
    expect((await renderAlert(ALL, 'en', O)).subject).toBe('Victor plans to go to 3 events');
    expect((await renderAlert(ALL, 'zh', O)).subject).toBe('Victor 打算去 3 场活动');
    expect((await renderAlert([GOING, HOSTING], 'zh', O)).subject).toBe('Victor 打算去 2 场活动');
    // A zh reader of an event without a Chinese title gets the English one.
    expect((await renderAlert([SPEAKING], 'zh', O)).subject).toBe('Victor 打算去：Founder Office Hours');
    // A runaway title is clipped (and whitespace collapsed: nothing can break the header line).
    const long = ev({ seal: 'going', titleEn: `Summit\n${'very long words '.repeat(20)}` });
    const s = alertSubject([long], 'en');
    expect(s).not.toMatch(/[\r\n]/);
    expect(s.endsWith('…')).toBe(true);
    expect(s.length).toBeLessThanOrEqual('Victor plans to go: '.length + 121);
    for (const l of LOCALES) expect((await renderAlert(ALL, l, O)).subject).not.toMatch(/\p{Extended_Pictographic}/u);
  });

  it('every row: planToGo, the day and the place; never a clock time, a time zone or "invited"', async () => {
    const en = await renderAlert(ALL, 'en', O);
    expect(en.text).toContain('I plan to go · Tue, Oct 13 · SoMa');
    expect(en.text).toContain('I plan to go · Wed, Oct 14 · Palo Alto · Hybrid');
    expect(en.text).toContain('I plan to go · Sat, Oct 17 · Berkeley');
    const zh = await renderAlert(ALL, 'zh', O);
    expect(zh.text).toContain('打算去 · 10月13日周二 · SoMa');
    expect(zh.text).toContain('打算去 · 10月14日周三 · Palo Alto · 线上线下');
    expect(zh.text).toContain('打算去 · 10月17日周六 · Berkeley');
    for (const e of [en, zh]) {
      for (const part of [e.subject, e.preheader, e.text, load(e.html).text()]) {
        expect(part).not.toMatch(/\d{1,2}:\d{2}|\b(AM|PM)\b|上午|下午|\bPT\b|太平洋时间|全天|All day/);
        expect(part).not.toMatch(/invit|邀请/i);
      }
    }
  });

  it('rows follow the start time whatever order the events come in; the output is byte-identical', async () => {
    const a = await renderAlert(ALL, 'zh', O);
    const b = await renderAlert([SPEAKING, HOSTING, GOING, GOING], 'zh', O);
    expect(b).toEqual(a);
    const order = ['ai-builders-night', 'founder-office-hours', 'cal-hacks-weekend'].map((slug) => a.html.indexOf(`/zh/events/${slug}"`));
    expect(order.every((i) => i > 0)).toBe(true);
    expect([...order].sort((x, y) => x - y)).toEqual(order);
    expect(a.going).toBe(3);
  });

  it('seals: hosted PNG in the email language with a one-language alt, and a text twin for the plain part', async () => {
    const en = await renderAlert(ALL, 'en', O);
    const seals = en.html.match(/<img\b[^>]*>/g) ?? [];
    expect(seals).toHaveLength(3); // seals only: an alert has no covers
    for (const tag of seals) expect(tag).toMatch(/src="https:\/\/picks\.example\.com\/og\/seal\/(going|hosting|speaking)\?l=en" width="48" height="48" alt="\[(GOING|HOST|TALK)\]"/);
    expect(en.text).toContain('[GOING] Bay Area AI Builders Night <https://picks.example.com/events/ai-builders-night>');
    expect(en.text).toContain('[HOST] Cal Hacks Weekend');
    expect(en.text).toContain('[TALK] Founder Office Hours');
    const zh = await renderAlert(ALL, 'zh', O);
    expect(zh.html).toContain('/og/seal/going?l=zh');
    expect(zh.html).not.toMatch(/alt="\[(GOING|HOST|TALK)\]"/);
    expect(zh.text).toContain('[会去] 湾区 AI 开发者之夜');
    expect(zh.text).toContain('[主办] Cal Hacks 黑客松周末');
    expect(zh.text).toContain('[分享] Founder Office Hours');
  });

  it('titles link to our event page; the RSVP button goes to the official page', async () => {
    const zh = await renderAlert(ALL, 'zh', O);
    const $ = load(zh.html);
    expect($(`a[href="${O}/zh/events/ai-builders-night"]`).text()).toBe('湾区 AI 开发者之夜');
    expect($('a.btn').map((_, a) => [[$(a).text(), $(a).attr('href')]]).get()).toEqual([
      ['去 Partiful 报名', 'https://partiful.com/e/abc'],
      ['去 Eventbrite 报名', 'https://www.eventbrite.com/e/123'],
      ['报名', 'https://example.org/cal-hacks'],
    ]);
    expect(zh.text).toContain('去 Partiful 报名 <https://partiful.com/e/abc>');
    const en = await renderAlert([HOSTING], 'en', O);
    expect(en.text).toContain('RSVP <https://example.org/cal-hacks>'); // no platform: the plain label
  });

  it('RSVP links only to http(s): anything else falls back to our event page', async () => {
    for (const sourceUrl of ['javascript:alert(1)', 'data:text/html,hi', 'mailto:x', '//evil.example/x', 'ftp://example.org/x']) {
      const e = await renderAlert([ev({ slug: 'odd-links', seal: 'going', sourceUrl })], 'en', O);
      const $ = load(e.html);
      expect($('a.btn').attr('href')).toBe(`${O}/events/odd-links`);
      expect(e.html).not.toMatch(/javascript:|data:text|mailto:|evil\.example|ftp:/);
    }
  });

  it('the note: email language first, the other one tagged, clipped to about two lines, signed', async () => {
    const zh = await renderAlert(ALL, 'zh', O);
    expect(zh.html).toContain('border-left:2px solid #e54f36;font-size:15px">人不多，demo 质量高。冲着 agents 圆桌去。<br/>');
    const en = await renderAlert([SPEAKING], 'en', O);
    expect(en.html).toContain('<span lang="zh-Hans">这次分享讲早期融资。</span>');
    expect(en.text).toContain('— Victor');
    // No note: no note block, no signature.
    expect((await renderAlert([HOSTING], 'en', O)).text).not.toContain('— Victor');
    const long = await renderAlert([ev({ seal: 'going', noteEn: 'Worth it for the hallway track alone. '.repeat(10) })], 'en', O);
    const shown = load(long.html)('div.note').contents().first().text();
    expect(shown.endsWith('…')).toBe(true);
    expect([...shown].length).toBeLessThanOrEqual(ALERT_NOTE_MAX.en + 1);
    const longZh = await renderAlert([ev({ seal: 'going', noteZh: '值得去，走廊交流就够本。'.repeat(10) })], 'zh', O);
    expect([...load(longZh.html)('div.note').contents().first().text()].length).toBeLessThanOrEqual(ALERT_NOTE_MAX['zh-Hans'] + 1);
  });

  it('masthead and intro say what this is; singular and plural intros', async () => {
    const en = await renderAlert([GOING], 'en', O);
    expect(en.text).toMatch(/^Victor's Picks · Going alert\n\nI plan to go to this one\./);
    expect((await renderAlert(ALL, 'en', O)).text).toContain('I plan to go to these.');
    const zh = await renderAlert(ALL, 'zh', O);
    expect(zh.text).toMatch(/^Victor 精选 · 会去提醒\n\n这几场活动我打算去。/);
    expect((await renderAlert([GOING], 'zh', O)).text).toContain('这场活动我打算去。');
  });

  it('preheader: one event gives its day and place, several give their titles', async () => {
    expect((await renderAlert([GOING], 'en', O)).preheader).toBe('Tue, Oct 13 · SoMa');
    expect((await renderAlert([GOING], 'zh', O)).preheader).toBe('10月13日周二 · SoMa');
    expect((await renderAlert(ALL, 'en', O)).preheader).toBe('Bay Area AI Builders Night · Founder Office Hours · Cal Hacks Weekend');
  });

  it('lang attributes: html and body in the email language, other-language text tagged', async () => {
    const zh = await renderAlert(ALL, 'zh', O);
    const $ = load(zh.html);
    expect($('html').attr('lang')).toBe('zh-Hans');
    expect($('body').attr('lang')).toBe('zh-Hans');
    // An English-only title in a zh email, and the footer's English line.
    expect($(`a[href="${O}/zh/events/founder-office-hours"]`).attr('lang')).toBe('en');
    expect($('p[lang="en"]').text()).toBe("Victor's Picks · Bay Area tech events, picked by Victor · No paid placements.");
    const en = load((await renderAlert(ALL, 'en', O)).html);
    expect([en('html').attr('lang'), en('body').attr('lang')]).toEqual(['en', 'en']);
    expect(en('p[lang="zh-Hans"]').text()).toBe('Victor 精选 · Victor 亲自挑选的湾区 tech 活动 · 无付费植入。');
    expect(en(`a[href="${O}/events/ai-builders-night"]`).attr('lang')).toBeUndefined();
  });

  it('a title in one language only (public-rows fills the other with it): clipped and tagged as its own language', async () => {
    // The production shape: titleEn === titleZh, never an empty field (public-rows.ts).
    const cjk = '湾区开发者'.repeat(15); // 75 Han characters
    const zhOnly = ev({ id: 'evt_zo00000000000001', slug: 'zh-only-night', seal: 'going', titleEn: cjk, titleZh: cjk });
    const en = await renderAlert([zhOnly], 'en', O);
    expect(en.subject).toBe(`Victor plans to go: ${cjk.slice(0, 60)}…`); // the Chinese limit (60), not the English 120
    expect(load(en.html)(`a[href="${O}/events/zh-only-night"]`).attr('lang')).toBe('zh-Hans');

    const title = 'Weekend Agent Hackathon: build, ship, and demo autonomous agents with Bay Area builders'; // 87 characters
    const enOnly = ev({ id: 'evt_eo00000000000001', slug: 'en-only-hackathon', seal: 'going', titleEn: title, titleZh: title });
    const zh = await renderAlert([enOnly], 'zh', O);
    expect(zh.subject).toBe(`Victor 打算去：${title}`); // under the English limit (120): not clipped at 60
    expect(load(zh.html)(`a[href="${O}/zh/events/en-only-hackathon"]`).attr('lang')).toBe('en');
    const longer = `${title} and a demo day`.repeat(2);
    const clipped = alertSubject([{ ...enOnly, titleEn: longer, titleZh: longer }], 'zh');
    expect(clipped.endsWith('…')).toBe(true);
    expect([...clipped.slice('Victor 打算去：'.length)].length).toBeGreaterThan(61);
    expect([...clipped.slice('Victor 打算去：'.length)].length).toBeLessThanOrEqual(121);
  });

  it('footer: both languages, why the reader gets it, the three per-reader links and privacy', async () => {
    const zh = await renderAlert(ALL, 'zh', O);
    expect(zh.text).toContain('你收到这封邮件，是因为选了「Victor 标记会去时提醒我」（每天最多一封）。');
    expect(zh.text).toContain(`关闭会去提醒 Turn off going alerts <${O}/zh/unsubscribe?t=${TOKEN}&list=going>`);
    expect(zh.text).toContain(`订阅设置 Preferences <${O}/zh/prefs/${TOKEN}>`);
    expect(zh.text).toContain(`全部退订 Unsubscribe from everything <${O}/zh/unsubscribe?t=${TOKEN}>`);
    expect(zh.text).toContain(`隐私 Privacy <${O}/zh/privacy>`);
    expect(zh.text).toContain('无付费植入。');
    expect(zh.text).toContain('No paid placements.');
    const en = await renderAlert(ALL, 'en', O);
    expect(en.text).toContain('You get this because you asked for an email when Victor marks an event as going (at most one a day).');
    expect(en.text).toContain(`Turn off going alerts 关闭会去提醒 <${O}/unsubscribe?t=${TOKEN}&list=going>`);
    expect(en.text).toContain(`Unsubscribe from everything 全部退订 <${O}/unsubscribe?t=${TOKEN}>`);
    expect(en.html).toContain(`href="${O}/unsubscribe?t=${TOKEN}&amp;list=going"`);
    for (const e of [zh, en]) expectTextLinksDelimited(e.text);
  });
});

describe('renderAlert: email-client constraints and size', () => {
  it.each(LOCALES)('%s: doctype, lang, tables only, safe images, dark mode, Outlook ghost table, no addresses', async (l) => {
    const e = await renderAlert(ALL, l, O);
    expectEmailSafe(e.html, l);
    expect(e.html).toContain('max-width:600px');
    expect(e.html).toContain(`<title>${l === 'en' ? 'Victor plans to go to 3 events' : 'Victor 打算去 3 场活动'}</title>`);
    expect(Buffer.byteLength(e.html)).toBeLessThan(e.bytes); // bytes counts the real tokens
  });

  it.each(LOCALES)('%s: exactly three placeholders, all swapped by personalize(…, ALERT_LINKS)', async (l) => {
    const e = await renderAlert(ALL, l, O);
    expect(ALERT_LINKS).toBe(3);
    expect([placeholders(e.html), placeholders(e.text)]).toEqual([3, 3]);
    const out = personalize(e, REAL_TOKEN, ALERT_LINKS);
    expect(out.subject).toBe(e.subject);
    expect(out.html).not.toContain(TOKEN);
    expect(out.text).not.toContain(TOKEN);
    expect(out.html.split(REAL_TOKEN).length - 1).toBe(3);
    expect(out.text).toContain(`/unsubscribe?t=${REAL_TOKEN}&list=going>`);
    expect(Buffer.byteLength(out.html, 'utf8')).toBe(e.bytes);
  });

  it('personalize fails closed without the alert count, or with a count that is not the links we render', async () => {
    const e = await renderAlert(ALL, 'en', O);
    expect(() => personalize(e, REAL_TOKEN)).toThrow(/placeholder count/); // the digest rule would want 4
    expect(() => personalize(e, REAL_TOKEN, 4)).toThrow(/placeholder count/);
    for (const bad of [0, -1, 2.5, Number.NaN]) expect(() => personalize(e, REAL_TOKEN, bad)).toThrow(/positive integer/);
    const extra = { ...e, html: e.html.replace('</body>', `<a href="https://evil.example/${TOKEN}">x</a></body>`) };
    expect(() => personalize(extra, REAL_TOKEN, ALERT_LINKS)).toThrow(/placeholder count/);
  });

  it.each(LOCALES)('%s: the worst case (20 events, long everything) stays under 90 KB as delivered', async (l) => {
    const cats = ['ai', 'hackathon', 'vc', 'campus', 'conference', 'social'] as const;
    const events = Array.from({ length: MAX_ALERT_EVENTS }, (_, i) =>
      ev({
        category: cats[i % cats.length], seal: (['going', 'hosting', 'speaking'] as const)[i % 3],
        startAt: new Date(Date.parse('2026-10-13T16:00:00.000Z') + i * 864e5).toISOString(), format: 'hybrid',
        titleEn: 'Founders and Builders Summit: Agents, Infra and the Next Platform Shift', titleZh: '创始人与开发者峰会：智能体、基础设施与下一次平台迁移',
        noteEn: 'A long note about why this one is worth going to, and who you will meet there. '.repeat(25),
        noteZh: '为什么值得去，以及你会在那里遇到谁的一段很长的说明。'.repeat(40),
        place: 'Mission District, San Francisco', platform: 'Eventbrite', sourceUrl: `https://www.eventbrite.com/e/very-long-event-slug-${i}-abcdefgh`,
      }),
    );
    const e = await renderAlert(events, l, O);
    expect(e.going).toBe(20);
    expect(e.bytes).toBeLessThan(MAX_HTML_BYTES);
    expect(Buffer.byteLength(personalize(e, REAL_TOKEN, ALERT_LINKS).html)).toBeLessThanOrEqual(MAX_HTML_BYTES);
    expectEmailSafe(e.html, l);
    expectTextLinksDelimited(e.text);
  });

  it('refuses more than 20 events (alert_sends holds at most 20) and anything over the size cap', async () => {
    const many = Array.from({ length: MAX_ALERT_EVENTS + 1 }, () => ev({ seal: 'going' }));
    await expect(renderAlert(many, 'en', O)).rejects.toThrow(/limit 20/);
    // Over the cap with few events: a pathological origin makes every link huge.
    const fat = `https://${'x'.repeat(4000)}.example`;
    const p = renderAlert(Array.from({ length: 20 }, () => ev({ seal: 'going' })), 'zh', fat);
    await expect(p).rejects.toBeInstanceOf(DigestTooLargeError);
    await expect(p).rejects.toThrow(/^alert html is \d+ bytes \(limit 90000\)/);
  });
});

describe('renderAlert: fails closed', () => {
  it('no events', async () => {
    await expect(renderAlert([], 'en', O)).rejects.toThrow(/no events/);
  });

  it('an event without a public seal (none, or "went" / "interested" from bad data) is never announced', async () => {
    for (const seal of [null, 'went', 'interested', undefined]) {
      const bad = { ...ev({ slug: 'not-public' }), seal } as unknown as DigestEvent;
      await expect(renderAlert([GOING, bad], 'en', O)).rejects.toThrow(/has no public seal/);
    }
  });

  it('the link placeholder anywhere in the input (it would hand each reader’s token to that site)', async () => {
    for (const over of [{ sourceUrl: `https://evil.example/rsvp/${TOKEN}` }, { noteEn: `See ${TOKEN}` }, { titleZh: TOKEN }, { place: TOKEN }]) {
      await expect(renderAlert([ev({ seal: 'going', ...over })], 'en', O)).rejects.toThrow(/link placeholder/);
    }
    await expect(renderAlert([GOING], 'en', `${O}/${TOKEN}`)).rejects.toThrow(/link placeholder/);
  });
});

describe('alertLinks', () => {
  it('builds each language from the origin; the one-click target turns off going alerts only', () => {
    expect(alertLinks('zh', 'TKN', O)).toEqual({
      offAlerts: `${O}/zh/unsubscribe?t=TKN&list=going`,
      prefs: `${O}/zh/prefs/TKN`,
      unsubscribe: `${O}/zh/unsubscribe?t=TKN`,
      privacy: `${O}/zh/privacy`,
      oneClick: `${O}/api/unsubscribe?t=TKN&list=going`,
    });
    expect(alertLinks('en', 'TKN', 'https://other.example')).toEqual({
      offAlerts: 'https://other.example/unsubscribe?t=TKN&list=going',
      prefs: 'https://other.example/prefs/TKN',
      unsubscribe: 'https://other.example/unsubscribe?t=TKN',
      privacy: 'https://other.example/privacy',
      oneClick: 'https://other.example/api/unsubscribe?t=TKN&list=going',
    });
  });
});
