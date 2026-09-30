import type { PlatformRef } from '../normalize';
import {
  arr, date, get, isIanaZone, ldAttendance, ldCancelled, ldImage, ldPlace, type ParsedPage, priceText, str, text,
} from './page';
import { emptyFacts, type PageFacts } from './types';

// Luma: __NEXT_DATA__.props.pageProps.initialData first (raw cover_url, IANA timezone, hosts,
// address visibility), JSON-LD as the fallback. og:image is an 800×419 social card, never the cover.

export function lumaFacts(page: ParsedPage, urlRef: PlatformRef | null): PageFacts {
  const initial = get(page.nextData, 'props.pageProps.initialData');
  const kind = get(initial, 'kind');
  const data = get(initial, 'data');
  const ev = get(data, 'event');
  const refs: PlatformRef[] = urlRef ? [urlRef] : [];
  const apiId = str(get(ev, 'api_id')) ?? str(get(data, 'api_id'));
  if (apiId?.startsWith('evt-') && !refs.some((r) => r.externalId === apiId)) refs.push({ platform: 'luma', externalId: apiId });
  const slug = str(get(ev, 'url'));
  if (slug && !refs.some((r) => r.externalId === slug)) refs.push({ platform: 'luma', externalId: slug });

  const facts = emptyFacts('luma', refs);
  const ld = page.event;
  if (!ev && !ld) {
    facts.kind = kind && kind !== 'event' ? 'not_event' : 'private';
    return facts;
  }

  facts.title = str(get(ev, 'name')) ?? str(ld?.name);
  facts.description = text(ld?.description);
  facts.startAt = date(get(ev, 'start_at')) ?? date(ld?.startDate);
  facts.endAt = date(get(ev, 'end_at')) ?? date(ld?.endDate);
  const tz = get(ev, 'timezone');
  facts.tz = isIanaZone(tz) ? tz : null;

  const locType = String(get(ev, 'location_type') ?? '');
  const geo = get(ev, 'geo_address_info');
  const hasPlace = Boolean(geo) || locType === 'offline';
  const hasVirtual = /online|zoom|meet|virtual/i.test(locType);
  facts.format = hasPlace && hasVirtual ? 'hybrid' : hasVirtual ? 'online' : hasPlace ? 'in_person' : ldAttendance(ld?.eventAttendanceMode);

  const visibility = String(get(ev, 'geo_address_visibility') ?? 'public');
  facts.addressHidden = visibility !== 'public' || get(geo, 'mode') === 'obfuscated';
  if (geo) {
    const placeName = str(get(geo, 'address'));
    const short = str(get(geo, 'short_address'));
    // `address` is the place name when Google knows one ("Cloudflare"); for a bare street
    // address it repeats the street, which means there is no venue name.
    facts.venueName = placeName && placeName !== short && !short?.startsWith(placeName) ? placeName : null;
    facts.address = facts.addressHidden ? null : str(get(geo, 'full_address')) ?? short;
    facts.city = str(get(geo, 'city')) ?? str(get(geo, 'city_state'))?.split(',')[0] ?? null;
    facts.neighborhood = facts.addressHidden ? null : str(get(geo, 'sublocality'));
  } else if (ld) {
    Object.assign(facts, ldPlace(ld.location));
  }

  const cal = get(data, 'calendar');
  const hosts = arr(get(data, 'hosts'));
  const personal = get(cal, 'is_personal') === true;
  facts.hostName = (!personal && str(get(cal, 'name'))) || str(get(hosts[0], 'name'));
  const calSlug = str(get(cal, 'slug'));
  facts.hostUrl = !personal && calSlug ? `https://luma.com/${calSlug}` : str(get(cal, 'website'));
  facts.hostImages = [
    ...hosts.map((h) => get(h, 'avatar_url')),
    get(cal, 'avatar_url'),
    ...arr(get(data, 'categories')).map((c) => get(c, 'social_image_url')),
  ].filter((u): u is string => typeof u === 'string' && u.startsWith('https://'));

  // Guide cover step 1: event.cover_url or JSON-LD image[0] (the 1920² crop), never og:image.
  facts.coverUrl = str(get(ev, 'cover_url')) ?? ldImage(ld?.image);

  const ticket = get(data, 'ticket_info');
  if (get(ticket, 'is_free') === true) facts.priceText = 'Free';
  else {
    const cents = [get(ticket, 'price.cents'), get(ticket, 'max_price.cents')].filter((n): n is number => typeof n === 'number');
    const currency = str(get(ticket, 'price.currency'))?.toUpperCase() ?? 'USD';
    if (cents.length) facts.priceText = priceText(Math.min(...cents) / 100, Math.max(...cents) / 100, currency);
  }
  facts.access =
    get(ticket, 'is_sold_out') === true || get(data, 'sold_out') === true
      ? get(data, 'waitlist_active') === true ? 'waitlist' : 'sold_out'
      : get(ticket, 'require_approval') === true
        ? 'apply'
        : get(data, 'registration_availability') === 'open'
          ? 'open'
          : 'unknown';

  facts.cancelled = ldCancelled(ld?.eventStatus) || get(ev, 'status') === 'cancelled';
  facts.platformCategories = arr(get(data, 'categories'))
    .map((c) => str(get(c, 'slug')))
    .filter((s): s is string => Boolean(s));
  return facts;
}
