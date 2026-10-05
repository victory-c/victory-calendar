import { publicOrigin } from '../host';
import type { Locale } from '../taxonomy';
import { linkToken } from './token';

// Absolute links mailed to a subscriber, in their language. Only the HMAC token is in the URL,
// never the address. The one-click URL is the RFC 8058 List-Unsubscribe target; a GET on it only
// redirects to the manual page, because mail scanners fetch header links.

type Sub = { id: string; tokenVersion: number; locale: Locale };
const prefix = (l: Locale) => (l === 'zh' ? '/zh' : '');

/**
 * The same links for any token string. The digest renders each variant once with a placeholder
 * token (digest/render.ts) and swaps in each recipient's real token afterwards.
 */
export function linksFor(locale: Locale, token: string, origin = publicOrigin()) {
  const base = `${origin}${prefix(locale)}`;
  return {
    confirm: `${base}/confirm/${token}`,
    prefs: `${base}/prefs/${token}`,
    unsubscribe: `${base}/unsubscribe?t=${token}`,
    oneClick: `${origin}/api/unsubscribe?t=${token}`,
  };
}

export function subscriberLinks(sub: Sub) {
  return linksFor(sub.locale, linkToken(sub));
}
