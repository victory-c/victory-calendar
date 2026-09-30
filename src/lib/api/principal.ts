import 'server-only';
import { adminSessionFrom } from '../admin-session';
import { type Scope, SCOPES, tokenFrom, type TokenPrincipal } from './tokens';

export type Principal = TokenPrincipal | { kind: 'session'; id: 'session'; name: 'admin'; scopes: Scope[] };

/** Session cookie (Victor in the PWA) or a Bearer vp_ token. Server Functions bypass proxy, so every handler calls this. */
export async function principalFrom(req: Request): Promise<Principal | null> {
  if (req.headers.get('authorization')) return tokenFrom(req);
  try {
    const session = await adminSessionFrom(req);
    if (session) return { kind: 'session', id: 'session', name: 'admin', scopes: [...SCOPES] };
  } catch (err) {
    console.warn('[api] session check failed', err instanceof Error ? err.message : err);
  }
  return null;
}
