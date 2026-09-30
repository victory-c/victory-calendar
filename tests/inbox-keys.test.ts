import { describe, expect, it } from 'vitest';
import { extractLinks, fuzzyKey, normTitle, partstatFor, providerKeyFrom, snoozeUntil } from '@/lib/inbox/keys';
import { cityIn } from '@/lib/ingest/regions';

describe('extractLinks', () => {
  it('scrubs invite tokens, drops call and map links, lists platform links first', () => {
    const links = extractLinks(
      'Notes https://example.org/about?utm_source=x. Join https://us02web.zoom.us/j/1 or https://meet.google.com/abc',
      '<a href="https://lu.ma/testagent?tk=SECRET">RSVP</a> (https://partiful.com/e/TestPartiful00001abc)',
    );
    expect(links).toEqual(['https://luma.com/testagent', 'https://partiful.com/e/TestPartiful00001abc', 'https://example.org/about']);
    expect(links.join(' ')).not.toContain('SECRET');
  });

  it('refuses links with credentials and dedupes', () => {
    expect(extractLinks('https://user:pw@example.org/x https://luma.com/a https://luma.com/a/')).toEqual(['https://luma.com/a']);
  });
});

describe('providerKeyFrom', () => {
  it('prefers the Luma evt- id in the ICS UID', () => {
    expect(providerKeyFrom(['https://luma.com/testagent'], 'evt-TestLumaIcs001@events.lu.ma')).toBe('luma:evt-TestLumaIcs001');
  });
  it('falls back to the first platform link, else null', () => {
    expect(providerKeyFrom(['https://example.org/x', 'https://partiful.com/e/TestPartiful00001abc'], 'abc@google.com')).toBe(
      'partiful:TestPartiful00001abc',
    );
    expect(providerKeyFrom(['https://example.org/x'], null)).toBeNull();
  });
});

describe('fuzzy key', () => {
  it('ignores emoji, punctuation and case', () => {
    expect(normTitle('Agent Builders Night 🤖 — SF!')).toBe('agent builders night sf');
  });
  it('rounds the start to 15 minutes and adds the city', () => {
    const a = fuzzyKey('AI Tinkerers: SF', new Date('2026-10-08T01:32:00Z'), '995 Market St, San Francisco, CA');
    const b = fuzzyKey('ai tinkerers sf', new Date('2026-10-08T01:28:00Z'), 'San Francisco');
    expect(a).toBe(b);
    expect(a).toBe('ai tinkerers sf|2026-10-08T01:30:00.000Z|san francisco');
  });
  it('picks the longest city name', () => {
    expect(cityIn('100 Main, South San Francisco, CA')).toBe('south san francisco');
    expect(cityIn('online')).toBeNull();
  });
});

describe('partstatFor', () => {
  it("reads Victor's PARTSTAT only", () => {
    const attendee = [
      { val: 'mailto:other@example.org', params: { PARTSTAT: 'DECLINED' } },
      { val: 'mailto:Test@Example.org', params: { PARTSTAT: 'ACCEPTED' } },
    ];
    expect(partstatFor(attendee, ['test@example.org'])).toBe('ACCEPTED');
    expect(partstatFor(attendee, ['nobody@example.org'])).toBeNull();
    expect(partstatFor(undefined, ['test@example.org'])).toBeNull();
  });
});

describe('snoozeUntil', () => {
  // Thursday 2026-10-01 05:00 PDT.
  const now = new Date('2026-10-01T12:00:00Z');
  it('tomorrow is 08:00 Bay Area time the next day', () => {
    expect(snoozeUntil('tomorrow', now).toISOString()).toBe('2026-10-02T15:00:00.000Z');
  });
  it('next week is the coming Monday at 08:00', () => {
    expect(snoozeUntil('next_week', now).toISOString()).toBe('2026-10-05T15:00:00.000Z');
    // From a Monday it is the Monday after.
    expect(snoozeUntil('next_week', new Date('2026-10-05T18:00:00Z')).toISOString()).toBe('2026-10-12T15:00:00.000Z');
  });
});
