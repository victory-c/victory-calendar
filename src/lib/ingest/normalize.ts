import type { PLATFORMS } from '../db/schema';

// Step 1–2 of the ingest order (guide「完整 ingest 顺序」): canonical URL, then the platform id
// that event_sources dedupes on. Pure functions; luma.link hops are resolved by the caller
// through safeFetch because they need the network.

export type Platform = (typeof PLATFORMS)[number];
export type PlatformRef = { platform: Platform; externalId: string };

const TRACKING = /^(utm_[a-z]+|fbclid|gclid|dclid|msclkid|mc_[a-z]+|igshid|si|ref|ref_src|aff|affiliate|tk|_hs[a-z]+)$/i;

// Luma top-level paths that are never event slugs.
const LUMA_RESERVED = new Set([
  'home', 'discover', 'calendar', 'calendars', 'create', 'signin', 'login', 'settings', 'user', 'u', 'pricing', 'explore',
  'sf', 'nyc', 'la', 'london', 'ai', 'crypto', 'tech', 'about', 'terms', 'privacy', 'help', 'check-in', 'embed',
]);

export class NormalizeError extends Error {}

/** Trim, upgrade to https, drop tracking params and the fragment, fold platform host aliases. */
export function normalizeUrl(raw: string): URL {
  const trimmed = raw.trim().replace(/^<|>$/g, '');
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`);
  } catch {
    throw new NormalizeError('not a URL');
  }
  if (url.protocol === 'http:') url.protocol = 'https:';
  if (url.protocol !== 'https:') throw new NormalizeError('only http(s) links');
  url.hash = '';
  url.hostname = url.hostname.toLowerCase().replace(/^www\./, '');
  if (url.hostname === 'lu.ma') url.hostname = 'luma.com';
  for (const key of [...url.searchParams.keys()]) if (TRACKING.test(key)) url.searchParams.delete(key);
  // These platforms need no query string to show an event; dropping it also drops invite
  // tokens (Luma `tk`) so they never end up in a public source_url.
  if (url.hostname === 'partiful.com' || url.hostname === 'luma.com' || url.hostname === 'meetup.com') url.search = '';
  if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, '');
  return url;
}

/** Needs a network hop before it can be identified (short links). */
export function isShortLink(url: URL) {
  return url.hostname === 'luma.link';
}

/** Platform id from the URL alone, before fetching. Luma's evt- id is added after the fetch. */
export function platformRef(url: URL): PlatformRef | null {
  const host = url.hostname;
  const parts = url.pathname.split('/').filter(Boolean);
  if (host === 'luma.com') {
    if (parts[0] === 'event' && parts[1]?.startsWith('evt-')) return { platform: 'luma', externalId: parts[1] };
    if (parts.length === 1 && /^[A-Za-z0-9_-]{3,64}$/.test(parts[0]) && !LUMA_RESERVED.has(parts[0].toLowerCase())) {
      return { platform: 'luma', externalId: parts[0] };
    }
    return null;
  }
  if (host === 'partiful.com') {
    if (parts[0] === 'e' && parts[1] && /^[A-Za-z0-9]{8,40}$/.test(parts[1])) return { platform: 'partiful', externalId: parts[1] };
    return null;
  }
  if (/(^|\.)eventbrite\.[a-z.]+$/.test(host)) {
    const m = url.pathname.match(/-tickets-(\d{6,})$/) ?? url.pathname.match(/^\/e\/(\d{6,})$/);
    return m ? { platform: 'eventbrite', externalId: m[1] } : null;
  }
  if (host === 'meetup.com') {
    const i = parts.indexOf('events');
    if (i === 1 && parts[2] && /^[A-Za-z0-9]+$/.test(parts[2])) return { platform: 'meetup', externalId: parts[2] };
    return null;
  }
  return null;
}
