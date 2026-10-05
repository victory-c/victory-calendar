import 'server-only';
import { normalizeEmail } from '../subscribers/service';

// Seed inboxes for the pre-send deliverability check (guide「发送前」: one copy each to gmail.com,
// icloud.com, outlook.com, qq.com and 163.com; the G3 gate wants zero seed bounces). The addresses
// live only in DIGEST_SEED_EMAILS (sensitive on Vercel): the editor, messages and jobs_log show
// domains, never an address. Seeds are not subscribers; digest-actions.ts sends them the variant on
// preview with dummy links.

export const MAX_SEEDS = 10;
export const EXPECTED_SEED_DOMAINS = ['gmail.com', 'icloud.com', 'outlook.com', 'qq.com', '163.com'] as const;

export type Seeds = {
  /** Normalised, deduplicated, in the order given, at most MAX_SEEDS. */
  emails: string[];
  /** Entries that are not an address (ignored). */
  invalid: number;
  /** Valid addresses past MAX_SEEDS (ignored). */
  extra: number;
};

/** DIGEST_SEED_EMAILS: comma-separated like INBOX_EMAILS (semicolons and white space tolerated). */
export function seedEmails(raw = process.env.DIGEST_SEED_EMAILS): Seeds {
  const seen = new Set<string>();
  let invalid = 0;
  for (const part of (raw ?? '').split(/[,;\s]+/).filter(Boolean)) {
    const email = normalizeEmail(part);
    if (email) seen.add(email);
    else invalid++;
  }
  const all = [...seen];
  return { emails: all.slice(0, MAX_SEEDS), invalid, extra: Math.max(0, all.length - MAX_SEEDS) };
}

/** The domain of a normalised address. */
export const domainOf = (email: string) => email.slice(email.lastIndexOf('@') + 1);

/** Unique domains, sorted, and which of the guide's five have no seed. */
export function seedCoverage(emails: readonly string[]) {
  const domains = [...new Set(emails.map(domainOf))].sort();
  return { domains, missing: EXPECTED_SEED_DOMAINS.filter((d) => !domains.includes(d)) };
}
