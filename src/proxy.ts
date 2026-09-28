import { getSessionCookie } from 'better-auth/cookies';
import createMiddleware from 'next-intl/middleware';
import { NextResponse, type NextRequest } from 'next/server';
import { routing } from './i18n/routing';

const intl = createMiddleware(routing);

export default function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (pathname === '/admin' || pathname.startsWith('/admin/')) {
    // Optimistic redirect only — every Server Action / Route Handler re-checks the session.
    if (!getSessionCookie(req) && pathname !== '/admin/sign-in') {
      return NextResponse.redirect(new URL('/admin/sign-in', req.url));
    }
    return NextResponse.next();
  }
  return intl(req);
}

export const config = { matcher: ['/((?!api|ics|_next|_vercel|.*\\..*).*)'] };
