import { Resend, type WebhookEventPayload } from 'resend';
import { hasDatabase } from '@/lib/db';
import { markFailed } from '@/lib/digest/claim';
import { describeError } from '@/lib/log-safe';
import { suppressEmails, suppressSubscriberIds } from '@/lib/subscribers/service';

// Resend delivery events (PRD F06「退信和投诉自动抑制」): complaints, Resend's own suppressions and
// hard bounces mark the address suppressed for good. Signed with Standard Webhooks (svix-* headers)
// over the raw body. Delivery is at least once and replayable, so the writes are idempotent. Logs
// carry counts, never addresses.
//
// Digest emails (week 14) carry tags kind=digest, issue=<dig_…>, sub=<sub_…>. Only we set tags and
// the payload is signed, so they are trusted: email.failed (accepted, then not delivered, e.g.
// reached_daily_quota) is recorded on that digest_sends row, and a suppressing event also
// suppresses the tagged subscriber by id, an exact primary-key match next to the address match.

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

type DigestTags = { kind: string | null; issue: string | null; sub: string | null };

function digestTags(evt: WebhookEventPayload): DigestTags {
  const raw = (evt.data as { tags?: unknown } | undefined)?.tags;
  const tags = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const pick = (k: string, re: RegExp) => {
    const v = tags[k];
    return typeof v === 'string' && re.test(v) ? v : null;
  };
  return { kind: pick('kind', /^[a-z_]{1,20}$/), issue: pick('issue', /^dig_[0-9a-z]{16}$/), sub: pick('sub', /^sub_[0-9a-z]{16}$/) };
}

/** Resend's failure reason as a short code ('reached_daily_quota'); anything else is 'other'. */
function failedReason(evt: WebhookEventPayload) {
  const reason = (evt.data as { failed?: { reason?: unknown } } | undefined)?.failed?.reason;
  return typeof reason === 'string' && /^[a-z_]{1,40}$/.test(reason) ? reason : 'other';
}

const ok = (body: Record<string, unknown>) => Response.json({ ok: true, ...body }, { headers: { 'cache-control': 'no-store' } });

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

  const tags = digestTags(evt);
  const failed = evt.type === 'email.failed' && tags.kind === 'digest' && tags.issue && tags.sub ? { issue: tags.issue, sub: tags.sub } : null;
  const emails = toSuppress(evt);
  if (!emails && !failed) return ok({});
  // Fail loudly so Resend retries once the database is back, rather than dropping a complaint.
  if (!hasDatabase()) return text('No database', 503);

  if (failed) {
    const reason = failedReason(evt);
    let marked: number;
    try {
      marked = await markFailed(failed.issue, failed.sub, reason);
    } catch (err) {
      console.error(`[webhook:resend] email.failed: digest update failed: ${describeError(err)}`);
      return text('Update failed', 503);
    }
    console.info(`[webhook:resend] email.failed: ${marked} digest send(s) marked failed:${reason}`);
    return ok({ failed: marked });
  }

  const list = emails ?? [];
  let suppressed: number;
  try {
    suppressed = await suppressEmails(list);
    if (tags.sub) suppressed += await suppressSubscriberIds([tags.sub]);
  } catch (err) {
    // The driver's error carries the bound params (the addresses): log the safe summary only.
    console.error(`[webhook:resend] ${evt.type}: suppress failed for ${list.length} recipient(s): ${describeError(err)}`);
    return text('Suppression failed', 503);
  }
  console.info(`[webhook:resend] ${evt.type}: ${suppressed} of ${list.length} recipient(s) suppressed${tags.sub ? ' (tagged subscriber included)' : ''}`);
  return ok({ suppressed });
}
