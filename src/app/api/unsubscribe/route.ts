import { connection, NextResponse, type NextRequest } from 'next/server';
import { linksWork } from '@/lib/newsletter/status';
import { subscriberFromToken, unsubscribeAll } from '@/lib/subscribers/service';
import { tokenId } from '@/lib/subscribers/token';

// RFC 8058 one-click unsubscribe, the List-Unsubscribe target in every digest (/api/unsubscribe?t=).
// POST: the mail provider's one-click. No cookies, no auth, no redirect (§3.1); the body is only
// `List-Unsubscribe=One-Click` and carries nothing we need. The write is inline, so a failure is a
// 5xx the provider retries. GET never changes anything: scanners fetch header links (§1), so it
// only sends people to the manual page, which acts on a button press.

const HEADERS = { 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' };

const text = (body: string, status: number) =>
  new Response(body, { status, headers: { ...HEADERS, 'content-type': 'text/plain; charset=utf-8' } });

export async function POST(req: NextRequest) {
  try {
    await req.text();
  } catch {
    // An unreadable body doesn't matter: the token in the URL is the whole request.
  }
  if (!linksWork()) return text('Unavailable. 暂时无法处理。', 503);
  const sub = await subscriberFromToken(req.nextUrl.searchParams.get('t'));
  if (!sub) return text('Invalid link. 链接无效。', 400);
  await unsubscribeAll(sub);
  return text('Unsubscribed. 已退订。', 200);
}

export async function GET(req: NextRequest) {
  await connection();
  const t = req.nextUrl.searchParams.get('t');
  const wellFormed = tokenId(t) !== null;
  // Read only, to land on the subscriber's language; anything odd falls back to English.
  const sub = wellFormed && linksWork() ? await subscriberFromToken(t).catch(() => null) : null;
  const url = new URL(`${sub?.locale === 'zh' ? '/zh' : ''}/unsubscribe`, req.nextUrl.origin);
  if (wellFormed && t) url.searchParams.set('t', t);
  return NextResponse.redirect(url, { status: 303, headers: HEADERS });
}

// Link scanners send HEAD; without this export Next would answer HEAD by running GET.
export function HEAD() {
  return new Response(null, { status: 200, headers: HEADERS });
}
