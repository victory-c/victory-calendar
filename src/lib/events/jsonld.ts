import { isoWithOffset } from '../format/date';
import type { PublicEvent } from './types';

/** schema.org Event with facts only — never the host's copy (guide「SEO 与分享卡片」). */
export function eventJsonLd(e: PublicEvent, name: string) {
  const price = e.priceText?.match(/\$\s?(\d+(?:\.\d+)?)/)?.[1] ?? (/^free$/i.test(e.priceText?.trim() ?? '') ? '0' : null);
  return {
    '@context': 'https://schema.org',
    '@type': 'Event',
    name,
    startDate: isoWithOffset(e.startAt, e.tz),
    ...(e.endAt ? { endDate: isoWithOffset(e.endAt, e.tz) } : {}),
    eventStatus: e.status === 'cancelled' ? 'https://schema.org/EventCancelled' : 'https://schema.org/EventScheduled',
    eventAttendanceMode:
      e.format === 'online'
        ? 'https://schema.org/OnlineEventAttendanceMode'
        : e.format === 'hybrid'
          ? 'https://schema.org/MixedEventAttendanceMode'
          : 'https://schema.org/OfflineEventAttendanceMode',
    location:
      e.format === 'online'
        ? { '@type': 'VirtualLocation', url: e.sourceUrl }
        : {
            '@type': 'Place',
            name: e.venueName ?? e.city ?? undefined,
            address: { '@type': 'PostalAddress', ...(e.address ? { streetAddress: e.address } : {}), addressLocality: e.city ?? undefined, addressRegion: 'CA', addressCountry: 'US' },
          },
    ...(e.hostName ? { organizer: { '@type': 'Organization', name: e.hostName, ...(e.hostUrl ? { url: e.hostUrl } : {}) } } : {}),
    ...(price !== null ? { offers: { '@type': 'Offer', price, priceCurrency: 'USD', url: e.sourceUrl } } : {}),
    url: e.sourceUrl,
    ...(e.cover && e.cover.kind !== 'template' ? { image: [e.cover.url1600] } : {}),
  };
}

/** Safe to drop into <script type="application/ld+json">. */
export function serializeJsonLd(data: unknown) {
  return JSON.stringify(data).replace(/</g, '\\u003c');
}
