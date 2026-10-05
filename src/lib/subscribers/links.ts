import { publicOrigin } from '../host';
import type { Locale } from '../taxonomy';
import { linkToken } from './token';

// Absolute links mailed to a subscriber, in their language. Only the HMAC token is in the URL,
// never the address. The one-click URL is the RFC 8058 List-Unsubscribe target (week 14 digest);
// a GET on it only redirects to the manual page, because mail scanners fetch header links.

type Sub = { id: string; tokenVersion: number; locale: Locale };
const prefix = (l: Locale) => (l === 'zh' ? '/zh' : '');

export function subscriberLinks(sub: Sub) {
  const t = linkToken(sub);
  const base = `${publicOrigin()}${prefix(sub.locale)}`;
  return {
    confirm: `${base}/confirm/${t}`,
    prefs: `${base}/prefs/${t}`,
    unsubscribe: `${base}/unsubscribe?t=${t}`,
    oneClick: `${publicOrigin()}/api/unsubscribe?t=${t}`,
  };
}
