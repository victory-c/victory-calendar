import 'server-only';
import { createHash } from 'node:crypto';
import { Redis } from '@upstash/redis';
import { z } from 'zod';
import { publicSafeUrl } from '../ingest/normalize';
import { safeFetchJson } from '../ingest/safe-fetch';
import { LIMITS, limit, upstashConfigured } from '../ratelimit';
import type { Category } from '../taxonomy';
import { formatOpenverseCredit, isOpenverseLicense, OPENVERSE_LICENSES, type OpenverseLicense } from './credit';
import { apiError, capReached, CoverSourceError } from './errors';

// Cover selector source 4 (guide「封面图获取」): Openverse, anonymous API, only CC0 / BY / BY-SA,
// never mature or flagged sensitive. Search runs on the server (cached 24 h, capped per day, since
// the anonymous quota is per IP and Vercel's outbound IPs are shared); a pick re-reads the image's
// detail record so the licence is checked again before anything is stored.

const HOST = 'api.openverse.org';
const API = `https://${HOST}/v1/images/`;
export const OPENVERSE_PAGE_SIZE = 20; // the anonymous maximum
export const OPENVERSE_MAX_PAGE = 5;
const CACHE_TTL_S = 86_400;
const MIN_EDGE = 400;
const MAX_FILE_BYTES = 15_000_000; // the cover chain's download cap
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Starting query for the selector, from the category alone. */
export const OPENVERSE_QUERY: Record<Category, string> = {
  ai: 'abstract circuit', hackathon: 'laptop code', vc: 'city skyline', campus: 'university campus',
  conference: 'auditorium stage', cycling: 'road cycling', social: 'city lights night',
};

export type OpenverseHit = {
  id: string;
  title: string;
  creator: string | null;
  license: OpenverseLicense;
  licenseVersion: string;
  /** The credit as it would be stored (before any crop note). */
  credit: string;
  thumbUrl: string;
  pageUrl: string | null;
  width: number | null;
  height: number | null;
  /** False for SVGs, files over 15 MB and images under 400 px on a side. */
  usable: boolean;
};

export type OpenverseImage = {
  id: string;
  title: string | null;
  creator: string | null;
  license: OpenverseLicense;
  licenseVersion: string;
  url: string;
  thumbUrl: string | null;
  pageUrl: string | null;
};

const num = z.number().int().positive().nullish().catch(null);
const str = z.string().nullish().catch(null);
const Item = z.object({
  id: z.string().regex(UUID),
  title: str,
  creator: str,
  license: z.string(),
  license_version: str,
  url: str,
  thumbnail: str,
  foreign_landing_url: str,
  width: num,
  height: num,
  filetype: str,
  filesize: num,
  mature: z.boolean().nullish().catch(true),
  unstable__sensitivity: z.array(z.string()).nullish().catch(['unknown']),
});
type Item = z.infer<typeof Item>;
const Page = z.object({ results: z.array(z.unknown()) });

/** Licence in the allowed set, not mature, nothing flagged. Anything unreadable counts as flagged. */
const allowed = (i: Item): i is Item & { license: OpenverseLicense } =>
  isOpenverseLicense(i.license.toLowerCase()) && i.mature !== true && !(i.unstable__sensitivity?.length);

function toHit(raw: unknown): OpenverseHit | null {
  const p = Item.safeParse(raw);
  if (!p.success) return null;
  const i = { ...p.data, license: p.data.license.toLowerCase() };
  if (!allowed(i)) return null;
  const thumbUrl = publicSafeUrl(i.thumbnail);
  if (!thumbUrl) return null;
  const small = i.width && i.height ? Math.min(i.width, i.height) < MIN_EDGE : false;
  return {
    id: i.id,
    title: i.title?.trim() ?? '',
    creator: i.creator?.trim() || null,
    license: i.license,
    licenseVersion: i.license_version ?? '',
    credit: formatOpenverseCredit({ title: i.title ?? null, creator: i.creator ?? null, license: i.license, version: i.license_version ?? null }),
    thumbUrl,
    pageUrl: publicSafeUrl(i.foreign_landing_url),
    width: i.width ?? null,
    height: i.height ?? null,
    usable: i.filetype?.toLowerCase() !== 'svg' && (i.filesize ?? 0) <= MAX_FILE_BYTES && !small,
  };
}

// ---- 24 h result cache: Upstash when configured, else process memory --------------------------

const memory = new Map<string, { exp: number; hits: OpenverseHit[] }>();
let redis: Redis | undefined;

