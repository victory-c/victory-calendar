import 'server-only';
import { createElement, type ReactElement } from 'react';
import { render, toPlainText } from 'react-email';
import { COPY, other } from '@/emails/copy';
import { DigestEmail, EmptyNoticeEmail, MSO_SWAPS } from '@/emails/digest';
import { linksFor } from '../subscribers/links';
import type { Locale } from '../taxonomy';
import { introLines } from './fields';
import { selectForVariant } from './select';
import type { DigestLinks, DigestSnapshot, RenderedEmail } from './types';
import type { Variant } from './variant';

// Snapshot + variant → the email (guide「digest 组装」). Each variant is rendered once with the
// placeholder token below in every per-reader link; personalize() swaps in each recipient's real
// token afterwards (html and text), so 90 readers in 40 variants cost 40 renders, not 90. Pure in
// its inputs: the same frozen snapshot always gives byte-identical output, which keeps a retried
// Resend batch identical to the first attempt (same idempotency key ⇒ same payload).
//
// The placeholder may only ever sit in the links built here. personalize() fails closed: a snapshot
// that carries it anywhere (say an RSVP URL ending in /__VP_TOKEN__, which would hand each reader's
// token to that site) is refused, and the placeholder count must match the links we render.

/** Alphanumeric, so it survives HTML attribute escaping, URL encoding and html-to-text untouched. */
export const TOKEN = '__VP_TOKEN__';
/** Gmail clips at 102 KB; this is measured with real tokens in place (see `bytes`). */
export const MAX_HTML_BYTES = 90_000;

/** Thrown when a variant is over MAX_HTML_BYTES (run.ts records 'too_large', not 'render_failed'). */
export class DigestTooLargeError extends Error {
  override name = 'DigestTooLargeError';
}

/** subscribers/token.ts link token: `sub_` + 16 + `.` + 43 base64url chars. */
const REAL_TOKEN_LENGTH = 64;
const TOKEN_SHAPE = /^[A-Za-z0-9._-]+$/;
/**
 * Per-reader links in each part (html and text alike): the footer's preferences, unsubscribe and
 * other-language preferences; the empty notice adds its "add categories" link to preferences.
 */
const LINKS = { digest: 3, empty: 4 } as const;

// Plain-text part: html-to-text upper-cases headings by default (keep Victor's casing), and treats
// layout-table rows as inline, which would run one event into the next; a row is a block here.
// Links print as `label <url>`: react-email's default (no brackets) glues a URL to the text after
// it ("…/prefs/<token>里多选几类。"), and linkifiers that stop only at whitespace then swallow the
// Chinese into the token. Angle brackets are the RFC 3986 delimiters; this later `a` rule wins.
const TEXT_OPTIONS = {
  selectors: [
    ...['h1', 'h2', 'h3'].map((selector) => ({ selector, options: { uppercase: false } })),
    { selector: 'tr', format: 'block', options: { leadingLineBreaks: 2, trailingLineBreaks: 2 } },
    { selector: 'a', options: { linkBrackets: ['<', '>'] as [string, string], hideLinkHrefIfSameAsText: true } },
  ],
};

const count = (haystack: string, needle: string) => haystack.split(needle).length - 1;

/** Links for one email; the digest passes TOKEN, the admin test send a real or dummy token. */
export function digestLinks(snap: DigestSnapshot, locale: Locale, token: string): DigestLinks {
  const own = linksFor(locale, token, snap.origin);
  const o = other(locale);
  const prefix = `${snap.origin}${locale === 'zh' ? '/zh' : ''}`;
  return {
    prefs: own.prefs,
    unsubscribe: own.unsubscribe,
    // ?lang= makes the page offer the one-tap switch; opening the link changes nothing (mail scanners fetch links).
    otherLanguage: `${linksFor(o, token, snap.origin).prefs}?lang=${o}`,
    // The issue's public archive (/weekly, live from the moment the issue starts sending). A
    // snapshot with no events has no archive page (only empty notices go out): the plain week then.
    // Depends on the snapshot only, so a retried batch stays byte-identical.
    web: `${prefix}${snap.events.length ? '/weekly' : '/week'}/${snap.isoWeek}`,
    privacy: `${prefix}/privacy`,
  };
}

