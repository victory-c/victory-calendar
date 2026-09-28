import { describe, expect, it } from 'vitest';
import { goingDowngradeReason, isListedPlatform, publicGoing } from '@/lib/events/going';

const now = new Date('2026-10-01T12:00:00Z');
const future = { startAt: new Date('2026-10-03T01:00:00Z'), endAt: new Date('2026-10-03T03:00:00Z') };
const past = { startAt: new Date('2026-09-28T01:00:00Z'), endAt: new Date('2026-09-28T03:00:00Z') };
const base = {
  going: 'going' as const, goingVisibility: 'public' as const, category: 'ai' as const, format: 'in_person' as const,
  privateVenue: false, sourceUrl: 'https://luma.com/abc', status: 'published' as const, ...future,
};

describe('publicGoing', () => {
  it('shows a GOING seal only when every safety rule passes', () => {
    expect(publicGoing(base, now, true)).toEqual({ kind: 'seal', seal: 'going' });
  });
  it('interested is grey text, never a seal', () => {
    expect(publicGoing({ ...base, going: 'interested' }, now, true)).toEqual({ kind: 'interested' });
  });
  it('hidden visibility hides even the grey text', () => {
    expect(publicGoing({ ...base, going: 'interested', goingVisibility: 'hidden' }, now, true)).toEqual({ kind: 'none' });
  });
  it('downgrades going to after_event for private venues, unlisted platforms and recurring events', () => {
    expect(publicGoing({ ...base, privateVenue: true }, now, true)).toEqual({ kind: 'none' });
    expect(publicGoing({ ...base, sourceUrl: 'https://example.com/party' }, now, true)).toEqual({ kind: 'none' });
    expect(publicGoing({ ...base, recurring: true }, now, true)).toEqual({ kind: 'none' });
    expect(goingDowngradeReason({ ...base, privateVenue: true })).toBe('private_venue');
  });
  it('online events are exempt from the private-venue rule', () => {
    expect(publicGoing({ ...base, format: 'online', privateVenue: true }, now, true)).toEqual({ kind: 'seal', seal: 'going' });
  });
  it('downgraded and after_event attendance shows as WENT once the event ends', () => {
    expect(publicGoing({ ...base, ...past, privateVenue: true }, now, true)).toEqual({ kind: 'seal', seal: 'went' });
    expect(publicGoing({ ...base, ...past, goingVisibility: 'after_event' }, now, true)).toEqual({ kind: 'seal', seal: 'went' });
  });
  it('cycling never shows attendance, before or after', () => {
    expect(publicGoing({ ...base, category: 'cycling' }, now, true)).toEqual({ kind: 'none' });
    expect(publicGoing({ ...base, category: 'cycling', ...past }, now, true)).toEqual({ kind: 'none' });
    expect(publicGoing({ ...base, category: 'cycling', going: 'interested' }, now, true)).toEqual({ kind: 'none' });
  });
  it('hosting and speaking are public by default and ignore the platform rule', () => {
    expect(publicGoing({ ...base, going: 'hosting', sourceUrl: 'https://example.com' }, now, true)).toEqual({ kind: 'seal', seal: 'hosting' });
    expect(publicGoing({ ...base, going: 'speaking' }, now, true)).toEqual({ kind: 'seal', seal: 'speaking' });
  });
  it('the master switch hides everything', () => {
    for (const going of ['going', 'hosting', 'speaking', 'interested'] as const)
      expect(publicGoing({ ...base, going }, now, false)).toEqual({ kind: 'none' });
    expect(publicGoing({ ...base, ...past }, now, false)).toEqual({ kind: 'none' });
  });
  it('cancelled events never become WENT', () => {
    expect(publicGoing({ ...base, ...past, status: 'cancelled' }, now, true)).toEqual({ kind: 'none' });
  });
});

describe('isListedPlatform', () => {
  it('accepts the four platforms and lu.ma', () => {
    for (const u of ['https://luma.com/x', 'https://lu.ma/x', 'https://partiful.com/e/x', 'https://www.eventbrite.com/e/x-tickets-1', 'https://www.eventbrite.co.uk/e/1', 'https://www.meetup.com/g/events/1'])
      expect(isListedPlatform(u), u).toBe(true);
  });
  it('rejects look-alikes', () => {
    for (const u of ['https://notluma.com/x', 'https://luma.com.evil.io/x', 'nope'])
      expect(isListedPlatform(u), u).toBe(false);
  });
});
