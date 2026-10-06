import 'server-only';
import { lookup as dnsLookup, type LookupAddress } from 'node:dns';
import { isIP } from 'node:net';
import ipaddr from 'ipaddr.js';
import { Agent, request } from 'undici';

// The only outbound fetcher (guide「SSRF 规则」). ingest/, covers/ and inbox/ are lint-banned
// from fetch and undici; everything they download comes through here.
//
// Rules: https only, default port only, no credentials in the URL; every hostname is resolved
// and every address checked (ipaddr.js range 'unicast' only); the socket connects to the
// address that was checked (custom lookup, so DNS rebinding can't swap it); redirects are
// followed by hand, at most 3, re-checking each hop; 10 s timeout; byte caps; Chrome UA
// because Eventbrite answers curl-like UAs with 429. Extra request headers (an API key) only go
// to the host they were meant for: `pinHost` refuses any other host, and without it they are
// dropped on a redirect to another host.

export const PLATFORM_HOSTS = [
  'luma.com', 'lu.ma', 'luma.link', 'partiful.com', 'eventbrite.com', 'meetup.com',
  'images.lumacdn.com', 'partiful.imgix.net', 'img.evbuc.com', 'secure-content.meetupstatic.com',
] as const;

const METADATA_HOSTS = new Set(['metadata.google.internal', 'metadata', 'instance-data', 'localhost']);

export const CHROME_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';

const MAX_HOPS = 3;
const TIMEOUT_MS = 10_000;

export type SafeFetchErrorCode =
  | 'bad_url' | 'scheme' | 'port' | 'credentials' | 'blocked_host' | 'blocked_ip' | 'dns'
  | 'redirects' | 'pinned_host' | 'status' | 'content_type' | 'bad_json' | 'too_large' | 'timeout' | 'network';

export class SafeFetchError extends Error {
  constructor(public code: SafeFetchErrorCode, message: string, public status?: number) {
    super(message);
    this.name = 'SafeFetchError';
  }
}

/** True for anything that isn't a plain public unicast address (loopback, RFC1918, link-local/IMDS, ULA, multicast…). */
export function isBlockedIp(ip: string): boolean {
  if (!ipaddr.isValid(ip)) return true;
  let addr = ipaddr.parse(ip);
  if (addr.kind() === 'ipv6' && (addr as ipaddr.IPv6).isIPv4MappedAddress()) addr = (addr as ipaddr.IPv6).toIPv4Address();
  return addr.range() !== 'unicast';
}

function hostOf(url: URL) {
  return url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
}

export function isPlatformHost(host: string) {
  return PLATFORM_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
}

/** Static URL checks; DNS-level checks happen in the socket's lookup. */
export function assertFetchableUrl(raw: string | URL): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new SafeFetchError('bad_url', 'not a URL');
  }
  if (url.protocol !== 'https:') throw new SafeFetchError('scheme', 'only https is allowed');
  if (url.port && url.port !== '443') throw new SafeFetchError('port', 'non-default port');
  if (url.username || url.password) throw new SafeFetchError('credentials', 'credentials in URL');
  const host = hostOf(url);
  if (!host || METADATA_HOSTS.has(host) || host.endsWith('.localhost') || host.endsWith('.internal') || host.endsWith('.local')) {
    throw new SafeFetchError('blocked_host', `host not allowed: ${host}`);
  }
  if (isIP(host) && isBlockedIp(host)) throw new SafeFetchError('blocked_ip', `address not allowed: ${host}`);
  return url;
}

type Resolver = (host: string) => Promise<LookupAddress[]>;
const systemResolver: Resolver = (host) =>
  new Promise((resolve, reject) => dnsLookup(host, { all: true }, (err, addrs) => (err ? reject(err) : resolve(addrs))));

/**
 * net/tls `lookup` replacement: resolves A and AAAA, refuses the host if any answer is
 * non-public (a mixed answer is a rebinding signal), and hands the socket only checked addresses.
 */
