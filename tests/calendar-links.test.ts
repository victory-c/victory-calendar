import { describe, expect, it } from 'vitest';
import { googleEvent, googleSubscribe, outlookEvent, targetOrder, webcal } from '@/lib/calendar-links';

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
  it('zh orders Apple, Outlook, .ics, Google', () => {
    expect(targetOrder('zh')).toEqual(['apple', 'outlook', 'ics', 'google']);
    expect(targetOrder('en')[0]).toBe('apple');
  });
});
