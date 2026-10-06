import 'server-only';
import { z } from 'zod';
import { publicSafeUrl } from '../ingest/normalize';
import { safeFetchJson } from '../ingest/safe-fetch';
import { LIMITS, limit } from '../ratelimit';
import { viaHost } from './credit';
import { apiError, capReached, CoverSourceError } from './errors';

// Cover selector source 6 (guide「封面图获取」): Brave image search, suggestions only. Only when
// BRAVE_SEARCH_API_KEY is set; safesearch=strict; nothing is cached on our side (Brave's terms
// need a separate plan to store results); 30 searches a day. The key goes in a header that
// safe-fetch sends to api.search.brave.com only (pinHost: any redirect elsewhere is refused).
// Picks are fetched from the image's own host like a pasted link, never with the key.

const HOST = 'api.search.brave.com';
const API = `https://${HOST}/res/v1/images/search`;
export const BRAVE_THUMB_HOST = 'imgs.search.brave.com';

export const braveConfigured = () => Boolean(process.env.BRAVE_SEARCH_API_KEY?.trim());

export type BraveHit = {
  /** Stable within one result list (the image URL). */
  id: string;
  title: string;
  imageUrl: string;
  pageUrl: string;
  thumbUrl: string;
  host: string;
  width: number | null;
  height: number | null;
};

const num = z.number().int().positive().nullish().catch(null);
const Result = z.object({
  title: z.string().nullish().catch(null),
  url: z.string(),
  thumbnail: z.object({ src: z.string() }),
  properties: z.object({ url: z.string(), width: num, height: num }),
  meta_url: z.object({ hostname: z.string().nullish().catch(null) }).nullish().catch(null),
});
const Body = z.object({
  results: z.array(z.unknown()).catch([]),
  extra: z.object({ might_be_offensive: z.boolean().nullish().catch(true) }).nullish().catch(null),
});

export function braveSearchUrl(q: string) {
  return `${API}?${new URLSearchParams({ q, count: '20', safesearch: 'strict' })}`;
}

function toHit(raw: unknown): BraveHit | null {
  const p = Result.safeParse(raw);
  if (!p.success) return null;
  const r = p.data;
  const imageUrl = publicSafeUrl(r.properties.url) && r.properties.url;
  const pageUrl = publicSafeUrl(r.url);
  const thumb = publicSafeUrl(r.thumbnail.src) && r.thumbnail.src;
  if (!imageUrl || !pageUrl || !thumb || new URL(thumb).hostname !== BRAVE_THUMB_HOST) return null;
  return {
    id: imageUrl,
    title: (r.title ?? '').replace(/\s+/g, ' ').trim().slice(0, 200),
    imageUrl, pageUrl, thumbUrl: thumb,
    host: r.meta_url?.hostname?.replace(/^www\./, '') || viaHost(pageUrl) || '',
    width: r.properties.width ?? null,
    height: r.properties.height ?? null,
  };
}

/** One search. Without a key nothing is sent. Throws CoverSourceError. */
export async function searchBrave(rawQ: string) {
  const key = process.env.BRAVE_SEARCH_API_KEY?.trim();
  if (!key) throw new CoverSourceError('not_configured', 'Needs a Brave Search API key · 需要 Brave 搜索 API 密钥');
  const q = rawQ.replace(/\s+/g, ' ').trim().slice(0, 200);
  if (!q) throw new CoverSourceError('bad_input', 'Type something to search for · 先输入搜索词');
  const budget = await limit('coverBrave', 'global');
  if (!budget.success) throw capReached(LIMITS.coverBrave.max);
  let body: unknown;
  try {
    body = await safeFetchJson(braveSearchUrl(q), { headers: { 'x-subscription-token': key }, pinHost: HOST });
  } catch (e) {
    const err = apiError('Brave', e);
    console.warn('[covers] brave search failed', err.code, err.status ?? '');
    throw err;
  }
  const parsed = Body.safeParse(body);
  if (!parsed.success) throw new CoverSourceError('unavailable', 'Brave sent something unexpected · Brave 返回的内容看不懂');
  // Brave flags the whole query; then nothing is shown, whatever the results look like.
  const hits = parsed.data.extra?.might_be_offensive ? [] : parsed.data.results.map(toHit).filter((h): h is BraveHit => h !== null);
  const seen = new Set<string>();
  return { hits: hits.filter((h) => !seen.has(h.id) && seen.add(h.id)), remaining: budget.remaining };
}
