import type { REGIONS } from '../db/schema';

// Bay Area city → region (events.region), shared by ingest and the inbox's fuzzy key.

const REGION_BY_CITY: Record<string, (typeof REGIONS)[number]> = {
  'san francisco': 'sf',
  oakland: 'east_bay', berkeley: 'east_bay', emeryville: 'east_bay', alameda: 'east_bay', richmond: 'east_bay',
  'walnut creek': 'east_bay', hayward: 'east_bay', fremont: 'east_bay', albany: 'east_bay', 'san leandro': 'east_bay',
  'palo alto': 'peninsula', 'menlo park': 'peninsula', 'redwood city': 'peninsula', 'san mateo': 'peninsula',
  burlingame: 'peninsula', 'foster city': 'peninsula', 'south san francisco': 'peninsula', 'daly city': 'peninsula',
  stanford: 'peninsula', 'san carlos': 'peninsula', 'half moon bay': 'peninsula',
  'mountain view': 'south_bay', 'san jose': 'south_bay', 'santa clara': 'south_bay', sunnyvale: 'south_bay',
  cupertino: 'south_bay', milpitas: 'south_bay', 'los gatos': 'south_bay', campbell: 'south_bay', 'los altos': 'south_bay',
  'san rafael': 'north_bay', sausalito: 'north_bay', 'mill valley': 'north_bay', 'santa rosa': 'north_bay',
  napa: 'north_bay', novato: 'north_bay', petaluma: 'north_bay', 'corte madera': 'north_bay',
};

export function regionFor(city: string | null, format: string): (typeof REGIONS)[number] | null {
  if (format === 'online') return 'online';
  return city ? REGION_BY_CITY[city.trim().toLowerCase()] ?? null : null;
}

/** The first known Bay Area city named in a free-text location ("995 Market St, San Francisco, CA"). */
export function cityIn(location: string | null | undefined): string | null {
  if (!location) return null;
  const s = location.toLowerCase();
  let best: string | null = null;
  // Longest match wins so "south san francisco" beats "san francisco".
  for (const city of Object.keys(REGION_BY_CITY)) {
    if (city.length > (best?.length ?? 0) && new RegExp(`(^|[^a-z])${city}([^a-z]|$)`).test(s)) best = city;
  }
  return best;
}
