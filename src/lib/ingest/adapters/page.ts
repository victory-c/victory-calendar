import * as cheerio from 'cheerio';

// Shared page reading: JSON-LD Event nodes, __NEXT_DATA__, og/twitter meta.

export type JsonLdEvent = Record<string, unknown>;

export type ParsedPage = {
  $: cheerio.CheerioAPI;
  event: JsonLdEvent | null;
  nextData: unknown;
  meta: Record<string, string>;
};

const flattenGraph = (node: unknown): unknown[] => {
  if (Array.isArray(node)) return node.flatMap(flattenGraph);
  if (node && typeof node === 'object' && '@graph' in node) return flattenGraph((node as { '@graph': unknown })['@graph']);
  return [node];
};

const isEventNode = (n: unknown): n is JsonLdEvent => {
  if (!n || typeof n !== 'object') return false;
  const t = (n as Record<string, unknown>)['@type'];
  return (Array.isArray(t) ? t : [t]).some((x) => typeof x === 'string' && /Event$/.test(x));
};

export function parsePage(html: string): ParsedPage {
  const $ = cheerio.load(html);
  const nodes = $('script[type="application/ld+json"]')
    .map((_, el) => $(el).text())
    .get()
    .flatMap((t) => {
      try {
        return flattenGraph(JSON.parse(t));
      } catch {
        return [];
      }
    });
  let nextData: unknown = null;
  try {
    const raw = $('#__NEXT_DATA__').text();
    if (raw) nextData = JSON.parse(raw);
  } catch {
    nextData = null;
  }
  const meta: Record<string, string> = {};
  $('meta[property], meta[name]').each((_, el) => {
    const k = $(el).attr('property') ?? $(el).attr('name');
    const v = $(el).attr('content');
    if (k && v && !(k in meta)) meta[k] = v;
  });
  return { $, event: nodes.find(isEventNode) ?? null, nextData, meta };
}

// ---- small readers -------------------------------------------------------

export const str = (v: unknown): string | null => {
  if (typeof v !== 'string') return null;
  const s = v.replace(/\s+/g, ' ').trim();
  return s ? s : null;
};

/** Multi-line plain text, capped (model context only). */
export const text = (v: unknown, max = 4000): string | null => {
  if (typeof v !== 'string') return null;
  const s = v.replace(/\r\n?/g, '\n').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  return s ? s.slice(0, max) : null;
};

export const date = (v: unknown): Date | null => {
  if (typeof v !== 'string' || !v) return null;
  // A bare date or a local time without offset is ambiguous; callers must supply a zone.
  if (!/[zZ]|[+-]\d{2}:?\d{2}$/.test(v)) return null;
  const d = new Date(v);
  return Number.isNaN(+d) ? null : d;
};

export function get(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  for (const key of path.split('.')) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

export const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : v == null ? [] : [v]);

export const isIanaZone = (tz: unknown): tz is string => {
  if (typeof tz !== 'string' || !tz.includes('/')) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};

/** First image URL from a JSON-LD `image` (string, array, or ImageObject). */
export function ldImage(v: unknown): string | null {
  for (const item of arr(v)) {
    if (typeof item === 'string' && item.startsWith('https://')) return item;
    const u = get(item, 'url') ?? get(item, 'contentUrl');
    if (typeof u === 'string' && u.startsWith('https://')) return u;
  }
  return null;
}

export function ldAttendance(v: unknown): 'in_person' | 'online' | 'hybrid' | null {
  const s = String(v ?? '');
  if (/Mixed/i.test(s)) return 'hybrid';
  if (/Online/i.test(s)) return 'online';
  if (/Offline/i.test(s)) return 'in_person';
  return null;
}

export const ldCancelled = (v: unknown) => /Cancel/i.test(String(v ?? ''));

/** Place → venue, address, city from a JSON-LD location (Place or array incl. VirtualLocation). */
export function ldPlace(v: unknown) {
  const place = arr(v).find((p) => /Place/.test(String(get(p, '@type') ?? ''))) ?? null;
  if (!place) return { venueName: null, address: null, city: null };
  const addr = get(place, 'address');
  if (typeof addr === 'string') {
    const parts = addr.split(',').map((s) => s.trim());
    return { venueName: str(get(place, 'name')), address: str(addr), city: parts.length >= 3 ? parts[parts.length - 2] : null };
  }
  const street = str(get(addr, 'streetAddress'));
  const city = str(get(addr, 'addressLocality'));
  const region = str(get(addr, 'addressRegion'));
  const postal = str(get(addr, 'postalCode'));
  const full = [street, city, [region, postal].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  return { venueName: str(get(place, 'name')), address: full || null, city };
}

/** "Free", "$25", "$49–$149" from JSON-LD offers. */
export function ldPrice(v: unknown): string | null {
  const prices = arr(v)
    .flatMap((o) => [get(o, 'price'), get(o, 'lowPrice'), get(o, 'highPrice')])
    .map((p) => (typeof p === 'number' ? p : typeof p === 'string' ? Number(p) : NaN))
    .filter((n) => Number.isFinite(n));
  if (prices.length === 0) return null;
  const currency = str(get(arr(v)[0], 'priceCurrency')) ?? 'USD';
  return priceText(Math.min(...prices), Math.max(...prices), currency);
}

export function priceText(min: number, max: number, currency = 'USD'): string {
  if (max <= 0) return 'Free';
  const fmt = (n: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: n % 1 ? 2 : 0 }).format(n);
  if (min === max) return fmt(min);
  return `${min <= 0 ? 'Free' : fmt(min)}–${fmt(max)}`;
}

export function ldAccess(offers: unknown): 'sold_out' | null {
  const all = arr(offers);
  return all.length > 0 && all.every((o) => /SoldOut/i.test(String(get(o, 'availability') ?? ''))) ? 'sold_out' : null;
}

/** Guide: street-address-only venues, Apt/Unit/# and hidden addresses are private venues. */
export function looksPrivate(venueName: string | null, address: string | null) {
  if (address && /\b(apt|apartment|unit)\b|#\s*\w+/i.test(address)) return true;
  if (!venueName && address) return true;
  if (venueName && /^\d+\s+\S+/.test(venueName)) return true;
  return false;
}

const OFFSET_ZONES = ['America/Los_Angeles', 'America/Denver', 'America/Chicago', 'America/New_York', 'UTC'];

/**
 * JSON-LD often gives `2026-11-05T09:00:00-08:00` with no zone name. Pick the first common zone
 * whose offset at that instant matches (the site is Bay Area first, so PT wins ties).
 */
export function zoneFromOffset(iso: unknown): string | null {
  if (typeof iso !== 'string') return null;
  const m = iso.match(/([+-])(\d{2}):?(\d{2})$/);
  if (!m) return null;
  const want = (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3]));
  const at = new Date(iso);
  if (Number.isNaN(+at)) return null;
  for (const tz of OFFSET_ZONES) {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'longOffset' }).formatToParts(at);
    const name = parts.find((p) => p.type === 'timeZoneName')?.value ?? '';
    const om = name.match(/GMT([+-])(\d{2}):(\d{2})/);
    const off = om ? (om[1] === '-' ? -1 : 1) * (Number(om[2]) * 60 + Number(om[3])) : 0;
    if (off === want) return tz;
  }
  return null;
}
