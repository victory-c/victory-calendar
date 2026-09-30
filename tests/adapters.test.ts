/* eslint-disable @typescript-eslint/no-explicit-any -- fixture variants poke into untyped __NEXT_DATA__ JSON */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { readFacts } from '@/lib/ingest/adapters';
import { unwrapEventbriteImage } from '@/lib/ingest/adapters/generic';
import { looksPrivate, zoneFromOffset } from '@/lib/ingest/adapters/page';
import { partifulCover } from '@/lib/ingest/adapters/partiful';
import { normalizeUrl, platformRef } from '@/lib/ingest/normalize';

const fixture = (name: string) => readFileSync(`fixtures/${name}`, 'utf8');
const facts = (name: string, url: string) => {
  const u = normalizeUrl(url);
  return readFacts(fixture(name), u, platformRef(u));
};

/** Swap the __NEXT_DATA__ JSON through a mutator, for variants of a fixture. */
const withNextData = (html: string, mutate: (d: Record<string, unknown>) => void) =>
  html.replace(/(<script id="__NEXT_DATA__" type="application\/json">)([\s\S]*?)(<\/script>)/, (_, a, json, c) => {
    const d = JSON.parse(json);
    mutate(d);
    return a + JSON.stringify(d) + c;
  });

describe('normalizeUrl / platformRef', () => {
  it.each([
    ['lu.ma/abcd1234?utm_source=x&tk=secret#top', 'https://luma.com/abcd1234', { platform: 'luma', externalId: 'abcd1234' }],
    ['http://www.luma.com/event/evt-AbC123', 'https://luma.com/event/evt-AbC123', { platform: 'luma', externalId: 'evt-AbC123' }],
    ['https://luma.com/discover', 'https://luma.com/discover', null],
    ['https://partiful.com/e/Fk5FC9HoQ1czq3Uspro6?c=abc', 'https://partiful.com/e/Fk5FC9HoQ1czq3Uspro6', { platform: 'partiful', externalId: 'Fk5FC9HoQ1czq3Uspro6' }],
    ['https://www.eventbrite.com/e/climate-summit-tickets-123456789012?aff=ebdssbdestsearch', 'https://eventbrite.com/e/climate-summit-tickets-123456789012', { platform: 'eventbrite', externalId: '123456789012' }],
    ['https://www.meetup.com/sf-ai-builders/events/304512345/?eventOrigin=home', 'https://meetup.com/sf-ai-builders/events/304512345', { platform: 'meetup', externalId: '304512345' }],
    ['https://example.org/events/summit?utm_campaign=a&id=7', 'https://example.org/events/summit?id=7', null],
  ])('%s', (raw, want, ref) => {
    const u = normalizeUrl(raw);
    expect(u.toString()).toBe(want);
    expect(platformRef(u)).toEqual(ref);
  });

  it('rejects non-web schemes', () => {
    expect(() => normalizeUrl('javascript:alert(1)')).toThrow();
    expect(() => normalizeUrl('file:///etc/passwd')).toThrow();
  });
});

