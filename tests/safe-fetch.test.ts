import { afterEach, describe, expect, it } from 'vitest';
import {
  __setHopForTests, assertFetchableUrl, guardedLookup, isBlockedIp, SafeFetchError, safeFetch, safeFetchBytes, safeFetchJson, type Hop,
} from '@/lib/ingest/safe-fetch';

const code = async (p: Promise<unknown> | (() => unknown)) => {
  try {
    await (typeof p === 'function' ? p() : p);
  } catch (e) {
    return e instanceof SafeFetchError ? e.code : `other:${(e as Error).message}`;
  }
  return 'ok';
};

describe('isBlockedIp', () => {
  it.each([
    '127.0.0.1', '127.1.2.3', '0.0.0.0', '0.1.2.3', '10.0.0.1', '172.16.5.4', '172.31.255.255', '192.168.1.1',
    '169.254.169.254', '100.64.0.1', '224.0.0.1', '255.255.255.255', '::1', '::', 'fc00::1', 'fd12:3456::1',
    'fe80::1', 'ff02::1', '::ffff:127.0.0.1', '::ffff:10.0.0.1', '64:ff9b::a00:1', '2002:7f00:1::', 'not-an-ip',
  ])('blocks %s', (ip) => expect(isBlockedIp(ip)).toBe(true));

  it.each(['8.8.8.8', '104.18.2.1', '172.32.0.1', '2606:4700::6810:1', '::ffff:8.8.8.8'])('allows %s', (ip) =>
    expect(isBlockedIp(ip)).toBe(false),
  );
});

describe('assertFetchableUrl', () => {
  it.each([
    ['http://luma.com/x', 'scheme'],
    ['file:///etc/passwd', 'scheme'],
    ['https://luma.com:8443/x', 'port'],
    ['https://user:pw@luma.com/x', 'credentials'],
    ['https://localhost/x', 'blocked_host'],
    ['https://metadata.google.internal/computeMetadata/v1/', 'blocked_host'],
    ['https://foo.internal/', 'blocked_host'],
    ['https://127.0.0.1/', 'blocked_ip'],
    ['https://0x7f.1/', 'blocked_ip'],
    ['https://2130706433/', 'blocked_ip'],
    ['https://[::1]/', 'blocked_ip'],
    ['https://169.254.169.254/latest/meta-data/', 'blocked_ip'],
    ['nonsense', 'bad_url'],
  ])('%s → %s', async (url, want) => expect(await code(() => assertFetchableUrl(url))).toBe(want));

  it('accepts public https URLs', () => {
    expect(assertFetchableUrl('https://luma.com/g42o84ln').hostname).toBe('luma.com');
    expect(assertFetchableUrl('https://example.org:443/a').port).toBe('');
  });
});

describe('guardedLookup (DNS rebinding guard)', () => {
  const run = (answers: { address: string; family: number }[], opts: { all?: boolean; family?: number } = {}) =>
    new Promise<{ err: unknown; addr: unknown }>((resolve) =>
      guardedLookup(async () => answers)('evil.example', opts, (err, addr) => resolve({ err, addr })),
    );

  it('refuses a host that resolves to a private address', async () => {
    const { err } = await run([{ address: '10.0.0.5', family: 4 }]);
    expect((err as SafeFetchError).code).toBe('blocked_ip');
  });

  it('refuses a mixed public/private answer', async () => {
    const { err } = await run([{ address: '93.184.216.34', family: 4 }, { address: '127.0.0.1', family: 4 }]);
    expect((err as SafeFetchError).code).toBe('blocked_ip');
  });

  it('returns only checked addresses', async () => {
    expect((await run([{ address: '93.184.216.34', family: 4 }])).addr).toBe('93.184.216.34');
    const all = await run([{ address: '93.184.216.34', family: 4 }, { address: '2606:2800::1', family: 6 }], { all: true });
    expect(all.addr).toHaveLength(2);
    const v6 = await run([{ address: '93.184.216.34', family: 4 }, { address: '2606:2800::1', family: 6 }], { family: 6 });
    expect(v6.addr).toBe('2606:2800::1');
  });
});

