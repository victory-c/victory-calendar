import { TZDate } from '@date-fns/tz';
import { cityIn } from '../ingest/regions';
import { normalizeUrl, platformRef } from '../ingest/normalize';

// Pure helpers for the candidate inbox (guide「去重键」): the three dedupe keys and the links a
// calendar entry carries. No I/O here, so the sync and the skill push share exactly one rule.

export const SOURCE_KINDS = ['gcal', 'luma', 'partiful', 'mail', 'skill'] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];

/** Links that never lead to an event page: video calls, maps, calendar chrome. */
const NOT_EVENT = /^(meet\.google\.com|([a-z0-9-]+\.)?zoom\.us|teams\.microsoft\.com|teams\.live\.com|calendar\.google\.com|maps\.google\.com|maps\.app\.goo\.gl|goo\.gl|([a-z0-9-]+\.)?webex\.com|accounts\.google\.com|support\.google\.com)$/;

const MAX_LINKS = 10;

/**
 * Every https link in the entry's text, scrubbed like any ingest URL (invite tokens and tracking
 * parameters dropped, so a secret never lands in the candidates table). Platform links first.
 */
export function extractLinks(...texts: (string | null | undefined)[]): string[] {
  const found = new Set<string>();
  for (const text of texts) {
    if (!text) continue;
    for (const m of text.matchAll(/https?:\/\/[^\s<>"'\\]+/gi)) {
      const raw = m[0].replace(/(&amp;|[).,;:!?\]}>*'"])+$/i, '').replace(/&amp;/gi, '&');
      try {
        const url = normalizeUrl(raw);
        if (NOT_EVENT.test(url.hostname)) continue;
        found.add(url.toString());
      } catch {
        // Not a link we'd ever fetch (credentials, odd scheme): leave it out.
      }
    }
  }
  const links = [...found];
  const isPlatform = (u: string) => platformRef(new URL(u)) !== null;
  return [...links.filter(isPlatform), ...links.filter((u) => !isPlatform(u))].slice(0, MAX_LINKS);
}

/** Tier 1: a platform id. Luma's ICS UID carries the evt- id; otherwise the first platform link. */
export function providerKeyFrom(links: string[], uid: string | null | undefined): string | null {
  const evt = uid?.match(/\b(evt-[A-Za-z0-9]{6,})\b/);
  if (evt) return `luma:${evt[1]}`;
  for (const u of links) {
    const ref = platformRef(new URL(u));
    if (ref) return `${ref.platform}:${ref.externalId}`;
  }
  return null;
}

/** Lowercase, no emoji or punctuation, single spaces. */
export function normTitle(title: string) {
  return title
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\p{P}\p{S}\p{Extended_Pictographic}]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const QUARTER_HOUR = 15 * 60_000;

/** Tier 3: normalised title + start rounded to 15 minutes + city. */
export function fuzzyKey(title: string, start: Date, location: string | null | undefined) {
  const rounded = new Date(Math.round(start.getTime() / QUARTER_HOUR) * QUARTER_HOUR).toISOString();
  return `${normTitle(title)}|${rounded}|${cityIn(location) ?? ''}`;
}

type AttendeeLike = string | { val?: string; params?: Record<string, unknown> } | undefined;

/** ATTENDEE PARTSTAT for one of Victor's addresses, when the feed carries it. */
export function partstatFor(attendee: AttendeeLike | AttendeeLike[], emails: string[]): string | null {
  const wanted = new Set(emails.map((e) => e.trim().toLowerCase()).filter(Boolean));
  if (!attendee || wanted.size === 0) return null;
  for (const a of Array.isArray(attendee) ? attendee : [attendee]) {
    if (!a || typeof a === 'string') continue;
    const addr = String(a.val ?? '').replace(/^mailto:/i, '').toLowerCase();
    const stat = a.params?.PARTSTAT;
    if (wanted.has(addr) && typeof stat === 'string') return stat.toUpperCase();
  }
  return null;
}

/** The link "Add" ingests: the first platform link, else the first other link. */
export function bestLink(links: string[]): string | null {
  return links[0] ?? null;
}

export type SnoozeFor = 'tomorrow' | 'next_week';

/** Snooze ends at 08:00 Bay Area time tomorrow, or on the coming Monday. */
export function snoozeUntil(kind: SnoozeFor, now: Date, tz = 'America/Los_Angeles'): Date {
  const d = new TZDate(now.getTime(), tz);
  const days = kind === 'tomorrow' ? 1 : ((8 - d.getDay()) % 7) || 7;
  d.setDate(d.getDate() + days);
  d.setHours(8, 0, 0, 0);
  return new Date(d.getTime());
}
