import { describe, expect, it } from 'vitest';
import { redactForPublic } from '@/lib/events/redact';
import { seedEvents } from '@/lib/events/seed';

describe('redactForPublic', () => {
  const events = seedEvents(new Date('2026-09-28T12:00:00Z'));
  it('drops venue, address and neighborhood for cycling, keeps the city', () => {
    const ride = redactForPublic(events.find((e) => e.category === 'cycling')!);
    expect(ride).toMatchObject({ venueName: null, address: null, neighborhood: null, city: 'Berkeley' });
  });
  it('leaves other categories untouched', () => {
    const ai = events.find((e) => e.slug === 'agents-evals-night')!;
    expect(redactForPublic(ai)).toBe(ai);
  });
});
