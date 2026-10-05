import { createHmac, timingSafeEqual } from 'node:crypto';

// Subscriber link tokens (guide「约束与索引说明」): `<id>.<base64url(HMAC-SHA256(secret, id:version))>`.
// Computed when a link is sent, recomputed when one is opened; never stored. Bumping
// subscribers.token_version voids every link already sent. No `server-only` and no `@/` imports
// so e2e tests can build links for rows they create.

const ID = /^sub_[0-9a-hjkmnp-tv-z]{16}$/;
const TOKEN = /^(sub_[0-9a-hjkmnp-tv-z]{16})\.([A-Za-z0-9_-]{43})$/;

function secret() {
  const s = process.env.SUBSCRIBER_LINK_SECRET;
  if (!s) throw new Error('SUBSCRIBER_LINK_SECRET is not set');
  return s;
}

const sign = (id: string, version: number) => createHmac('sha256', secret()).update(`${id}:${version}`).digest('base64url');

export function linkToken(sub: { id: string; tokenVersion: number }) {
  if (!ID.test(sub.id)) throw new Error('not a subscriber id');
  return `${sub.id}.${sign(sub.id, sub.tokenVersion)}`;
}

/** The id inside a well-formed token (the signature is checked by verifyToken). */
export function tokenId(token: string | null | undefined): string | null {
  return token ? (TOKEN.exec(token)?.[1] ?? null) : null;
}

/** Constant-time check of a token against the row it names. */
export function verifyToken(token: string, row: { id: string; tokenVersion: number }) {
  const m = TOKEN.exec(token);
  if (!m || m[1] !== row.id) return false;
  const got = Buffer.from(m[2]);
  const want = Buffer.from(sign(row.id, row.tokenVersion));
  return got.length === want.length && timingSafeEqual(got, want);
}
