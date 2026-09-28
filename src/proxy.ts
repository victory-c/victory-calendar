import createMiddleware from 'next-intl/middleware';
import { NextResponse, type NextRequest } from 'next/server';
import { routing } from './i18n/routing';

const intl = createMiddleware(routing);

// Better Auth session cookie names (plain and __Secure- prefixed on https).
// Week 2 swaps this for `getSessionCookie` from better-auth/cookies.
const SESSION_COOKIES = ['better-auth.session_token', '__Secure-better-auth.session_token'];

export default function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (pathname === '/admin' || pathname.startsWith('/admin/')) {
    // Optimistic redirect only — every Server Action / Route Handler re-checks the session.
    const signedIn = SESSION_COOKIES.some((n) => req.cookies.has(n));
    if (!signedIn && pathname !== '/admin/sign-in') {
      return NextResponse.redirect(new URL('/admin/sign-in', req.url));
    }
    return NextResponse.next();
  }
  return intl(req);
}

export const config = { matcher: ['/((?!api|ics|_next|_vercel|.*\\..*).*)'] };
