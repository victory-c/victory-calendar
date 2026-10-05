import { getSessionCookie } from 'better-auth/cookies';
import createMiddleware from 'next-intl/middleware';
import { NextRequest, NextResponse } from 'next/server';
import { routing } from './i18n/routing';
import { LOCALE_COOKIE, LOCALE_COOKIE_MAX_AGE, preferredLocale, safeReturnPath } from './lib/locale-detect';

const intl = createMiddleware(routing);

export default function proxy(req: NextRequest) {
  const { pathname, searchParams } = req.nextUrl;

  // Language switch: the only place the one-year NEXT_LOCALE cookie is written (PRD §9).
  if (pathname === '/_locale') {
    const locale = searchParams.get('l') === 'zh' ? 'zh' : 'en';
    const origin = req.nextUrl.origin;
    const target = new URL(safeReturnPath(searchParams.get('to'), origin), origin);
    // Belt and braces: never emit a Location that leaves this origin.
    const res = NextResponse.redirect(target.origin === origin ? target : new URL('/', origin), 307);
    res.cookies.set(LOCALE_COOKIE, locale, { path: '/', maxAge: LOCALE_COOKIE_MAX_AGE, sameSite: 'lax' });
    return res;
  }

  if (pathname === '/admin' || pathname.startsWith('/admin/')) {
    // Optimistic redirect only — every Server Action / Route Handler re-checks the session.
    if (!getSessionCookie(req) && pathname !== '/admin/sign-in') {
      return NextResponse.redirect(new URL('/admin/sign-in', req.url));
    }
    return NextResponse.next();
  }

  // next-intl's own cookie is off (it would pin the language on any /zh link someone shares).
  // Hand it our decision — switch cookie first, else the first Accept-Language choice (zh* → zh).
  const headers = new Headers(req.headers);
  headers.set('accept-language', preferredLocale(req.headers.get('accept-language'), req.cookies.get(LOCALE_COOKIE)?.value));
  return intl(new NextRequest(req.url, { headers, method: req.method }));
}

// Anchored exclusions: /api, /ics and /og are skipped only as whole first segments, and so is the
// BotID prefix (botid/next/config rewrites it to Vercel; a locale rewrite would 404 the challenge).
// Paths with a dot are files, except subscriber link tokens (`sub_….<sig>`): the confirm and prefs
// entries send those through next-intl too, or /confirm/<token> would never reach [locale].
export const config = {
  matcher: [
    '/((?!(?:api|ics|og|_next|_vercel|149e9513-01fa-4fb0-aad4-566afd725d1b)(?:/|$)|.*\\..*).*)',
    '/confirm/:path*',
    '/zh/confirm/:path*',
    '/prefs/:path*',
    '/zh/prefs/:path*',
  ],
};
