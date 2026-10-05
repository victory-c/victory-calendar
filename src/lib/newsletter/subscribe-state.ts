import { type Category, type Locale, parseCategories } from '../taxonomy';

// Shared by the subscribe Server Action and SubscribeForm. A 'use server' file may only export
// async functions, so the state shape, its initial value and the form's constants live here.

/** What the action tells the form. Never a row and never the address. */
export type SubscribeState =
  | { status: 'idle' }
  /** "Check your inbox". Also the answer for honeypot, fill-time and per-email-limit hits. */
  | { status: 'pending' }
  /** The newsletter closed between page render and submit. */
  | { status: 'closed' }
  /** Per-IP limit (5 per 10 minutes). */
  | { status: 'rate_limited' }
  /** The day's budget for subscription email is spent (global, so it says nothing about any address). */
  | { status: 'busy' }
  | { status: 'error'; code: SubscribeErrorCode; field?: 'email' | 'categories' };

export type SubscribeErrorCode = 'invalid_email' | 'no_category' | 'bot' | 'server';

export const initialSubscribeState: SubscribeState = { status: 'idle' };

/** People need longer than this to type an address; anything faster is a script. */
export const MIN_FILL_MS = 3000;

/** consent_source values: the page the form was on. */
export const SUBSCRIBE_SOURCES = ['subscribe', 'zh/subscribe'] as const;
export type SubscribeSource = (typeof SUBSCRIBE_SOURCES)[number];
export const sourceFor = (locale: Locale): SubscribeSource => (locale === 'zh' ? 'zh/subscribe' : 'subscribe');

/** Set by the confirm route when it sends someone back here. */
export type LinkProblem = 'invalid' | 'expired';

type SearchParams = Record<string, string | string[] | undefined>;

/**
 * `/subscribe?c=ai,vc&link=expired`: the categories to preselect (known slugs only, possibly
 * none) and the link notice to show. Repeated `c` params are merged.
 */
export function parseSubscribeParams(sp: SearchParams): { cats: Category[]; link: LinkProblem | null } {
  const c = Array.isArray(sp.c) ? sp.c.join(',') : sp.c;
  const link = sp.link === 'invalid' || sp.link === 'expired' ? sp.link : null;
  return { cats: parseCategories(c), link };
}
