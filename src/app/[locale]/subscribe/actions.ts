'use server';

// The subscribe form's only endpoint. A Server Action is a public POST, so nothing from the form
// is trusted: cheap bot checks first, then BotID, then limits before any database write or send.
// Every outcome a visitor could use to learn whether an address is subscribed looks the same
// ({ status: 'pending' }), and nothing user-supplied is echoed back.
import { checkBotId } from 'botid/server';
import { headers } from 'next/headers';
import { after } from 'next/server';
import { hashToken } from '@/lib/api/token-hash';
import { clientIp } from '@/lib/client-ip';
import { maskEmail } from '@/lib/email/send';
import { sendAlreadySubscribedEmail, sendConfirmEmail } from '@/lib/email/subscribe';
import { isEvLang } from '@/lib/events/facets';
import { describeError } from '@/lib/log-safe';
import { alertsMode, newsletterStatus } from '@/lib/newsletter/status';
import { MIN_FILL_MS, type SubscribeState } from '@/lib/newsletter/subscribe-state';
import { hasRoom, limit } from '@/lib/ratelimit';
import { cleanCategories, inboxKey, normalizeEmail, requestSubscription } from '@/lib/subscribers/service';
import type { Locale } from '@/lib/taxonomy';

/** Looks like success to the visitor. Bots and limit hits get it too, with no write and no send. */
const PENDING: SubscribeState = { status: 'pending' };

export async function subscribe(_prev: SubscribeState, formData: FormData): Promise<SubscribeState> {
  let who = 'unknown';
  try {
    // Route params aren't readable here; the form says which language the emails should be in.
    const locale: Locale = formData.get('locale') === 'zh' ? 'zh' : 'en';
    if (newsletterStatus() !== 'open') return { status: 'closed' };

    // Honeypot: hidden from people and assistive tech, so anything in it came from a script.
    const trap = formData.get('website');
    if (trap !== null && trap !== '') return PENDING;

    // Fill time. `t` is when this page view started and `n` the same browser's clock at submit, so
    // a visitor whose clock runs ahead of ours isn't mistaken for a bot; without `n`, use ours.
    const started = Number(formData.get('t') || NaN);
    const sent = Number(formData.get('n') || NaN);
    const elapsed = (Number.isFinite(sent) ? sent : Date.now()) - started;
    if (!Number.isFinite(elapsed) || elapsed < MIN_FILL_MS) return PENDING;

    // A verified crawler is a bot too. Off Vercel (dev, CI, e2e on `next start`) there is no BotID
    // service to ask, so it runs in development mode and always answers human. If the service
    // itself fails (say OIDC is off for the project), carry on: the limits below still bound the
    // damage, and failing closed would turn every real sign-up away.
    try {
      const verdict = await checkBotId({ developmentOptions: { isDevelopment: !process.env.VERCEL } });
      if (verdict.isBot) return { status: 'error', code: 'bot' };
    } catch (err) {
      console.error(`[subscribe] BotID unavailable, continuing without it: ${describeError(err)}`);
    }

    const h = await headers();
    const ip = clientIp(h);
    // Hashed like the inbox key below, so raw IPs never sit in Redis (/privacy says so). Visitors
    // without a usable address share one bucket.
    const ipKey = ip ? hashToken(ip) : 'unknown';
    if (!(await limit('subscribeIp', ipKey)).success) return { status: 'rate_limited' };
    if (!(await limit('subscribeIpDay', ipKey)).success) return { status: 'rate_limited' };

    const email = normalizeEmail(formData.get('email'));
    if (!email) return { status: 'error', code: 'invalid_email', field: 'email' };
    const categories = cleanCategories(formData.getAll('c'));
    if (categories.length === 0) return { status: 'error', code: 'no_category', field: 'categories' };
    // F19 facets ride in hidden fields from a feed menu's /subscribe?ev_lang=&online= link; like the
    // URL itself, an unknown value just means no facet.
    const evLang = formData.get('ev_lang');
    const facets = { evLang: isEvLang(evLang) ? evLang : null, onlineOnly: formData.get('online') === '1' };
    // F20: the form shows the going-alerts box only while alerts can be sent. While they can't, the
    // field is ignored (a stale page can't opt anyone in) and a re-armed row keeps its stored choice.
    const goingAlerts = alertsMode() === 'off' ? undefined : formData.get('alerts') === '1';
    who = maskEmail(email);

    // The day's budget for all subscription email: look first without spending, so a "busy" answer
    // doesn't use up this inbox's own attempts below.
    if (!(await hasRoom('subscribeSend', 'all'))) return { status: 'busy' };
    // 3 per inbox per day (plus-tags and Gmail dots count as the same inbox). Past that, pretend:
    // no "already used" signal, and no mail bombing a stranger's inbox. Hashed, so raw addresses
    // never sit in Redis.
    if (!(await limit('subscribeEmail', hashToken(inboxKey(email)))).success) return PENDING;
    if (!(await limit('subscribeSend', 'all')).success) return { status: 'busy' };

    const out = await requestSubscription({
      email,
      locale,
      categories,
      facets,
      goingAlerts,
      ip,
      ua: h.get('user-agent'),
      source: formData.get('source') === 'zh/subscribe' ? 'zh/subscribe' : 'subscribe',
    });
    // Send after responding, so no outcome (new, already subscribed, suppressed and never mailed)
    // waits on Resend. One small difference is left: an existing active, paused or suppressed row
    // costs one extra query, a weak timing signal capped by the 3-a-day per-inbox limit.
    if (out.kind !== 'none') {
      const send = out.kind === 'confirm' ? sendConfirmEmail : sendAlreadySubscribedEmail;
      const sub = out.sub;
      const masked = who;
      after(() => send(sub).then(
        () => undefined,
        (err) => console.error(`[subscribe] send failed for ${masked}: ${describeError(err)}`),
      ));
    }
    return PENDING;
  } catch (err) {
    console.error(`[subscribe] failed for ${who}: ${describeError(err)}`);
    return { status: 'error', code: 'server' };
  }
}
