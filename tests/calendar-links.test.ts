import { describe, expect, it } from 'vitest';
import { feedUrl, googleEvent, googleSubscribe, outlookEvent, outlookSubscribe, targetOrder, webcal } from '@/lib/calendar-links';

const e = {
  title: 'Agents & Evals Night',
  start: new Date('2026-10-08T01:30:00Z'),
  end: new Date('2026-10-08T04:00:00Z'),
  details: '六个 demo\nRSVP: https://luma.com/abc',
  location: 'SoMa loft, San Francisco',
  tz: 'America/Los_Angeles',
};

describe('calendar links (formats are undocumented, so pin them)', () => {
  it('webcal and Google subscribe', () => {
    expect(webcal('https://picks.example.com/calendar.ics?c=ai,hackathon&lang=zh')).toBe(
      'webcal://picks.example.com/calendar.ics?c=ai,hackathon&lang=zh',
    );
    expect(googleSubscribe('https://picks.example.com/calendar.ics?c=ai&lang=zh')).toMatchInlineSnapshot(
      `"https://calendar.google.com/calendar/r?cid=webcal%3A%2F%2Fpicks.example.com%2Fcalendar.ics%3Fc%3Dai%26lang%3Dzh"`,
    );
  });
  it('Google single event', () => {
    expect(googleEvent(e)).toMatchInlineSnapshot(
      `"https://calendar.google.com/calendar/render?action=TEMPLATE&text=Agents+%26+Evals+Night&dates=20261008T013000Z%2F20261008T040000Z&ctz=America%2FLos_Angeles&details=%E5%85%AD%E4%B8%AA+demo%0ARSVP%3A+https%3A%2F%2Fluma.com%2Fabc&location=SoMa+loft%2C+San+Francisco"`,
    );
  });
  it('Outlook single event', () => {
    expect(outlookEvent(e)).toMatchInlineSnapshot(
      `"https://outlook.live.com/calendar/deeplink/compose?path=%2Fcalendar%2Faction%2Fcompose&rru=addevent&startdt=2026-10-08T01%3A30%3A00.000Z&enddt=2026-10-08T04%3A00%3A00.000Z&subject=Agents+%26+Evals+Night&location=SoMa+loft%2C+San+Francisco&body=%E5%85%AD%E4%B8%AA+demo%0ARSVP%3A+https%3A%2F%2Fluma.com%2Fabc"`,
    );
  });
  it('feed URLs for category, language and going selections', () => {
    const o = 'https://picks.example.com';
    expect(feedUrl(o, { cats: ['ai', 'hackathon'], locale: 'zh' })).toBe('https://picks.example.com/calendar.ics?c=ai,hackathon&lang=zh');
    expect(feedUrl(o, { cats: [], locale: 'en' })).toBe('https://picks.example.com/calendar.ics');
    expect(feedUrl(o, { locale: 'zh', going: true, cats: ['ai'] })).toBe('https://picks.example.com/calendar/going.ics?lang=zh');
  });
  it('F19 facets: fixed param order c, lang, ev_lang, online; going.ics takes none', () => {
    const o = 'https://picks.example.com';
    expect(feedUrl(o, { cats: ['ai', 'hackathon'], locale: 'zh', evLang: 'zh', onlineOnly: true })).toBe(
      'https://picks.example.com/calendar.ics?c=ai,hackathon&lang=zh&ev_lang=zh&online=1',
    );
    expect(feedUrl(o, { locale: 'en', onlineOnly: true })).toBe('https://picks.example.com/calendar.ics?online=1');
    expect(feedUrl(o, { locale: 'en', evLang: 'bilingual', onlineOnly: false })).toBe('https://picks.example.com/calendar.ics?ev_lang=bilingual');
    expect(feedUrl(o, { locale: 'en', evLang: null })).toBe('https://picks.example.com/calendar.ics');
    expect(feedUrl(o, { locale: 'zh', going: true, evLang: 'zh', onlineOnly: true })).toBe('https://picks.example.com/calendar/going.ics?lang=zh');
  });
  it('Outlook subscribe', () => {
    expect(outlookSubscribe('https://picks.example.com/calendar.ics?c=ai&lang=zh', 'Victor 精选 · AI 与技术')).toMatchInlineSnapshot(
      `"https://outlook.live.com/calendar/0/addfromweb?url=https%3A%2F%2Fpicks.example.com%2Fcalendar.ics%3Fc%3Dai%26lang%3Dzh&name=Victor+%E7%B2%BE%E9%80%89+%C2%B7+AI+%E4%B8%8E%E6%8A%80%E6%9C%AF"`,
    );
  });
  it('zh orders Apple, Outlook, .ics, Google', () => {
    expect(targetOrder('zh')).toEqual(['apple', 'outlook', 'ics', 'google']);
    expect(targetOrder('en')[0]).toBe('apple');
  });
});