describe('Luma adapter', () => {
  const f = facts('luma-event.html', 'https://lu.ma/abcd1234');

  it('reads the event from __NEXT_DATA__', () => {
    expect(f.kind).toBe('event');
    expect(f.title).toBe('Agent Builders Night');
    expect(f.startAt?.toISOString()).toBe('2026-10-08T01:00:00.000Z');
    expect(f.endAt?.toISOString()).toBe('2026-10-08T04:00:00.000Z');
    expect(f.tz).toBe('America/Los_Angeles');
    expect(f.format).toBe('in_person');
    expect(f.venueName).toBe('Example Labs');
    expect(f.city).toBe('San Francisco');
    expect(f.neighborhood).toBe('South Beach');
    expect(f.address).toContain('100 Example St');
    expect(f.privateVenue).toBe(false);
    expect(f.hostName).toBe('Example Labs');
    expect(f.hostUrl).toBe('https://luma.com/example-labs');
    expect(f.priceText).toBe('Free');
    expect(f.access).toBe('apply');
    expect(f.platformCategories).toEqual(['ai']);
  });

  it('records both the URL slug and the evt- id', () => {
    expect(f.refs).toEqual([
      { platform: 'luma', externalId: 'abcd1234' },
      { platform: 'luma', externalId: 'evt-TestLuma000001' },
    ]);
  });

  it('takes the raw cover_url, never the og:image social card', () => {
    expect(f.coverUrl).toBe('https://images.lumacdn.com/uploads/op/00000000-cover.png');
    expect(f.hostImages).toContain('https://images.lumacdn.com/uploads/kd/00000000-host.jpg');
    expect(f.hostImages).toContain('https://images.lumacdn.com/uploads/c1/00000000-cat-ai.png');
  });

  it('falls back to JSON-LD image[0] (1920² crop) without cover_url', () => {
    const html = withNextData(fixture('luma-event.html'), (d) => {
      delete (d as any).props.pageProps.initialData.data.event.cover_url;
    });
    const u = normalizeUrl('https://luma.com/abcd1234');
    expect(readFacts(html, u, platformRef(u)).coverUrl).toMatch(/width=1920,height=1920/);
  });

  it('treats a guests-only address as a private venue and drops street details', () => {
    const html = withNextData(fixture('luma-event.html'), (d) => {
      const ev = (d as any).props.pageProps.initialData.data.event;
      ev.geo_address_visibility = 'guests-only';
      ev.geo_address_info = { city: 'San Francisco', city_state: 'San Francisco, CA', mode: 'obfuscated' };
    });
    const u = normalizeUrl('https://luma.com/abcd1234');
    const p = readFacts(html, u, platformRef(u));
    expect(p.privateVenue).toBe(true);
    expect(p.address).toBeNull();
    expect(p.neighborhood).toBeNull();
    expect(p.city).toBe('San Francisco');
  });

  it('flags calendar pages as not events', () => {
    const html = withNextData(fixture('luma-event.html'), (d) => {
      (d as any).props.pageProps.initialData = { kind: 'calendar', data: { calendar: { name: 'X' } } };
    }).replace(/<script data-cfasync="false" type="application\/ld\+json"[\s\S]*?<\/script>/, '');
    const u = normalizeUrl('https://luma.com/example-labs');
    expect(readFacts(html, u, platformRef(u)).kind).toBe('not_event');
  });

  it('reads sold-out, waitlist and paid tickets', () => {
    const variant = (m: (data: any) => void) => {
      const u = normalizeUrl('https://luma.com/abcd1234');
      return readFacts(withNextData(fixture('luma-event.html'), (d) => m((d as any).props.pageProps.initialData.data)), u, null);
    };
    expect(variant((d) => { d.sold_out = true; }).access).toBe('sold_out');
    expect(variant((d) => { d.sold_out = true; d.waitlist_active = true; }).access).toBe('waitlist');
    const paid = variant((d) => { d.ticket_info = { is_free: false, price: { cents: 2500, currency: 'usd' }, max_price: { cents: 5000, currency: 'usd' } }; });
    expect(paid.priceText).toBe('$25–$50');
  });
});

