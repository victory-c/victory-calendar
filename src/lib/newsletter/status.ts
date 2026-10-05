import { hasDatabase } from '../db';

// Whether the email newsletter takes new subscribers. Until mail.<domain> is verified in Resend,
// the shared onboarding sender only reaches the account owner, so on Vercel the form stays closed
// and a visitor is never told "check your inbox" for an email that can't arrive (PROGRESS「待确认」).
// Locally and in CI it is open whenever there is a database and a link secret; sendEmail() writes
// the confirmation to the server log. NEWSLETTER_OPEN=0 closes it anywhere; =1 opens it on Vercel
// without a verified sender (owner testing). Read from env, so a change takes a redeploy, which
// also re-renders the prerendered header link.

export type NewsletterStatus = 'open' | 'closed';

export function newsletterStatus(): NewsletterStatus {
  const flag = process.env.NEWSLETTER_OPEN;
  if (flag === '0') return 'closed';
  if (!hasDatabase() || !process.env.SUBSCRIBER_LINK_SECRET) return 'closed';
  if (flag === '1') return 'open';
  if (!process.env.VERCEL) return 'open';
  return hasVerifiedSender() ? 'open' : 'closed';
}

/** A Resend key plus a From address on our own domain (not the shared resend.dev sender). */
export function hasVerifiedSender() {
  const from = process.env.RESEND_FROM ?? '';
  return Boolean(process.env.RESEND_API_KEY && from && !/@resend\.dev>?\s*$/i.test(from));
}

/**
 * Link pages (/confirm, /prefs, /unsubscribe) and the one-click endpoint keep working while the
 * form is closed: anyone who already got an email must be able to act on it.
 */
export function linksWork() {
  return hasDatabase() && Boolean(process.env.SUBSCRIBER_LINK_SECRET);
}

/**
 * How the digest cron may send. 'live': a verified sender exists. 'dev': off Vercel (local, CI),
 * batches are logged and marked sent with resend_id 'dev'. 'off': on Vercel without a verified
 * sender (today's production), the cron claims nothing, so no one is wrongly recorded as sent.
 * DIGEST_SENDING=0 turns it off anywhere.
 */
export type DigestMode = 'live' | 'dev' | 'off';

export function digestMode(): DigestMode {
  if (process.env.DIGEST_SENDING === '0') return 'off';
  if (hasVerifiedSender()) return 'live';
  return process.env.VERCEL ? 'off' : 'dev';
}
