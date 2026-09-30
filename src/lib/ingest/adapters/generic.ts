import type { Platform, PlatformRef } from '../normalize';
import {
  arr, date, get, ldAccess, ldAttendance, ldCancelled, ldImage, ldPlace, ldPrice, type ParsedPage, str, text, zoneFromOffset,
} from './page';
import { emptyFacts, type PageFacts } from './types';

// Eventbrite, Meetup and everything else: schema.org Event JSON-LD, then og/twitter meta.
// Platform differences live only in the cover rule (guide cover step 1).

/** Eventbrite wraps images in /_next/image?url=…; the real file is on img.evbuc.com. */
export function unwrapEventbriteImage(u: string | null): string | null {
  if (!u) return null;
  try {
    const url = new URL(u);
    const inner = url.pathname.endsWith('/_next/image') ? url.searchParams.get('url') : null;
    return inner ? new URL(inner, url).toString() : u;
  } catch {
    return u;
  }
}

function coverFor(platform: Platform, page: ParsedPage): string | null {
  const ld = ldImage(page.event?.image);
  if (platform === 'eventbrite') return unwrapEventbriteImage(ld ?? page.meta['og:image'] ?? null);
  if (platform === 'meetup') return ld;
  return ld ?? page.meta['og:image:secure_url'] ?? page.meta['og:image'] ?? page.meta['twitter:image'] ?? null;
}

export function genericFacts(page: ParsedPage, platform: Platform, urlRef: PlatformRef | null): PageFacts {
  const facts = emptyFacts(platform, urlRef ? [urlRef] : []);
  const ld = page.event;
  const cover = coverFor(platform, page);
  facts.coverUrl = cover?.startsWith('https://') ? cover : null;
  if (!ld) {
    // No structured event: keep what the meta tags say; the model and Victor fill the rest.
    facts.title = str(page.meta['og:title']) ?? str(page.$('title').first().text());
    facts.description = text(page.meta['og:description'] ?? page.meta.description);
    return facts;
  }
  facts.title = str(ld.name);
  facts.description = text(ld.description);
  facts.startAt = date(ld.startDate);
  facts.endAt = date(ld.endDate);
  facts.tz = zoneFromOffset(ld.startDate);
  facts.format = ldAttendance(ld.eventAttendanceMode);
  Object.assign(facts, ldPlace(ld.location));
  if (!facts.format && facts.venueName) facts.format = 'in_person';
  const org = arr(ld.organizer)[0];
  facts.hostName = str(get(org, 'name'));
  const orgUrl = str(get(org, 'url'));
  facts.hostUrl = orgUrl?.startsWith('https://') ? orgUrl : null;
  facts.priceText = ldPrice(ld.offers);
  facts.access = ldAccess(ld.offers);
  facts.cancelled = ldCancelled(ld.eventStatus);
  return facts;
}