describe('safeFetch redirects, types and caps', () => {
  let restore: (() => void) | undefined;
  afterEach(() => restore?.());

  const body = (s: string | Buffer) => ({
    async *[Symbol.asyncIterator]() {
      yield typeof s === 'string' ? Buffer.from(s) : s;
    },
    destroy() {},
  });
  const route = (map: Record<string, { status: number; headers?: Record<string, string>; body?: string | Buffer }>) => {
    const seen: string[] = [];
    const hop: Hop = async (url) => {
      seen.push(url.toString());
      const r = map[url.toString()];
      if (!r) throw new Error(`unexpected ${url}`);
      return { status: r.status, headers: r.headers ?? {}, body: body(r.body ?? '') };
    };
    restore = __setHopForTests(hop);
    return seen;
  };

  it('follows up to 3 redirects, re-checking each hop', async () => {
    const seen = route({
      'https://luma.link/a': { status: 301, headers: { location: 'https://lu.ma/b' } },
      'https://lu.ma/b': { status: 302, headers: { location: '/c' } },
      'https://lu.ma/c': { status: 308, headers: { location: 'https://luma.com/c' } },
      'https://luma.com/c': { status: 200, headers: { 'content-type': 'text/html' }, body: '<html>ok</html>' },
    });
    const res = await safeFetch('https://luma.link/a');
    expect(res.url).toBe('https://luma.com/c');
    expect(res.text).toContain('ok');
    expect(seen).toHaveLength(4);
  });

  it('stops after 3 redirects', async () => {
    route({
      'https://a.example/1': { status: 302, headers: { location: 'https://a.example/2' } },
      'https://a.example/2': { status: 302, headers: { location: 'https://a.example/3' } },
      'https://a.example/3': { status: 302, headers: { location: 'https://a.example/4' } },
      'https://a.example/4': { status: 302, headers: { location: 'https://a.example/5' } },
    });
    expect(await code(safeFetch('https://a.example/1'))).toBe('redirects');
  });

  it('refuses a redirect to a private address or to http', async () => {
    route({
      'https://a.example/imds': { status: 302, headers: { location: 'https://169.254.169.254/latest/meta-data/' } },
      'https://a.example/plain': { status: 302, headers: { location: 'http://a.example/x' } },
      'https://a.example/local': { status: 302, headers: { location: 'https://localhost/' } },
    });
    expect(await code(safeFetch('https://a.example/imds'))).toBe('blocked_ip');
    expect(await code(safeFetch('https://a.example/plain'))).toBe('scheme');
    expect(await code(safeFetch('https://a.example/local'))).toBe('blocked_host');
  });

  it('enforces content-type and size caps', async () => {
    route({
      'https://img.example/page': { status: 200, headers: { 'content-type': 'text/html' }, body: '<html>' },
      'https://img.example/big': { status: 200, headers: { 'content-type': 'image/png', 'content-length': '99999999' } },
      'https://img.example/stream': { status: 200, headers: { 'content-type': 'image/png' }, body: Buffer.alloc(2048) },
      'https://img.example/ok': { status: 200, headers: { 'content-type': 'image/png' }, body: Buffer.alloc(16) },
      'https://img.example/gone': { status: 404 },
    });
    expect(await code(safeFetchBytes('https://img.example/page'))).toBe('content_type');
    expect(await code(safeFetchBytes('https://img.example/big'))).toBe('too_large');
    expect(await code(safeFetchBytes('https://img.example/stream', { maxBytes: 1024 }))).toBe('too_large');
    expect((await safeFetchBytes('https://img.example/ok')).byteLength).toBe(16);
    expect(await code(safeFetch('https://img.example/gone'))).toBe('status');
  });
});