function assertSnapshot(snap: DigestSnapshot) {
  if (snap?.version !== 1) throw new Error(`digest snapshot version ${String(snap?.version)} is not supported`);
  if (JSON.stringify(snap).includes(TOKEN)) throw new Error('digest snapshot contains the link placeholder');
}

/** React can't write conditional comments: swap the template's markers for the Outlook-only markup. */
function withMso(html: string) {
  let out = html;
  for (const [marker, markup] of MSO_SWAPS) {
    if (count(out, marker) !== 1) throw new Error(`digest template: expected exactly one ${marker}`);
    out = out.replace(marker, () => markup);
  }
  return out;
}

async function finish(
  element: ReactElement,
  meta: { subject: string; preheader: string; picks: number; going: number },
  links: number,
): Promise<RenderedEmail> {
  const html = withMso(await render(element, { pretty: false }));
  const text = toPlainText(html, TEXT_OPTIONS);
  const found = [count(html, TOKEN), count(text, TOKEN)];
  if (found.some((n) => n !== links)) {
    throw new Error(`digest template: ${found.join(' / ')} placeholder links in html / text, expected ${links}`);
  }
  // Size as delivered: each placeholder becomes a 64-character token.
  const bytes = Buffer.byteLength(html, 'utf8') + links * (REAL_TOKEN_LENGTH - TOKEN.length);
  if (bytes > MAX_HTML_BYTES) throw new DigestTooLargeError(`digest html is ${bytes} bytes (limit ${MAX_HTML_BYTES})`);
  return { ...meta, html, text, bytes };
}

/** The digest for one variant, or null when it has no picks this week (see renderEmptyNotice). */
export async function renderVariant(snap: DigestSnapshot, variant: Variant): Promise<RenderedEmail | null> {
  assertSnapshot(snap);
  const locale = variant.locale;
  const selection = selectForVariant(snap, variant.categories);
  if (selection.picks === 0) return null;
  const going = snap.showAttendance ? selection.going.length : 0;
  const intro = introLines(snap, locale);
  const subject = COPY[locale].subject(selection.picks, going);
  const preheader = intro[0] ?? COPY[locale].defaultPreheader;
  const element = createElement(DigestEmail, {
    locale,
    snap,
    subject,
    preheader,
    intro,
    selection,
    links: digestLinks(snap, locale, TOKEN),
  });
  return finish(element, { subject, preheader, picks: selection.picks, going }, LINKS.digest);
}

/** "Nothing I'd recommend this week": sent at most once a month per reader (claim.ts decides). */
export async function renderEmptyNotice(snap: DigestSnapshot, variant: Variant): Promise<RenderedEmail> {
  assertSnapshot(snap);
  const locale = variant.locale;
  const subject = COPY[locale].emptySubject;
  const preheader = COPY[locale].emptyBody;
  const element = createElement(EmptyNoticeEmail, { locale, snap, subject, preheader, links: digestLinks(snap, locale, TOKEN) });
  return finish(element, { subject, preheader, picks: 0, going: 0 }, LINKS.empty);
}

/**
 * One recipient's copy: every placeholder replaced by their link token, nothing else changed.
 * Refuses an email whose placeholder count isn't exactly the links we render (picks = 0 is the
 * empty notice; renderVariant never returns a digest without picks).
 */
export function personalize(email: RenderedEmail, token: string): { subject: string; html: string; text: string } {
  if (!TOKEN_SHAPE.test(token) || token.includes(TOKEN)) throw new Error('personalize: unexpected token shape');
  const links = email.picks > 0 ? LINKS.digest : LINKS.empty;
  if (count(email.html, TOKEN) !== links || count(email.text, TOKEN) !== links || email.subject.includes(TOKEN)) {
    throw new Error('personalize: unexpected placeholder count');
  }
  const html = email.html.replaceAll(TOKEN, token);
  const text = email.text.replaceAll(TOKEN, token);
  if (html.includes(TOKEN) || text.includes(TOKEN)) throw new Error('personalize: placeholder left in the email');
  const bytes = Buffer.byteLength(html, 'utf8');
  if (bytes > MAX_HTML_BYTES) throw new DigestTooLargeError(`personalize: html is ${bytes} bytes (limit ${MAX_HTML_BYTES})`);
  return { subject: email.subject, html, text };
}
