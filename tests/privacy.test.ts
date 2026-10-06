import { load } from 'cheerio';
import { eq } from 'drizzle-orm';
import { cloneElement, createElement, isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import en from '../messages/en.json';
import zh from '../messages/zh.json';
import type { OutgoingEmail } from '@/lib/email/send';
import { testDb } from './helpers/pglite';

// /privacy (M3 week 15): the bilingual page, its contact line (D1), the footer link, and the copy
// fixes it depends on (D13). Messages go through next-intl's real formatter, so a broken ICU
// placeholder or rich-text tag fails here, not in production. The code facts the page states are
// pinned at the bottom: change one and this file asks you to change the page too.

const h = vi.hoisted(() => ({ locale: 'en' as 'en' | 'zh', sent: [] as OutgoingEmail[] }));

vi.mock('next-intl/server', async () => {
  const { createTranslator } = await import('next-intl');
  const messages = { en: (await import('../messages/en.json')).default, zh: (await import('../messages/zh.json')).default };
  return {
    getLocale: async () => h.locale,
    getTranslations: async ({ locale, namespace }: { locale: 'en' | 'zh'; namespace: string }) =>
      createTranslator({
        locale,
        messages: messages[locale],
        namespace: namespace as never,
        onError: (e) => {
          throw e;
        },
      }),
  };
});
vi.mock('@/i18n/navigation', () => ({
  // Locale prefixing is next-intl's job; here the raw href is what the component chose.
  Link: ({ href, children, ...rest }: { href: string; children: ReactNode }) => createElement('a', { href, ...rest }, children),
}));
// Only the confirmation-email fact below sends anything; it reads what would have gone to Resend.
vi.mock('@/lib/email/send', async (orig) => ({
  ...(await orig<typeof import('@/lib/email/send')>()),
  sendEmail: async (msg: OutgoingEmail) => {
    h.sent.push(msg);
    return { id: 'test' };
  },
}));
vi.mock('@/components/PageShell', () => ({
  PageShell: ({ children, path }: { children: ReactNode; path: string }) => createElement('main', { 'data-path': path }, children),
}));

const { default: PrivacyPage, generateMetadata } = await import('@/app/[locale]/privacy/page');
const { SiteFooter } = await import('@/components/SiteFooter');

beforeEach(() => {
  h.locale = 'en';
  h.sent = [];
  vi.stubEnv('PUBLIC_HOST', 'picks.example.org');
  vi.stubEnv('PRIVACY_CONTACT_EMAIL', 'privacy@example.org');
  vi.stubEnv('ADMIN_EMAIL', 'owner@example.edu');
});
afterEach(() => vi.unstubAllEnvs());

/** Render a server page outside Next: await async components, then render the rest to HTML. */
async function resolve(node: ReactNode): Promise<ReactNode> {
  if (Array.isArray(node)) return Promise.all(node.map(resolve));
  if (!isValidElement(node)) return node;
  const el = node as ReactElement<{ children?: ReactNode }>;
  if (typeof el.type === 'function' && el.type.constructor.name === 'AsyncFunction') {
    return resolve(await (el.type as (p: unknown) => Promise<ReactNode>)(el.props));
  }
  if (el.props.children === undefined) return el;
  return cloneElement(el, undefined, await resolve(el.props.children));
}

async function page(locale: 'en' | 'zh' = 'en') {
  h.locale = locale;
  const html = renderToStaticMarkup((await resolve(await PrivacyPage())) as ReactElement);
  return { html, $: load(html) };
}

const SECTIONS = {
  en: [
    'Who runs this', 'The short version', 'If you just browse', 'If you subscribe', 'What I use it for', 'Opens and clicks',
    'Services that handle data for me', 'How long I keep things', 'Your choices', 'Do Not Track and Global Privacy Control',
    'For event hosts: takedowns', 'Children, and where this applies', 'Changes',
  ],
  zh: [
    '谁在做这个网站', '简单来说', '如果你只是浏览', '如果你订阅邮件', '用途', '打开与点击', '替我处理数据的服务', '保留多久', '你能做什么',
    '「请勿追踪」与 GPC', '主办方：下架', '儿童与适用范围', '变更',
  ],
};

describe('/privacy', () => {
  it.each(['en', 'zh'] as const)('%s: one h1, one h2 per section in order, the update date as <time>', async (locale) => {
    const { $ } = await page(locale);
    expect($('main').attr('data-path')).toBe('/privacy');
    expect($('h1')).toHaveLength(1);
    expect($('h1').text()).toBe(locale === 'zh' ? '隐私' : 'Privacy');
    expect($('h2').map((_i, el) => $(el).text()).get()).toEqual(SECTIONS[locale]);
    // Every h2 opens its own <section>, which carries the anchor id.
    expect($('section').length).toBe(SECTIONS[locale].length);
    $('section').each((_i, el) => {
      expect($(el).attr('id')).toMatch(/^[a-z]+$/);
      expect($(el).children().first().is('h2')).toBe(true);
    });
    expect($('time').attr('datetime')).toBe('2026-10-06');
    expect($('time').parent().text()).toBe(locale === 'zh' ? '最后更新：2026-10-06' : 'Last updated 2026-10-06');
  });

  it.each(['en', 'zh'] as const)('%s: every placeholder and tag is filled, nothing raw leaks through', async (locale) => {
    const { $ } = await page(locale);
    expect($('main').text()).not.toMatch(/[{}<>]/);
    expect($('code').text()).toBe('NEXT_LOCALE');
    expect($('strong').map((_i, el) => $(el).text()).get()).toEqual(['Vercel', 'Neon', 'Upstash', 'Resend']);
  });

  it('both languages say the same number of things', async () => {
    const shape = async (l: 'en' | 'zh') => {
      const { $ } = await page(l);
      return $('section').map((_i, s) => `${$(s).attr('id')}:${$(s).find('p').length}p/${$(s).find('li').length}li/${$(s).find('a').length}a`).get();
    };
    expect(await shape('zh')).toEqual(await shape('en'));
  });

  it('the contact address is a mailto link under "Who runs this"; later sections point back to it', async () => {
    const { $ } = await page();
    const mail = $('a[href^="mailto:"]');
    expect(mail).toHaveLength(1);
    expect(mail.attr('href')).toBe('mailto:privacy@example.org');
    expect(mail.text()).toBe('privacy@example.org');
    expect(mail.closest('section').attr('id')).toBe('who');
    // In-page links all land somewhere real, and are named for where they go.
    const anchors = $('a[href^="#"]');
    expect(anchors.length).toBe(3); // data requests, takedowns, children
    anchors.each((_i, a) => {
      expect($(`[id="${$(a).attr('href')!.slice(1)}"]`)).toHaveLength(1);
      expect($(a).text()).toBe('Who runs this');
    });
  });

  it.each([
    ['unset', undefined],
    ['blank', ' '],
    ['malformed', 'privacy team'],
  ])('contact %s: the "added before the newsletter opens" line, never the admin address', async (_label, value) => {
    vi.stubEnv('PRIVACY_CONTACT_EMAIL', value);
    for (const l of ['en', 'zh'] as const) {
      const { $, html } = await page(l);
      expect($('a[href^="mailto:"]')).toHaveLength(0);
      expect($('#who').text()).toContain(l === 'zh' ? '邮件周报开放之前' : 'will be added here before the email newsletter opens');
      expect(html).not.toContain('owner@example.edu');
      expect(html).not.toContain('@');
    }
  });

  it('the admin address never appears, even next to a contact address', async () => {
    const { html } = await page('zh');
    expect(html).not.toContain('owner@example.edu');
  });

  it.each(['en', 'zh'] as const)('%s: each processor links its own (English) privacy policy', async (locale) => {
    const { $ } = await page(locale);
    const links = $('#processors li a')
      .map((_i, a) => ({ href: $(a).attr('href'), lang: $(a).attr('hreflang'), text: $(a).text() }))
      .get();
    const suffix = locale === 'zh' ? ' 隐私政策（英文）' : ' privacy policy';
    expect(links).toEqual([
      { href: 'https://vercel.com/legal/privacy-policy', lang: 'en', text: `Vercel${suffix}` },
      { href: 'https://www.databricks.com/legal/privacynotice', lang: 'en', text: `Neon${suffix}` },
      { href: 'https://upstash.com/trust/privacy', lang: 'en', text: `Upstash${suffix}` },
      { href: 'https://resend.com/legal/privacy-policy', lang: 'en', text: `Resend${suffix}` },
    ]);
  });

  it('states the promises the guide and CalOPPA require', async () => {
    const { $ } = await page();
    const text = $('main').text();
    expect(text).toContain("I don't track whether you open an email or which links you click."); // D6
    expect(text).toContain('no third party collects information about your activity over time and across different websites through this site');
    expect(text).toContain('Do Not Track and Global Privacy Control have nothing to switch off');
    expect(text).toContain('Within 24 hours');
    expect(text).toContain('on this site and in future emails'); // the takedown promise is limited to what I control
    expect(text).toContain('children under 13');
    expect(text).toContain('never your email address or anything else about subscribers or visitors'); // AI
  });

  it('metadata: /privacy canonical and hreflang in both languages', async () => {
    h.locale = 'en';
    const enMeta = await generateMetadata();
    expect(enMeta.title).toBe('Privacy');
    expect(enMeta.alternates?.canonical).toBe('https://picks.example.org/privacy');
    expect(enMeta.alternates?.languages).toEqual({
      en: 'https://picks.example.org/privacy',
      'zh-Hans': 'https://picks.example.org/zh/privacy',
      'x-default': 'https://picks.example.org/privacy',
    });
    h.locale = 'zh';
    const zhMeta = await generateMetadata();
    expect(zhMeta.title).toBe('隐私');
    expect(zhMeta.alternates?.canonical).toBe('https://picks.example.org/zh/privacy');
    expect(zhMeta.description).toBe(zh.Privacy.description);
  });
});

describe('footer', () => {
  it.each([
    ['en', 'Privacy'],
    ['zh', '隐私'],
  ] as const)('%s links /privacy with Site.privacy, whether or not the newsletter is open', async (locale, label) => {
    for (const open of ['1', '0']) {
      vi.stubEnv('NEWSLETTER_OPEN', open);
      const $ = load(renderToStaticMarkup(await SiteFooter({ locale })));
      const a = $('footer a[href="/privacy"]');
      expect(a).toHaveLength(1);
      expect(a.text()).toBe(label);
      // Right after About.
      expect(a.prev().attr('href')).toBe('/about');
    }
  });
});

describe('messages', () => {
  const keys = (tree: unknown, prefix = ''): string[] =>
    Object.entries(tree as Record<string, unknown>).flatMap(([k, v]) =>
      v && typeof v === 'object' ? keys(v, `${prefix}${k}.`) : [`${prefix}${k}`],
    );

  it('Privacy has the same keys in both languages and sits right after About', () => {
    expect(keys(zh.Privacy)).toEqual(keys(en.Privacy));
    for (const m of [en, zh]) {
      const order = Object.keys(m);
      expect(order[order.indexOf('About') + 1]).toBe('Privacy');
    }
    expect(en.Newsletter.form.privacyLink).toBe('How I handle your data');
    expect(zh.Newsletter.form.privacyLink).toBeTruthy();
  });

  it('D13: the calendar notes no longer promise cancellation emails (none exist)', () => {
    for (const note of [en.Event.refreshNote, en.Subscribe.refresh]) {
      expect(note).not.toMatch(/email/i);
      expect(note).toContain('marked cancelled');
    }
    for (const note of [zh.Event.refreshNote, zh.Subscribe.refresh]) {
      expect(note).not.toContain('邮件');
      expect(note).toContain('「已取消」');
    }
  });
});

// What the page says about the code, pinned to the code. If one of these fails, update the page
// (messages Privacy.*) and its "Last updated" date in the same change.
describe('the facts /privacy states', () => {
  it('one cookie, NEXT_LOCALE, kept a year', async () => {
    const { LOCALE_COOKIE, LOCALE_COOKIE_MAX_AGE } = await import('@/lib/locale-detect');
    expect(LOCALE_COOKIE).toBe('NEXT_LOCALE');
    expect(LOCALE_COOKIE_MAX_AGE).toBe(365 * 24 * 3600);
    expect(en.Privacy.browse.items.cookie).toContain('for a year');
  });

  it('unconfirmed sign-ups go after 7 days, unsubscribed rows after 12 months; pause is 4 weeks', async () => {
    const { PENDING_TTL_MS, PAUSE_MS, UNSUBSCRIBED_TTL_MS } = await import('@/lib/subscribers/service');
    expect(PENDING_TTL_MS).toBe(7 * 864e5);
    expect(UNSUBSCRIBED_TTL_MS).toBe(365 * 864e5);
    expect(PAUSE_MS).toBe(28 * 864e5);
    expect(en.Privacy.retention.items.pending).toContain('7 days');
    expect(en.Privacy.retention.items.unsubscribed).toContain('12 months');
    expect(en.Privacy.choices.items.prefs).toContain('pause for 4 weeks');
  });

  it('rate-limit counters: hashed keys, windows of at most a day (Upstash keeps a key for two windows)', async () => {
    const { LIMITS } = await import('@/lib/ratelimit');
    for (const name of ['subscribeIp', 'subscribeIpDay', 'subscribeEmail'] as const) {
      expect(['10 m', '1 d']).toContain(LIMITS[name].window);
    }
    expect(en.Privacy.retention.items.limits).toContain('about 2 days');
  });

  // Subscriber rows in an in-memory Postgres (the service functions take the handle as an option).
  const NOW = new Date('2026-10-05T12:00:00Z');
  const DAY = 864e5;
  const signUp = (email: string, ip: string) => ({ email, locale: 'en' as const, categories: ['ai' as const], ip, ua: `ua ${ip}`, source: 'subscribe' });
  async function rows() {
    const { db } = await testDb();
    const { digestIssues, digestSends, subscribers } = await import('@/lib/db/schema');
    const { newId } = await import('@/lib/ids');
    const seed = async (over: Partial<typeof subscribers.$inferInsert>) =>
      (
        await db
          .insert(subscribers)
          .values({ id: newId('sub'), email: 'reader@example.org', status: 'active', locale: 'en', categories: ['ai'], consentAt: NOW, confirmedAt: NOW, createdAt: NOW, ...over })
          .returning()
      )[0];
    const mailed = async (subscriberId: string) => {
      const [issue] = await db.insert(digestIssues).values({ id: newId('dig'), isoWeek: '2026-W40', status: 'sent', sentAt: NOW }).returning();
      await db.insert(digestSends).values({ issueId: issue.id, subscriberId, variantKey: 'en:ai', sentAt: NOW });
    };
    const reload = async (id: string) => (await db.select().from(subscribers).where(eq(subscribers.id, id)))[0];
    const sends = async (id: string) => (await db.select().from(digestSends).where(eq(digestSends.subscriberId, id))).length;
    return { db: db as unknown as import('@/lib/db').DB, seed, mailed, reload, sends };
  }

  it('the sign-up record is the latest request for the address, confirmed or not', async () => {
    const { db, seed, reload } = await rows();
    const { purgeStalePending, requestSubscription } = await import('@/lib/subscribers/service');
    // A former subscriber's address, re-submitted by someone else and never confirmed.
    const former = await seed({ status: 'unsubscribed', consentIp: '198.51.100.1', unsubscribedAt: new Date(NOW.getTime() - 30 * DAY) });
    await requestSubscription(signUp(former.email, '203.0.113.50'), { db, now: NOW });
    expect(await reload(former.id)).toMatchObject({ status: 'pending', consentIp: '203.0.113.50' });
    await purgeStalePending({ db, now: new Date(NOW.getTime() + 8 * DAY) });
    expect(await reload(former.id)).toMatchObject({ status: 'unsubscribed', consentIp: '203.0.113.50' });
    expect(en.Privacy.subscribe.items.consent).toContain('confirmed or not');
    expect(zh.Privacy.subscribe.items.consent).toContain('不论有没有确认');
    for (const m of [en.Privacy.retention.items.unsubscribed, en.Privacy.use.items.proof]) expect(m).not.toContain('what you agreed to');
    expect(zh.Privacy.retention.items.unsubscribed).not.toContain('同意过什么');
  });

  it('the do-not-send list keeps the whole record, sign-up details and send records included, with no end date', async () => {
    const { db, seed, mailed, reload, sends } = await rows();
    const { purgeOldUnsubscribed, purgeStalePending, suppressEmails } = await import('@/lib/subscribers/service');
    const sub = await seed({ consentIp: '198.51.100.2', consentUa: 'Mozilla/5.0 (reader)' });
    await mailed(sub.id);
    await suppressEmails([sub.email], { db, now: NOW });
    const decadeLater = new Date(NOW.getTime() + 10 * 365 * DAY);
    await purgeStalePending({ db, now: decadeLater });
    await purgeOldUnsubscribed({ db, now: decadeLater });
    expect(await reload(sub.id)).toMatchObject({ status: 'suppressed', consentIp: '198.51.100.2', consentUa: 'Mozilla/5.0 (reader)' });
    expect(await sends(sub.id)).toBe(1);
    expect(en.Privacy.retention.items.suppressed).toContain('sign-up IP address and user-agent included, and its send records are kept indefinitely');
    expect(zh.Privacy.retention.items.suppressed).toContain('IP 地址和 user-agent）和发送记录会一直留在');
  });

  it("deleting a do-not-send row lifts my block; Resend's own list is the other half", async () => {
    const { db, seed, reload } = await rows();
    const { deleteSubscriber, requestSubscription, suppressEmails } = await import('@/lib/subscribers/service');
    const sub = await seed({ status: 'suppressed' });
    expect((await deleteSubscriber(sub.id, { db, now: NOW, allowSuppressed: true })).result).toBe('deleted');
    const again = await requestSubscription(signUp(sub.email, '203.0.113.9'), { db, now: NOW });
    if (again.kind !== 'confirm') throw new Error(`expected a confirmation, got ${again.kind}`); // nothing in my database blocks it now
    // But if Resend still lists it, Resend withholds the confirmation and reports email.suppressed,
    // and the webhook suppresses the new row (tests/subscribe-routes.test.ts) with this call:
    await suppressEmails([sub.email], { db, now: NOW });
    expect((await reload(again.sub.id)).status).toBe('suppressed');
    // So the page promises to clear both, and never calls Resend's entry a log or backup.
    expect(en.Privacy.choices.items.suppressed).toContain('A deletion request takes it off both');
    expect(en.Privacy.choices.items.request).toContain("takes your address off Resend's do-not-send list");
    expect(en.Privacy.retention.items.suppressed).toContain('Resend also keeps');
    expect(zh.Privacy.choices.items.suppressed).toContain('从两份名单上都移除');
    expect(zh.Privacy.choices.items.request).toContain('Resend 的「不再发送」名单');
  });

  it('the confirmation email has no preferences or unsubscribe link; the copy promises those for Sunday emails only', async () => {
    vi.stubEnv('SUBSCRIBER_LINK_SECRET', 'test-secret-privacy-0123456789abcdef');
    const { newId } = await import('@/lib/ids');
    const { sendConfirmEmail } = await import('@/lib/email/subscribe');
    await sendConfirmEmail({ id: newId('sub'), email: 'reader@example.org', tokenVersion: 0, locale: 'en', categories: ['ai'] });
    expect(h.sent).toHaveLength(1);
    const [msg] = h.sent;
    expect(msg.text).toContain('/confirm/');
    for (const s of ['/prefs/', '/unsubscribe']) {
      expect(msg.html, s).not.toContain(s);
      expect(msg.text, s).not.toContain(s);
    }
    expect(msg.headers?.['List-Unsubscribe']).toBeUndefined();
    expect(en.Privacy.short.items.leave).toMatch(/^Every Sunday email has a one-click unsubscribe/);
    expect(en.Privacy.choices.items.prefs).toMatch(/^Every Sunday email links to a preferences page/);
    expect(en.Privacy.choices.items.prefs).toContain('The one-time confirmation email has neither');
    expect(zh.Privacy.short.items.leave).toMatch(/^每封周报/);
    expect(zh.Privacy.choices.items.prefs).toContain('一次性的确认邮件没有这些');
  });

  it('a cover can be a tile of host photos, credited "Host photos via <platform>" in emails', async () => {
    const { emailCover } = await import('@/lib/digest/cover');
    const tile = {
      kind: 'host_composite' as const, url400: '', url800: '', url1600: '', thumbhash: '', dominant: '', letterboxed: false,
      attribution: null, license: null, sourcePageUrl: 'https://partiful.com/e/abc',
    };
    const e = { id: 'evt_x', category: 'ai' as const, hostName: 'A host', sourceUrl: 'https://partiful.com/e/abc', cover: tile, coverId: 'cov_x' };
    expect(emailCover(e, 'https://picks.example.org', { keep: new Set(), allToTemplate: false }).credit).toBe('Host photos via Partiful');
    expect(en.Privacy.takedown.items.keep).toContain("a tile made from the hosts' profile photos on the event page");
    expect(en.Privacy.takedown.items.keep).toContain('“Host photos via platform”');
    expect(zh.Privacy.takedown.items.keep).toContain('主办方的头像拼成的图');
    expect(zh.Privacy.takedown.items.keep).toContain('「Host photos via 平台」');
    // The takedown promise covers those too.
    expect(en.Privacy.takedown.items.promise).toContain('made from host photos');
    expect(zh.Privacy.takedown.items.promise).toContain('主办方头像拼图');
  });

  it('a cover can also be an image Victor uploaded or linked by hand: it reaches emails and share cards, so the list names it', async () => {
    const { coverFallsBack } = await import('@/lib/digest/cover');
    const { shareCardAllowed } = await import('@/lib/covers/credit');
    for (const kind of ['upload', 'url'] as const) {
      const cover = {
        kind, url400: '', url800: '', url1600: '', thumbhash: '', dominant: '', letterboxed: false,
        attribution: null, license: null, sourcePageUrl: kind === 'url' ? 'https://example.org/poster.png' : null,
      };
      const e = { id: 'evt_x', category: 'ai' as const, hostName: 'A host', sourceUrl: 'https://lu.ma/x', cover, coverId: 'cov_x' };
      expect(coverFallsBack(e, { keep: new Set(), allToTemplate: true }), kind).toBe(false);
      expect(shareCardAllowed(cover), kind).toBe(true);
    }
    expect(en.Privacy.takedown.items.keep).toContain('an image I uploaded or linked to by hand');
    expect(zh.Privacy.takedown.items.keep).toContain('我手动上传或贴链接的图片');
  });

  it('zh names the Brave credit and the online-only filter as zh readers see them', () => {
    // The event page credits a Brave find with Event.coverVia; Brave covers never reach emails or share cards.
    expect(zh.Event.coverVia).toMatch(/^图片来自 /);
    expect(zh.Privacy.takedown.items.keep).toContain('注明「图片来自」所在网站');
    expect(JSON.stringify(zh.Privacy)).not.toContain('Image via');
    // The /prefs checkbox label, not a name used nowhere else.
    expect(zh.Newsletter.prefs.onlineOnly).toMatch(/^只要线上活动/);
    expect(JSON.stringify(zh.Privacy)).not.toContain('只看线上');
    for (const s of [zh.Privacy.browse.items.feeds, zh.Privacy.subscribe.items.email, zh.Privacy.choices.items.prefs]) {
      expect(s).toContain('「只要线上活动」');
    }
  });

  it('the referrer policy sends other sites only our origin', async () => {
    const { default: config } = await import('../next.config');
    const all = (await config.headers!()).flatMap((r) => r.headers);
    expect(all).toContainEqual({ key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' });
  });
});
