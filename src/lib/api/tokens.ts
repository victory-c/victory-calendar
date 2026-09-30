import 'server-only';
import { and, eq, isNull } from 'drizzle-orm';
import { db, hasDatabase } from '../db';
import { apiTokens } from '../db/schema';
import { newId } from '../ids';
import { generateToken, hashToken } from './token-hash';

// Personal tokens (guide「鉴权」): `vp_` + 32 random bytes, only the SHA-256 is stored.
// Scopes: ingest (add drafts), publish (mode=publish), candidates (skill push, /api/index).
// Tokens never reach subscriber data: no route that reads subscribers accepts them.

export const SCOPES = ['ingest', 'publish', 'candidates'] as const;
export type Scope = (typeof SCOPES)[number];

export type TokenPrincipal = { kind: 'token'; id: string; name: string; scopes: Scope[] };

/** Creates a token and returns the plaintext once. Used by Settings (week 10) and scripts/token.ts. */
export async function createToken(name: string, scopes: Scope[]) {
  const token = generateToken();
  const id = newId('tok');
  await db.insert(apiTokens).values({ id, name, tokenHash: hashToken(token), scopes });
  return { id, token };
}

export async function revokeToken(id: string) {
  await db.update(apiTokens).set({ revokedAt: new Date() }).where(eq(apiTokens.id, id));
}

/** `Authorization: Bearer vp_…` → principal, or null. Updates last_used_at. */
export async function tokenFrom(req: Request): Promise<TokenPrincipal | null> {
  const m = (req.headers.get('authorization') ?? '').match(/^Bearer\s+(vp_[A-Za-z0-9_-]{20,100})$/);
  if (!m || !hasDatabase()) return null;
  const [row] = await db
    .select()
    .from(apiTokens)
    .where(and(eq(apiTokens.tokenHash, hashToken(m[1])), isNull(apiTokens.revokedAt)));
  if (!row) return null;
  await db.update(apiTokens).set({ lastUsedAt: new Date() }).where(eq(apiTokens.id, row.id));
  return { kind: 'token', id: row.id, name: row.name, scopes: row.scopes.filter((s): s is Scope => (SCOPES as readonly string[]).includes(s)) };
}

export async function listTokens() {
  return db
    .select({ id: apiTokens.id, name: apiTokens.name, scopes: apiTokens.scopes, lastUsedAt: apiTokens.lastUsedAt, revokedAt: apiTokens.revokedAt, createdAt: apiTokens.createdAt })
    .from(apiTokens)
    .orderBy(apiTokens.createdAt);
}
