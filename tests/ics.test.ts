import { describe, expect, it, vi } from 'vitest';
import { seedEvents } from '@/lib/events/seed';
import { buildIcs, calendarName } from '@/lib/ics';

vi.stubEnv('PUBLIC_HOST', 'picks.example.com');
const now = new Date('2026-09-28T12:00:00Z');
const events = seedEvents(now);

function unfold(s: string) {
  return s.replace(/\r\n[ \t]/g, '');
}

describe('calendarName', () => {
  it('names the categories, then the F19 facets', () => {
    expect(calendarName('en', ['ai', 'hackathon'])).toBe("Victor's Picks · AI & Tech, Hackathons");
    expect(calendarName('en', ['ai'], false, { evLang: 'zh', onlineOnly: true })).toBe("Victor's Picks · AI & Tech · Chinese or bilingual · Online");
    expect(calendarName('zh', [], false, { evLang: 'zh', onlineOnly: false })).toBe('Victor 精选 · 中文或双语活动');
    expect(calendarName('zh', [], false, { evLang: null, onlineOnly: true })).toBe('Victor 精选 · 线上');
    expect(calendarName('en', [])).toBe("Victor's Picks · All");
    expect(calendarName('zh', ['ai'], true, { evLang: 'en', onlineOnly: true })).toBe('Victor 精选 · Victor 会去');
  });
});

describe('buildIcs', () => {
  const out = unfold(buildIcs({ events, locale: 'zh', name: calendarName('zh', ['ai']), now, showAttendance: true }));

  it('declares the Pacific VTIMEZONE and uses TZID on DTSTART', () => {
    expect(out).toContain('BEGIN:VTIMEZONE');
    expect(out).toContain('TZID:America/Los_Angeles');
    expect(out).toMatch(/DTSTART;TZID=America\/Los_Angeles:2026092\dT/);
  });
  it('asks clients to refresh hourly', () => {
    expect(out).toContain('REFRESH-INTERVAL;VALUE=DURATION:PT1H');
    expect(out).toContain('X-PUBLISHED-TTL:PT1H');
  });
  it('uses stable UIDs on the public host and zh titles', () => {
    expect(out).toContain('UID:seed_01@picks.example.com');
    expect(out).toContain('X-WR-CALNAME:Victor 精选 · AI 与技术');
    expect(out).toContain('湾区华人创业者交流夜');
  });
  it('prefixes public going with V→ and marks cancellations', () => {
    expect(out).toContain('SUMMARY:V→ Agents & Evals Night');
    expect(out).not.toContain('SUMMARY:V→ 东湾山地'); // cycling never shows attendance
    expect(out).toContain('STATUS:CANCELLED');
  });
  it('hides the V→ prefix when the attendance switch is off', () => {
    const off = buildIcs({ events, locale: 'en', name: 'x', now, showAttendance: false });
    expect(off).not.toContain('V→');
  });
  it('puts the RSVP link and the event page in the description', () => {
    expect(out).toContain('RSVP: https://luma.com/sf');
    expect(out).toContain('https://picks.example.com/zh/events/agents-evals-night');
  });
});

describe('DTSTART is Pacific wall-clock time regardless of the server TZ', () => {
  it('writes 18:30 for an 18:30 PT event on a UTC machine', () => {
    expect(process.env.TZ).toBe('UTC');
    const one = events.filter((e) => e.slug === 'agents-evals-night');
    const text = buildIcs({ events: one, locale: 'en', name: 'x', now, showAttendance: true });
    expect(text).toContain('DTSTART;TZID=America/Los_Angeles:20260928T183000');
    expect(text).toContain('DTEND;TZID=America/Los_Angeles:20260928T210000');
  });
});

describe('RFC 5545 details', () => {
  it('writes DTSTAMP in UTC and ends with CRLF', () => {
    const text = buildIcs({ events, locale: 'en', name: 'x', now, showAttendance: true });
    const stamps = text.split('\r\n').filter((l) => l.startsWith('DTSTAMP:'));
    expect(stamps.length).toBe(events.length);
    for (const s of stamps) expect(s).toBe('DTSTAMP:20260928T120000Z');
    expect(text.endsWith('END:VCALENDAR\r\n')).toBe(true);
  });
});
