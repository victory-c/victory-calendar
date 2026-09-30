import { randomBytes } from 'node:crypto';

const ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz'; // Crockford base32, lowercase

/** `evt_4k9x…`: prefix + 16 base32 chars (80 bits). Sortless on purpose; created_at orders rows. */
export function newId(prefix: string, length = 16) {
  const bytes = randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) out += ALPHABET[bytes[i] & 31];
  return `${prefix}_${out}`;
}
