import 'server-only';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { auth, isAdminEmail } from './auth';

/** Server Components / Server Actions: returns the admin session or redirects to sign-in. */
export async function requireAdmin() {
  const h = await headers(); // request-time API first, so prerendering bails before auth is built
  let session: Awaited<ReturnType<typeof auth.api.getSession>> = null;
  try {
    session = await auth.api.getSession({ headers: h });
  } catch (err) {
    // Forged/stale cookie or auth not configured yet: treat as signed out, never as an error page.
    console.warn('[admin] session check failed', err instanceof Error ? err.message : err);
  }
  if (!session || !isAdminEmail(session.user.email)) redirect('/admin/sign-in');
  return session;
}

/** Route Handlers: returns the admin session or null (caller answers 401). */
export async function adminSessionFrom(req: Request) {
  const session = await auth.api.getSession({ headers: req.headers });
  return session && isAdminEmail(session.user.email) ? session : null;
}
