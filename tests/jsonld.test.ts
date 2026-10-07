import { describe, expect, it } from 'vitest';
import { eventJsonLd } from '@/lib/events/jsonld';
import { redactForPublic } from '@/lib/events/redact';
import { seedEvents } from '@/lib/events/seed';
import type { PublicCover } from '@/lib/events/types';

// The JSON-LD image follows the share-card rule (covers/credit.ts shareCardAllowed): an image that
// needs a visible credit, or one with no known licence, never leaves the page without it.
const base = redactForPublic(seedEvents(new Date('2026-10-06T12:00:00Z'))[0]);
const cover = (over: Partial<PublicCover>): PublicCover => ({
  kind: 'official', url400: 'https://blob.example.com/c-400.webp', url800: 'https://blob.example.com/c-800.webp',
  url1600: 'https://blob.example.com/c-1600.webp', thumbhash: '', dominant: '#888888', letterboxed: false,
  attribution: null, license: null, sourcePageUrl: null, ...over,
});
const image = (c: PublicCover | null) => (eventJsonLd({ ...base, cover: c }, 'Name') as { image?: string[] }).image;

describe('eventJsonLd image', () => {
  it.each([
    ['official', cover({ kind: 'official' }), true],
    ['ai', cover({ kind: 'ai' }), true],
    ['cc0 openverse', cover({ kind: 'openverse', license: 'cc0/1.0' }), true],
    ['CC BY openverse (needs a credit)', cover({ kind: 'openverse', license: 'by/2.0' }), false],
    ['brave (no known licence)', cover({ kind: 'brave' }), false],
    ['template', cover({ kind: 'template' }), false],
  ])('%s', (_, c, shown) => {
    expect(image(c)).toEqual(shown ? ['https://blob.example.com/c-1600.webp'] : undefined);
  });

  it('no cover, no image', () => expect(image(null)).toBeUndefined());
});
