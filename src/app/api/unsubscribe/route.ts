import { connection, NextResponse, type NextRequest } from 'next/server';
import { linksWork } from '@/lib/newsletter/status';
import { disableGoingAlerts, subscriberFromToken, unsubscribeAll } from '@/lib/subscribers/service';
import { tokenId } from '@/lib/subscribers/token';

// RFC 8058 one-click unsubscribe, the List-Unsubscribe target in every newsletter email
// (/api/unsubscribe?t=). POST: the mail provider's one-click. No cookies, no auth, no redirect
// (§3.1); the body is only `List-Unsubscribe=One-Click` and carries nothing we need. The write is
// inline, so a failure is a 5xx the provider retries. GET never changes anything: scanners fetch
// header links (§1), so it only sends people to the manual page, which acts on a button press.
//
// One-click is per list (RFC 8058 §3.2): F20 going alerts carry `&list=going`, which turns off the
// alerts only. Any other `list` value is one we don't know, so it unsubscribes from everything, as
// a link without one always has: an opt-out we can't read is never treated as no opt-out.

const HEADERS = { 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' };

const text = (body: string, status: number) =>
  new Response(body, { status, headers: { ...HEADERS, 'content-type': 'text/plain; charset=utf-8' } });

/** `list=going`, exactly once: the going-alerts list. Anything else means the whole newsletter. */
const goingList = (q: URLSearchParams) => {
  const list = q.getAll('list');
  return list.length === 1 && list[0] === 'going';
};

export async function POST(req: NextRequest) {
  try {
    await req.text();
  } catch {
    // An unreadable body doesn't matter: the token in the URL is the whole request.
  }
  if (!linksWork()) return text('Unavailable. 暂时无法处理。', 503);
  const q = req.nextUrl.searchParams;
  const sub = await subscriberFromToken(q.get('t'));
  if (!sub) return text('Invalid link. 链接无效。', 400);
  if (goingList(q)) {
    await disableGoingAlerts(sub);
    return text('Going alerts off. 已关闭会去提醒。', 200);
  }
  await unsubscribeAll(sub);
  return text('Unsubscribed. 已退订。', 200);
}

export async function GET(req: NextRequest) {
  await connection();
  const q = req.nextUrl.searchParams;
  const t = q.get('t');
  const wellFormed = tokenId(t) !== null;
  // Read only, to land on the subscriber's language; anything odd falls back to English.
  const sub = wellFormed && linksWork() ? await subscriberFromToken(t).catch(() => null) : null;
  const url = new URL(`${sub?.locale === 'zh' ? '/zh' : ''}/unsubscribe`, req.nextUrl.origin);
  if (wellFormed && t) url.searchParams.set('t', t);
  // The manual page then offers "Turn off going alerts" first (and still everything).
  if (wellFormed && goingList(q)) url.searchParams.set('list', 'going');
  return NextResponse.redirect(url, { status: 303, headers: HEADERS });
}

// Link scanners send HEAD; without this export Next would answer HEAD by running GET.
export function HEAD() {
  return new Response(null, { status: 200, headers: HEADERS });
}
