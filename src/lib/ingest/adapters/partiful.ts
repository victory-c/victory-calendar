import type { PlatformRef } from '../normalize';
import { arr, date, get, isIanaZone, ldAttendance, ldCancelled, ldImage, ldPlace, type ParsedPage, str, text } from './page';
import { emptyFacts, type PageFacts } from './types';

// Partiful: JSON-LD only carries UTC times, so the zone comes from __NEXT_DATA__.event.timezone.
// The og:image is the 1000² poster on imgix; the same path takes w/h params (guide cover step 1).

export function partifulCover(ogImage: string | null): string | null {
  if (!ogImage) return null;
  try {
    const u = new URL(ogImage);
    if (u.hostname !== 'partiful.imgix.net') return null;
    u.search = '';
    u.searchParams.set('w', '1600');
    u.searchParams.set('h', '1600');
    u.searchParams.set('fit', 'crop');
    return u.toString();
  } catch {
    return null;
  }
}

export function partifulFacts(page: ParsedPage, urlRef: PlatformRef | null): PageFacts {
  const props = get(page.nextData, 'props.pageProps');
  const ev = get(props, 'event');
  const ld = page.event;
  const id = str(get(ev, 'id'));
  const refs: PlatformRef[] = urlRef ? [urlRef] : id ? [{ platform: 'partiful', externalId: id }] : [];
  const facts = emptyFacts('partiful', refs);
  if (get(props, 'passwordRequired') === true || (!ev && !ld)) {
    facts.kind = 'private';
    return facts;
  }

  facts.title = str(get(ev, 'title')) ?? str(ld?.name);
  facts.description = text(get(ev, 'description')) ?? text(ld?.description);
  facts.startAt = date(get(ev, 'startDate')) ?? date(ld?.startDate);
  facts.endAt = date(get(ev, 'endDate')) ?? date(ld?.endDate);
  const tz = get(ev, 'timezone');
  facts.tz = isIanaZone(tz) ? tz : null;
  facts.format = ldAttendance(ld?.eventAttendanceMode) ?? (get(ev, 'locationInfo') ? 'in_person' : null);

  const info = get(ev, 'locationInfo');
  const maps = get(info, 'mapsInfo');
  const lines = arr(get(maps, 'addressLines')).map(str).filter((s): s is string => Boolean(s));
  if (maps) {
    facts.venueName = str(get(maps, 'name'));
    facts.address = lines.length ? lines.join(', ') : null;
    const approx = str(get(maps, 'approximateLocation'));
    facts.city = approx?.split(',')[0]?.trim() ?? null;
  } else if (ld) {
    Object.assign(facts, ldPlace(ld.location));
  }
  // Partiful shows only the approximate area until you RSVP when there are no address lines.
  facts.addressHidden = Boolean(maps) && lines.length === 0;

  const hosts = arr(get(props, 'hosts'));
  facts.hostName = str(get(hosts[0], 'name')) ?? str(get(arr(ld?.organizer)[0], 'name'));
  facts.hostUrl = null; // host profile pages are personal; never link them
  facts.hostImages = hosts
    .map((h) => get(h, 'photo.url'))
    .filter((u): u is string => typeof u === 'string' && u.startsWith('https://'));

  facts.coverUrl = partifulCover(page.meta['og:image:secure_url'] ?? page.meta['og:image'] ?? ldImage(ld?.image));
  // A capped Partiful event keeps taking RSVPs onto its waitlist.
  facts.access = get(ev, 'atCapacity') === true ? 'waitlist' : 'open';
  facts.cancelled = ldCancelled(ld?.eventStatus) || /cancel/i.test(String(get(ev, 'status') ?? ''));
  return facts;
}
