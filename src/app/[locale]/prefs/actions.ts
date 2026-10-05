'use server';

// Preference center (/prefs/[token]) and manual unsubscribe page (/unsubscribe?t=). Server Actions
// are public endpoints and the bound token comes back from the client, so every call re-verifies
// it against the row's current token_version, validates its fields, and returns a message key:
// never the row, never the address. A successful change calls refresh() so the page re-renders.
import { refresh } from 'next/cache';
import { headers } from 'next/headers';
import { hashToken } from '@/lib/api/token-hash';
import { clientIp } from '@/lib/client-ip';
import { sendConfirmEmail } from '@/lib/email/subscribe';
import { describeError } from '@/lib/log-safe';
import { linksWork } from '@/lib/newsletter/status';
import { limit } from '@/lib/ratelimit';
import {
  cleanCategories, inboxKey, pauseSubscription, resubscribe, resumeSubscription, type Subscriber, subscriberFromToken,
  unsubscribeAll, unsubscribeCategory, updatePreferences,
} from '@/lib/subscribers/service';
import { type Category, isCategory } from '@/lib/taxonomy';

type Common = 'prefs.linkExpired' | 'prefs.statusSuppressed' | 'link.unavailable' | 'state.error';
/** `Newsletter.*` message keys the preference center can show. */
export type PrefsKey =
  | Common | 'prefs.saved' | 'prefs.unsubscribed' | 'prefs.paused' | 'prefs.resumed' | 'prefs.resubscribed' | 'prefs.resubscribePending';
/** `Newsletter.*` message keys the unsubscribe page can show. */
export type UnsubscribeKey = Common | 'unsubscribe.stopped' | 'unsubscribe.done';

type Result<K extends string> = { ok: boolean; key: K; category?: Category };
export type PrefsState = Result<PrefsKey> | null;
export type UnsubscribeState = Result<UnsubscribeKey> | null;

const fail = <K extends string>(key: K) => ({ ok: false, key });

/** Gate shared by every action: link pages working, token valid, row not suppressed. */
async function withSubscriber<K extends string>(
  token: unknown,
  run: (sub: Subscriber) => Promise<Result<K>>,
): Promise<Result<K | Common>> {
  if (!linksWork()) return fail('link.unavailable');
  try {
    const sub = typeof token === 'string' ? await subscriberFromToken(token) : null;
    if (!sub) return fail('prefs.linkExpired');
    if (sub.status === 'suppressed') {
      refresh(); // a stale page still shows controls; re-render it as status only
      return fail('prefs.statusSuppressed');
    }
    return await run(sub);
  } catch (err) {
    console.error(`[prefs] action failed: ${describeError(err)}`);
    return fail('state.error');
  }
}

const editable = (s: Subscriber['status']) => s === 'pending' || s === 'active' || s === 'paused';

/** Language and categories. An empty selection unsubscribes (PRD F06: only the sections you picked). */
export async function savePreferences(token: string, _prev: PrefsState, form: FormData): Promise<PrefsState> {
  return withSubscriber<PrefsKey>(token, async (sub) => {
    const locale = form.get('locale');
    const raw = form.getAll('c');
    const categories = cleanCategories(raw);
    // Something was ticked but none of it is a category: a forged post, not a request to leave.
    if ((locale !== 'en' && locale !== 'zh') || (raw.length > 0 && categories.length === 0)) return fail('state.error');
    if (!editable(sub.status)) {
      refresh(); // stale page: an unsubscribed row comes back only through "Subscribe again"
      return fail('state.error');
    }
    const row = await updatePreferences(sub, { locale, categories });
    refresh();
    return { ok: true, key: row.status === 'unsubscribed' ? 'prefs.unsubscribed' : 'prefs.saved' };
  });
}

/** Pause for 4 weeks / resume. `intent` names the outcome, so a double click can't toggle it back. */
export async function changePause(token: string, _prev: PrefsState, form: FormData): Promise<PrefsState> {
  return withSubscriber<PrefsKey>(token, async (sub) => {
    const intent = form.get('intent');
    const live = sub.status === 'active' || sub.status === 'paused';
    if (intent === 'pause' && live) {
      await pauseSubscription(sub);
      refresh();
      return { ok: true, key: 'prefs.paused' };
    }
    if (intent === 'resume' && live) {
      await resumeSubscription(sub);
      refresh();
      return { ok: true, key: 'prefs.resumed' };
    }
    refresh();
    return fail('state.error');
  });
}

/** Unsubscribe from everything, or come back from an unsubscribed row. */
export async function changeSubscription(token: string, _prev: PrefsState, form: FormData): Promise<PrefsState> {
  return withSubscriber<PrefsKey>(token, async (sub) => {
    const intent = form.get('intent');
    if (intent === 'unsubscribe') {
      await unsubscribeAll(sub);
      refresh();
      return { ok: true, key: 'prefs.unsubscribed' };
    }
    if (intent !== 'resubscribe') return fail('state.error');
    if (sub.status !== 'unsubscribed') {
      // Double click or stale page: already back. A pending row already has its confirmation email.
      refresh();
      return { ok: true, key: sub.status === 'pending' ? 'prefs.resubscribePending' : 'prefs.resubscribed' };
    }
    // Coming back is a new consent: record when, from where and through which page.
    const h = await headers();
    const r = await resubscribe(sub, { ip: clientIp(h), ua: h.get('user-agent'), source: 'prefs' });
    refresh();
    if (!r.needsConfirm) return { ok: true, key: 'prefs.resubscribed' };
    // Same per-inbox budget as the form, and the same daily budget for all subscription email. Past
    // either, an earlier confirmation email (same link, token_version unchanged) is still valid.
    const perInbox = await limit('subscribeEmail', hashToken(inboxKey(r.sub.email)));
    if (perInbox.success && (await limit('subscribeSend', 'all')).success) await sendConfirmEmail(r.sub);
    return { ok: true, key: 'prefs.resubscribePending' };
  });
}

/** /unsubscribe buttons: `c` is a category slug or "all". Repeating a press changes nothing. */
export async function unsubscribeFrom(token: string, _prev: UnsubscribeState, form: FormData): Promise<UnsubscribeState> {
  return withSubscriber<UnsubscribeKey>(token, async (sub) => {
    const c = form.get('c');
    if (c === 'all') {
      await unsubscribeAll(sub);
      refresh();
      return { ok: true, key: 'unsubscribe.done' };
    }
    if (!isCategory(c)) return fail('state.error');
    const row = await unsubscribeCategory(sub, c);
    refresh();
    return row.status === 'unsubscribed' ? { ok: true, key: 'unsubscribe.done' } : { ok: true, key: 'unsubscribe.stopped', category: c };
  });
}
