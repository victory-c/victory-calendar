import { licenseUrl } from '../covers/credit';
import { platformName } from '../events/platform';
import type { PublicEvent } from '../events/types';

// Which picture an event gets in the email. Pure. Email clients need PNG/JPEG (Outlook for Windows
// can't show the WebP covers stored in Blob), so nothing here points at a stored cover URL:
//   - the typographic template, drawn on demand at 192 px without the host line (at 96 px only the
//     colour field and glyph read), for template covers, missing covers, and official covers we
//     may not use in email;
//   - otherwise a 192 px JPEG of the real cover, keyed by cover id (/og/email-cover/[coverId]).
// Official covers of Luma events (the official image and the composite of Luma host avatars) fall
// back to the template unless Victor kept them for this issue (guide「封面图获取」: Luma 来源 →
// template), and the official_covers_to_template switch forces every official cover to the template.
// "Luma-sourced" goes by where the image came from (the cover's source page) as well as the event's
// current link, so editing the link to the host's own page doesn't sneak a Luma image into the email.
// Brave search finds (licence unknown) always fall back too; Openverse and AI covers are used with
// their stored credit. An Openverse credit also carries the work's page and the licence deed, which
// the email links it to (CC BY / BY-SA 2.0 §4(a): the licence URI goes with every copy).

export const EMAIL_COVER_PX = 192;

export type EmailCoverInput = Pick<PublicEvent, 'id' | 'category' | 'hostName' | 'sourceUrl' | 'cover'> & {
  /** covers.id of `cover`; without it a real cover can't be served and the template is used. */
  coverId?: string | null;
};

export type EmailCoverOptions = {
  /** Event ids whose Luma official cover Victor kept for this issue (digest_issues.keep_cover_ids). */
  keep: ReadonlySet<string>;
  /** settings.official_covers_to_template. */
  allToTemplate: boolean;
};

export function templateEmailUrl(origin: string, category: PublicEvent['category']) {
  return `${trimOrigin(origin)}/og/template/${category}?s=${EMAIL_COVER_PX}`;
}

/** The cover came from Luma, or the event still points at Luma. */
function fromLuma(e: Pick<PublicEvent, 'sourceUrl' | 'cover'>): boolean {
  const page = e.cover?.sourcePageUrl;
  return (page ? platformName(page) === 'Luma' : false) || platformName(e.sourceUrl) === 'Luma';
}

/** True when the event's own cover would be replaced by the template in this issue. */
export function coverFallsBack(e: EmailCoverInput, opts: EmailCoverOptions): boolean {
  const c = e.cover;
  if (!c || c.kind === 'template' || c.kind === 'brave' || !e.coverId) return true;
  const official = c.kind === 'official' || c.kind === 'host_composite';
  if (!official) return false;
  if (opts.allToTemplate) return true;
  return fromLuma(e) && !opts.keep.has(e.id);
}

/**
 * True for the events the editor lists under "keep official cover in this email": a Luma
 * official cover that only the keep toggle stands between it and the template.
 */
export function isKeepableLumaCover(e: Pick<PublicEvent, 'sourceUrl' | 'cover'>, allToTemplate: boolean): boolean {
  const c = e.cover;
  return Boolean(c && !allToTemplate && (c.kind === 'official' || c.kind === 'host_composite') && fromLuma(e));
}

export type EmailCover = {
  url: string;
  credit: string | null;
  /** Openverse only, when known: the work's page and the licence deed the credit links to. */
  sourceUrl?: string;
  licenseUrl?: string;
};

export function emailCover(e: EmailCoverInput, origin: string, opts: EmailCoverOptions): EmailCover {
  if (coverFallsBack(e, opts)) return { url: templateEmailUrl(origin, e.category), credit: null };
  const c = e.cover!;
  const url = `${trimOrigin(origin)}/og/email-cover/${encodeURIComponent(e.coverId!)}`;
  const out: EmailCover = { url, credit: credit(e, c) };
  if (c.kind === 'openverse') {
    const deed = licenseUrl(c.license);
    if (c.sourcePageUrl) out.sourceUrl = c.sourcePageUrl;
    if (deed) out.licenseUrl = deed;
  }
  return out;
}

/**
 * The stored attribution first (it is what the site shows); official covers always carry one.
 * Otherwise name the platform the image came from, falling back to the event's link.
 */
function credit(e: EmailCoverInput, c: NonNullable<PublicEvent['cover']>): string | null {
  const stored = c.attribution?.trim();
  if (stored) return stored;
  const platform = (c.sourcePageUrl ? platformName(c.sourcePageUrl) : null) ?? platformName(e.sourceUrl) ?? 'the web';
  if (c.kind === 'official') return `Cover: ${e.hostName?.trim() || platform} via ${platform}`;
  if (c.kind === 'host_composite') return `Host photos via ${platform}`;
  return null;
}

const trimOrigin = (origin: string) => origin.replace(/\/+$/, '');