async function cacheGet(key: string): Promise<OpenverseHit[] | null> {
  if (!upstashConfigured()) {
    const m = memory.get(key);
    return m && m.exp > Date.now() ? m.hits : null;
  }
  try {
    return ((await (redis ??= Redis.fromEnv()).get<OpenverseHit[]>(key)) ?? null);
  } catch {
    return null;
  }
}

async function cacheSet(key: string, hits: OpenverseHit[]) {
  if (!upstashConfigured()) {
    memory.set(key, { exp: Date.now() + CACHE_TTL_S * 1000, hits });
    if (memory.size > 200) memory.delete(memory.keys().next().value!);
    return;
  }
  await (redis ??= Redis.fromEnv()).set(key, hits, { ex: CACHE_TTL_S }).catch(() => undefined);
}

/** Test hook. */
export function _resetOpenverseCache() {
  memory.clear();
}

/** Search URL: the licence set, mature=false and format=json (safe-fetch's default Accept is HTML) are always sent. */
export function openverseSearchUrl(q: string, page = 1) {
  const params = new URLSearchParams({
    q, license: OPENVERSE_LICENSES.join(','), mature: 'false', page_size: String(OPENVERSE_PAGE_SIZE), page: String(page), format: 'json',
  });
  return `${API}?${params}`;
}

const normalise = (q: string) => q.replace(/\s+/g, ' ').trim().slice(0, 200);

/**
 * One page of results. `remaining` is today's uncached searches left (null on a cache hit, which
 * costs nothing). Throws CoverSourceError.
 */
export async function searchOpenverse(rawQ: string, opts: { page?: number } = {}) {
  const q = normalise(rawQ);
  if (!q) throw new CoverSourceError('bad_input', 'Type something to search for · 先输入搜索词');
  const page = Math.min(Math.max(1, Math.trunc(opts.page ?? 1) || 1), OPENVERSE_MAX_PAGE);
  const key = `vp:ov:${createHash('sha256').update(`${q.toLowerCase()}\n${page}`).digest('hex').slice(0, 32)}`;
  const cached = await cacheGet(key);
  if (cached) return { hits: cached, remaining: null as number | null, cached: true };

  const budget = await limit('coverOpenverse', 'global');
  if (!budget.success) throw capReached(LIMITS.coverOpenverse.max);
  let body: unknown;
  try {
    body = await safeFetchJson(openverseSearchUrl(q, page), { pinHost: HOST });
  } catch (e) {
    const err = apiError('Openverse', e);
    console.warn('[covers] openverse search failed', err.code, err.status ?? '');
    throw err;
  }
  const parsed = Page.safeParse(body);
  if (!parsed.success) throw new CoverSourceError('unavailable', "Openverse sent something unexpected · Openverse 返回的内容看不懂");
  const hits = parsed.data.results.map(toHit).filter((h): h is OpenverseHit => h !== null);
  await cacheSet(key, hits);
  return { hits, remaining: budget.remaining as number | null, cached: false };
}

/**
 * The image's own record, read again when it is picked: refuses anything outside CC0 / BY / BY-SA,
 * mature or flagged, whatever the search said earlier.
 */
export async function openverseImage(id: string): Promise<OpenverseImage> {
  if (!UUID.test(id)) throw new CoverSourceError('bad_input', 'Not an Openverse image id · 不是 Openverse 图片编号');
  let body: unknown;
  try {
    body = await safeFetchJson(`${API}${id.toLowerCase()}/?format=json`, { pinHost: HOST });
  } catch (e) {
    const err = apiError('Openverse', e);
    console.warn('[covers] openverse detail failed', err.code, err.status ?? '');
    throw err;
  }
  const p = Item.safeParse(body);
  if (!p.success || p.data.id.toLowerCase() !== id.toLowerCase()) {
    throw new CoverSourceError('unavailable', "Openverse sent something unexpected · Openverse 返回的内容看不懂");
  }
  const i = { ...p.data, license: p.data.license.toLowerCase() };
  if (!allowed(i)) {
    throw new CoverSourceError('license', "This image isn't CC0, CC BY or CC BY-SA (or is flagged); not used · 这张图不是 CC0 / BY / BY-SA 许可（或被标记），没有使用");
  }
  const url = i.url && /^https?:\/\//i.test(i.url) ? i.url : null;
  if (!url) throw new CoverSourceError('gone', 'That image is no longer available · 这张图已经不在了');
  return {
    id: i.id, title: i.title ?? null, creator: i.creator ?? null, license: i.license, licenseVersion: i.license_version ?? '',
    url, thumbUrl: publicSafeUrl(i.thumbnail), pageUrl: publicSafeUrl(i.foreign_landing_url),
  };
}