describe('safeFetch extra headers, pinHost and JSON (M4 cover sources)', () => {
  let restore: (() => void) | undefined;
  afterEach(() => restore?.());

  const body = (s: string) => ({
    async *[Symbol.asyncIterator]() {
      yield Buffer.from(s);
    },
    destroy() {},
  });
  /** Records the extra headers each hop was asked to send. */
  const route = (map: Record<string, { status: number; headers?: Record<string, string>; body?: string }>) => {
    const sent: { url: string; headers: Record<string, string> }[] = [];
    restore = __setHopForTests(async (url, _signal, headers) => {
      sent.push({ url: url.toString(), headers: { ...headers } });
      const r = map[url.toString()];
      if (!r) throw new Error(`unexpected ${url}`);
      return { status: r.status, headers: r.headers ?? {}, body: body(r.body ?? '') };
    });
    return sent;
  };
  const json = { 'content-type': 'application/json; charset=utf-8' };

  it('sends extra headers (lower-cased) and asks for JSON', async () => {
    const sent = route({ 'https://api.example.org/v1?q=a': { status: 200, headers: json, body: '{"ok":true}' } });
    expect(await safeFetchJson('https://api.example.org/v1?q=a', { headers: { 'X-Subscription-Token': 'k1' } })).toEqual({ ok: true });
    expect(sent[0].headers).toEqual({ accept: 'application/json', 'x-subscription-token': 'k1' });
  });

  it('drops extra headers when a redirect leaves the first host, keeps them on the same host', async () => {
    const sent = route({
      'https://api.example.org/a': { status: 302, headers: { location: '/b' } },
      'https://api.example.org/b': { status: 302, headers: { location: 'https://other.example.net/c' } },
      'https://other.example.net/c': { status: 200, headers: json, body: '[]' },
    });
    await safeFetchJson('https://api.example.org/a', { headers: { 'x-api-key': 'k2' } });
    expect(sent.map((s) => s.headers['x-api-key'] ?? null)).toEqual(['k2', 'k2', null]);
    expect(JSON.stringify(sent[2])).not.toContain('k2');
  });

  it('pinHost refuses another host up front and on any redirect, before the header could travel', async () => {
    const sent = route({
      'https://api.example.org/a': { status: 302, headers: { location: 'https://evil.example.net/steal' } },
      'https://evil.example.net/steal': { status: 200, headers: json, body: '{}' },
    });
    const opts = { headers: { 'x-api-key': 'k3' }, pinHost: 'api.example.org' };
    expect(await code(safeFetchJson('https://api.example.org/a', opts))).toBe('pinned_host');
    expect(await code(safeFetchJson('https://evil.example.net/steal', opts))).toBe('pinned_host');
    expect(sent.map((s) => s.url)).toEqual(['https://api.example.org/a']);
  });

  it('JSON: wrong content-type and unparseable bodies are refused', async () => {
    route({
      'https://api.example.org/html': { status: 200, headers: { 'content-type': 'text/html' }, body: '<html>' },
      'https://api.example.org/bad': { status: 200, headers: json, body: '{nope' },
      'https://api.example.org/429': { status: 429 },
    });
    expect(await code(safeFetchJson('https://api.example.org/html'))).toBe('content_type');
    expect(await code(safeFetchJson('https://api.example.org/bad'))).toBe('bad_json');
    const err = (await safeFetchJson('https://api.example.org/429').then(() => null, (e) => e)) as SafeFetchError;
    expect([err.code, err.status]).toEqual(['status', 429]);
  });

  it('plain fetches send no extra headers', async () => {
    const sent = route({ 'https://img.example.org/a.png': { status: 200, headers: { 'content-type': 'image/png' }, body: 'x' } });
    await safeFetchBytes('https://img.example.org/a.png');
    expect(sent[0].headers).toEqual({});
  });
});
