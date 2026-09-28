import ical from 'node-ical';
import { describe, expect, it, vi } from 'vitest';
import { seedEvents } from '@/lib/events/seed';
import { buildIcs } from '@/lib/ics';

// Proxy for "imports correctly in Apple/Google Calendar": a strict third-party parser must read
// our feed back with the same instants, across the November DST change.
vi.stubEnv('PUBLIC_HOST', 'picks.example.com');

describe('ICS round trip through node-ical', () => {
  it('preserves instants, status and UIDs', () => {
    const now = new Date('2026-10-26T12:00:00Z'); // seed window spans the 2026-11-01 switch to PST
    const events = seedEvents(now);
    const text = buildIcs({ events, locale: 'en', name: 'test', now, showAttendance: true });
    const parsed = Object.values(ical.sync.parseICS(text)).filter((c) => c.type === 'VEVENT');
    expect(parsed).toHaveLength(events.length);
    for (const e of events) {
      const p = parsed.find((x) => x.type === 'VEVENT' && x.uid === `${e.id}@picks.example.com`);
      expect(p, e.slug).toBeTruthy();
      if (p?.type !== 'VEVENT') continue;
      expect(new Date(p.start).toISOString(), e.slug).toBe(e.startAt.toISOString());
      expect(String(p.status)).toBe(e.status === 'cancelled' ? 'CANCELLED' : 'CONFIRMED');
    }
    const afterDst = events.filter((e) => e.startAt > new Date('2026-11-01T10:00:00Z'));
    expect(afterDst.length).toBeGreaterThan(0);
  });
});