export function guardedLookup(resolver: Resolver = systemResolver) {
  return (
    hostname: string,
    options: { all?: boolean; family?: number | string },
    cb: (err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void,
  ) => {
    resolver(hostname).then(
      (addrs) => {
        if (addrs.length === 0) return cb(new SafeFetchError('dns', `no addresses for ${hostname}`) as NodeJS.ErrnoException, '');
        const bad = addrs.find((a) => isBlockedIp(a.address));
        if (bad) return cb(new SafeFetchError('blocked_ip', `${hostname} resolves to ${bad.address}`) as NodeJS.ErrnoException, '');
        const family = options.family === 6 || options.family === 'IPv6' ? 6 : options.family === 4 || options.family === 'IPv4' ? 4 : 0;
        const usable = family ? addrs.filter((a) => a.family === family) : addrs;
        if (usable.length === 0) return cb(new SafeFetchError('dns', `no IPv${family} address for ${hostname}`) as NodeJS.ErrnoException, '');
        if (options.all) cb(null, usable);
        else cb(null, usable[0].address, usable[0].family);
      },
      (err) => cb(new SafeFetchError('dns', `lookup failed for ${hostname}: ${err?.code ?? err}`) as NodeJS.ErrnoException, ''),
    );
  };
}

/**
 * One request, no redirects followed. Swappable in tests. `headers` are the caller's extra
 * request headers (lower-case names) for this hop; the defaults below fill in the rest.
 */
export type Hop = (url: URL, signal: AbortSignal, headers: Record<string, string>) => Promise<{
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: AsyncIterable<Uint8Array> & { destroy?: (err?: Error) => void };
}>;

const DEFAULT_HEADERS: Record<string, string> = {
  'user-agent': CHROME_UA,
  accept: 'text/html,application/xhtml+xml,image/avif,image/webp,image/*;q=0.9,*/*;q=0.8',
  'accept-language': 'en-US,en;q=0.9',
};

let agent: Agent | undefined;
const undiciHop: Hop = async (url, signal, headers) => {
  agent ??= new Agent({ connect: { lookup: guardedLookup(), timeout: TIMEOUT_MS }, headersTimeout: TIMEOUT_MS, bodyTimeout: TIMEOUT_MS });
  const res = await request(url, { dispatcher: agent, method: 'GET', signal, headers: { ...DEFAULT_HEADERS, ...headers } });
  return { status: res.statusCode, headers: res.headers, body: res.body };
};

let hop: Hop = undiciHop;
/** Test seam: replace the single-hop transport. Returns a restore function. */
export function __setHopForTests(h: Hop) {
  hop = h;
  return () => {
    hop = undiciHop;
  };
}

const header = (h: Record<string, string | string[] | undefined>, name: string) => {
  const v = h[name];
  return Array.isArray(v) ? v[0] : v;
};

export type FetchOptions = {
  maxBytes: number;
  acceptPrefix?: string;
  /** Extra request headers (e.g. an API key). Never sent to a host other than the first one. */
  headers?: Record<string, string>;
  /** Only this exact host may be contacted, on the first request and on every redirect. */
  pinHost?: string;
};
export type FetchResult = { url: string; status: number; contentType: string; bytes: Buffer };

async function readCapped(body: AsyncIterable<Uint8Array> & { destroy?: (e?: Error) => void }, maxBytes: number) {
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of body) {
    size += chunk.byteLength;
    if (size > maxBytes) {
      body.destroy?.();
      throw new SafeFetchError('too_large', `response over ${maxBytes} bytes`);
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function drain(body: AsyncIterable<Uint8Array> & { destroy?: (e?: Error) => void }) {
  try {
    body.destroy?.();
  } catch {
    /* already closed */
  }
}

const pinned = (url: URL, pinHost: string | undefined) => {
  if (pinHost && hostOf(url) !== pinHost.toLowerCase()) throw new SafeFetchError('pinned_host', `host not allowed here: ${hostOf(url)}`);
  return url;
};

/** GET with every SSRF rule applied. Throws SafeFetchError. */
export async function safeFetchRaw(raw: string | URL, opts: FetchOptions): Promise<FetchResult> {
  const signal = AbortSignal.timeout(TIMEOUT_MS);
  let url = pinned(assertFetchableUrl(raw), opts.pinHost);
  const firstHost = hostOf(url);
  const extra = Object.fromEntries(Object.entries(opts.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
  try {
    for (let hops = 0; ; hops++) {
      // Extra headers stay with the host they were written for (like a browser's Authorization).
      const res = await hop(url, signal, hostOf(url) === firstHost ? extra : {});
      if (res.status >= 300 && res.status < 400) {
        await drain(res.body);
        const location = header(res.headers, 'location');
        if (!location) throw new SafeFetchError('status', 'redirect without location', res.status);
        if (hops >= MAX_HOPS) throw new SafeFetchError('redirects', `more than ${MAX_HOPS} redirects`);
        url = pinned(assertFetchableUrl(new URL(location, url)), opts.pinHost);
        continue;
      }
      if (res.status < 200 || res.status >= 300) {
        await drain(res.body);
        throw new SafeFetchError('status', `HTTP ${res.status}`, res.status);
      }
      const contentType = (header(res.headers, 'content-type') ?? '').toLowerCase();
      if (opts.acceptPrefix && !contentType.startsWith(opts.acceptPrefix)) {
        await drain(res.body);
        throw new SafeFetchError('content_type', `unexpected content-type ${contentType || '(none)'}`);
      }
      const declared = Number(header(res.headers, 'content-length'));
      if (Number.isFinite(declared) && declared > opts.maxBytes) {
        await drain(res.body);
        throw new SafeFetchError('too_large', `content-length ${declared} over ${opts.maxBytes}`);
      }
      return { url: url.toString(), status: res.status, contentType, bytes: await readCapped(res.body, opts.maxBytes) };
    }
  } catch (err) {
    if (err instanceof SafeFetchError) throw err;
    const e = err as { name?: string; code?: string; cause?: unknown };
    if (e?.cause instanceof SafeFetchError) throw e.cause;
    if (e?.name === 'TimeoutError' || e?.name === 'AbortError' || /TIMEOUT/.test(e?.code ?? '')) {
      throw new SafeFetchError('timeout', `timed out after ${TIMEOUT_MS} ms`);
    }
    throw new SafeFetchError('network', err instanceof Error ? err.message : String(err));
  }
}

/** HTML page (default cap 4 MB). Returns the decoded text and the final URL after redirects. */
export async function safeFetch(url: string | URL, opts: Partial<FetchOptions> = {}) {
  const res = await safeFetchRaw(url, { ...opts, maxBytes: opts.maxBytes ?? 4_000_000 });
  return { url: res.url, status: res.status, contentType: res.contentType, text: res.bytes.toString('utf8') };
}

/** Image bytes (default cap 15 MB, content-type must start with image/). sharp decodes later. */
export async function safeFetchBytes(url: string | URL, opts: Partial<FetchOptions> = {}) {
  const res = await safeFetchRaw(url, { ...opts, maxBytes: opts.maxBytes ?? 15_000_000, acceptPrefix: opts.acceptPrefix ?? 'image/' });
  return res.bytes;
}

/** A JSON API response (default cap 2 MB; asks for and requires application/json). Parsed, not validated. */
export async function safeFetchJson(url: string | URL, opts: Partial<FetchOptions> = {}): Promise<unknown> {
  const res = await safeFetchRaw(url, {
    ...opts,
    maxBytes: opts.maxBytes ?? 2_000_000,
    acceptPrefix: opts.acceptPrefix ?? 'application/json',
    headers: { accept: 'application/json', ...opts.headers },
  });
  try {
    return JSON.parse(res.bytes.toString('utf8'));
  } catch {
    throw new SafeFetchError('bad_json', 'response is not valid JSON');
  }
}
