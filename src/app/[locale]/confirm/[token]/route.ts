import { connection, NextResponse, type NextRequest } from 'next/server';
import { linksWork } from '@/lib/newsletter/status';
import { confirmSubscription } from '@/lib/subscribers/service';

// GET /confirm/<token> and /zh/confirm/<token>, the double opt-in link (guide「订阅到退订的流程」):
// pending → active, then a 303 to a page. A Route Handler rather than a page so the write only
// happens on a real request, never in a prerender or a prefetch. Safe to repeat.

type Ctx = { params: Promise<{ locale: string; token: string }> };

const HEADERS = { 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' };

const see = (req: NextRequest, path: string) =>
  NextResponse.redirect(new URL(path, req.nextUrl.origin), { status: 303, headers: HEADERS });

export async function GET(req: NextRequest, ctx: Ctx) {
  await connection();
  const { locale, token } = await ctx.params;
  if (locale !== 'en' && locale !== 'zh') return new Response('Not found', { status: 404, headers: HEADERS });
  const prefix = locale === 'zh' ? '/zh' : '';
  if (!linksWork()) return see(req, `${prefix}/subscribe?link=invalid`);

  const { result } = await confirmSubscription(token);
  switch (result) {
    case 'confirmed':
      return see(req, `${prefix}/prefs/${token}?welcome=1`);
    case 'already':
      return see(req, `${prefix}/prefs/${token}?welcome=already`);
    case 'expired':
      return see(req, `${prefix}/subscribe?link=expired`);
    default:
      return see(req, `${prefix}/subscribe?link=invalid`);
  }
}

// Mail link scanners send HEAD; without this export Next would answer HEAD by running GET.
export function HEAD() {
  return new Response(null, { status: 200, headers: HEADERS });
}
