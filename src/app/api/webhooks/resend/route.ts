import { Resend, type WebhookEventPayload } from 'resend';
import { hasDatabase } from '@/lib/db';
import { describeError } from '@/lib/log-safe';
import { suppressEmails } from '@/lib/subscribers/service';

// Resend delivery events (PRD F06「退信和投诉自动抑制」): complaints, Resend's own suppressions and
// hard bounces mark the address suppressed for good. Signed with Standard Webhooks (svix-* headers)
// over the raw body. Delivery is at least once and replayable, so the write is idempotent. Logs
// carry counts, never addresses.

const text = (body: string, status: number) =>
  new Response(body, { status, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } });

/** `data.to`, with "Name <a@b.c>" reduced to the address; suppressEmails() normalises the rest. */
const recipients = (to: unknown): string[] =>
  Array.isArray(to)
    ? to.filter((e): e is string => typeof e === 'string').map((e) => /<([^<>]+)>\s*$/.exec(e)?.[1] ?? e)
    : [];

/** Recipients to suppress, or null when the event changes nothing. Soft (Transient) bounces are retried by Resend. */
function toSuppress(evt: WebhookEventPayload): string[] | null {
  switch (evt.type) {
    case 'email.bounced':
      return evt.data?.bounce?.type === 'Transient' ? null : recipients(evt.data?.to);
    case 'email.complained':
    case 'email.suppressed':
      return recipients(evt.data?.to);
    default:
      return null;
  }
}

export async function POST(req: Request) {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) return text('Webhook secret not configured', 503);
  // The signature covers these exact bytes: read them before any parsing.
  const payload = await req.text();
  let evt: WebhookEventPayload;
  try {
    // verify() is local; the client only needs some key to construct.
    evt = new Resend(process.env.RESEND_API_KEY || 're_verify_only').webhooks.verify({
      payload,
      headers: {
        id: req.headers.get('svix-id') ?? '',
        timestamp: req.headers.get('svix-timestamp') ?? '',
        signature: req.headers.get('svix-signature') ?? '',
      },
      webhookSecret: secret,
    });
  } catch {
    return text('Invalid signature', 400);
  }
  // verify() returns whatever JSON was signed (undefined for an empty body).
  if (typeof evt?.type !== 'string') return text('Invalid payload', 400);

  const emails = toSuppress(evt);
  if (!emails) return Response.json({ ok: true }, { headers: { 'cache-control': 'no-store' } });
  // Fail loudly so Resend retries once the database is back, rather than dropping a complaint.
  if (!hasDatabase()) return text('No database', 503);
  let suppressed: number;
  try {
    suppressed = await suppressEmails(emails);
  } catch (err) {
    // The driver's error carries the bound params (the addresses): log the safe summary only.
    console.error(`[webhook:resend] ${evt.type}: suppress failed for ${emails.length} recipient(s): ${describeError(err)}`);
    return text('Suppression failed', 503);
  }
  console.info(`[webhook:resend] ${evt.type}: ${suppressed} of ${emails.length} recipient(s) suppressed`);
  return Response.json({ ok: true, suppressed }, { headers: { 'cache-control': 'no-store' } });
}
