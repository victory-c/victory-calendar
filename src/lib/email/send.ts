import { Resend } from 'resend';

export type OutgoingEmail = {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** Extra headers, e.g. List-Unsubscribe on a digest test send. */
  headers?: Record<string, string>;
  /** Resend tags (name and value: [A-Za-z0-9_-] only). */
  tags?: { name: string; value: string }[];
};

/** Until the mail.<domain> sender is verified, Resend's shared sender only reaches the account owner. */
const DEFAULT_FROM = "Victor's Picks <onboarding@resend.dev>";

/**
 * Transactional send (magic links, alerts). Without RESEND_API_KEY (local dev, CI) the
 * message is written to the server log instead, so flows stay testable.
 */
export async function sendEmail(msg: OutgoingEmail) {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    console.info(`[email:dev] to=${maskEmail(msg.to)} subject=${msg.subject}\n${msg.text}`);
    return { id: 'dev' };
  }
  const resend = new Resend(key);
  const { data, error } = await resend.emails.send({
    from: process.env.RESEND_FROM || DEFAULT_FROM,
    to: msg.to,
    subject: msg.subject,
    html: msg.html,
    text: msg.text,
    ...(msg.headers ? { headers: msg.headers } : {}),
    ...(msg.tags ? { tags: msg.tags } : {}),
  });
  if (error) throw new Error(`resend: ${error.name}: ${error.message}`);
  return { id: data?.id ?? '' };
}

/** Logs never carry full addresses (guide「隐私」). */
export function maskEmail(email: string) {
  const [user, domain] = email.split('@');
  if (!domain) return '***';
  return `${user.slice(0, 1)}***@${domain}`;
}