describe('Partiful adapter', () => {
  const f = facts('partiful-event.html', 'https://partiful.com/e/TestPartiful00001abc');

  it('takes the zone from __NEXT_DATA__ (JSON-LD is UTC only)', () => {
    expect(f.title).toBe('🎉 Founders Mixer 🎉');
    expect(f.startAt?.toISOString()).toBe('2026-10-10T01:00:00.000Z');
    expect(f.tz).toBe('America/Los_Angeles');
    expect(f.refs).toEqual([{ platform: 'partiful', externalId: 'TestPartiful00001abc' }]);
  });

  it('reads the venue, host and the imgix poster at 1600²', () => {
    expect(f.venueName).toBe('The Example Foundry');
    expect(f.address).toBe('200 Example St, San Francisco, CA 94103');
    expect(f.city).toBe('San Francisco');
    expect(f.privateVenue).toBe(false);
    expect(f.hostName).toBe('Sam Example');
    expect(f.hostUrl).toBeNull();
    expect(f.hostImages).toHaveLength(2);
    expect(f.coverUrl).toBe('https://partiful.imgix.net/external/user/TESTUSER/TESTIMAGE?w=1600&h=1600&fit=crop');
  });

  it('marks password-protected events private', () => {
    const html = withNextData(fixture('partiful-event.html'), (d) => {
      (d as any).props.pageProps = { passwordRequired: true };
    }).replace(/<script type="application\/ld\+json"[\s\S]*?<\/script>/, '');
    const u = normalizeUrl('https://partiful.com/e/TestPartiful00001abc');
    expect(readFacts(html, u, platformRef(u)).kind).toBe('private');
  });

  it('treats an approximate-only location as private', () => {
    const html = withNextData(fixture('partiful-event.html'), (d) => {
      (d as any).props.pageProps.event.locationInfo = { type: 'structured', mapsInfo: { approximateLocation: 'Oakland, CA' } };
    });
    const u = normalizeUrl('https://partiful.com/e/TestPartiful00001abc');
    const p = readFacts(html, u, platformRef(u));
    expect(p.privateVenue).toBe(true);
    expect(p.city).toBe('Oakland');
    expect(p.address).toBeNull();
  });

  it('only rewrites imgix posters', () => {
    expect(partifulCover('https://example.org/a.jpg')).toBeNull();
  });
});

describe('generic JSON-LD adapter', () => {
  const f = facts('generic-jsonld.html', 'https://example.org/summit');

  it('finds the Event node among other JSON-LD and reads it', () => {
    expect(f.platform).toBe('other');
    expect(f.title).toBe('Bay Area Climate Tech Summit 2026');
    expect(f.startAt?.toISOString()).toBe('2026-11-05T17:00:00.000Z');
    expect(f.tz).toBe('America/Los_Angeles');
    expect(f.format).toBe('hybrid');
    expect(f.venueName).toBe('Example Convention Center');
    expect(f.city).toBe('San Jose');
    expect(f.hostName).toBe('Example Climate Org');
    expect(f.priceText).toBe('$49–$149');
    expect(f.coverUrl).toBe('https://cdn.example.org/img/summit-square.jpg');
  });

  it('falls back to og:image:secure_url, then og:image, then twitter:image', () => {
    const noLd = fixture('generic-jsonld.html').replace(/<script type="application\/ld\+json">[\s\S]*?<\/script>/, '');
    const u = normalizeUrl('https://example.org/summit');
    const p = readFacts(noLd, u, null);
    expect(p.coverUrl).toBe('https://cdn.example.org/og/summit-2x1-secure.jpg');
    expect(p.title).toBe('Bay Area Climate Tech Summit 2026');
    expect(p.startAt).toBeNull();
  });

  it('unwraps Eventbrite /_next/image URLs', () => {
    expect(
      unwrapEventbriteImage('https://www.eventbrite.com/_next/image?url=https%3A%2F%2Fimg.evbuc.com%2Fimages%2F1%2Foriginal.jpg&w=940&q=75'),
    ).toBe('https://img.evbuc.com/images/1/original.jpg');
  });
});

describe('helpers', () => {
  it('maps offsets to zones, PT first', () => {
    expect(zoneFromOffset('2026-11-05T09:00:00-08:00')).toBe('America/Los_Angeles');
    expect(zoneFromOffset('2026-07-05T09:00:00-07:00')).toBe('America/Los_Angeles');
    expect(zoneFromOffset('2026-07-05T09:00:00-04:00')).toBe('America/New_York');
    expect(zoneFromOffset('2026-07-05T09:00:00+09:00')).toBeNull();
  });

  it('spots private venues', () => {
    expect(looksPrivate(null, '123 Oak St, Berkeley, CA')).toBe(true);
    expect(looksPrivate('Home', '123 Oak St Apt 4, Berkeley, CA')).toBe(true);
    expect(looksPrivate('55 Pine St', null)).toBe(true);
    expect(looksPrivate('Cloudflare', '101 Townsend St, San Francisco, CA')).toBe(false);
  });
});
