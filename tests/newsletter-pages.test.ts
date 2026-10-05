import { load } from 'cheerio';
import { cloneElement, createElement, isValidElement, type ReactElement, type ReactNode, Suspense } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Week 13 token pages (/prefs/[token], /unsubscribe) and the /subscribe shell: the pure view logic
// in lib/newsletter/prefs-view, and what the pages and shared controls render from it. Server
// actions, the subscriber service and newsletter status are stubbed: those have their own tests.
const h = vi.hoisted(() => ({
  locale: 'en' as 'en' | 'zh',
  open: true,
  sub: null as unknown,
}));

vi.mock('next-intl/server', () => ({
  getLocale: async () => h.locale,
  // Interpolated values are appended, so a test can see which date or category went in.
  getTranslations:
    async ({ locale, namespace }: { locale: string; namespace: string }) =>
    (key: string, values?: Record<string, unknown>) =>
      `${locale}:${namespace}.${key}${values ? ` ${Object.values(values).join(' ')}` : ''}`,
}));
vi.mock('next/server', async (orig) => ({ ...(await orig()), connection: async () => {} }));
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, prefetch: _p, ...rest }: { href: string; children: ReactNode; prefetch?: boolean }) =>
    createElement('a', { href, ...rest }, children),
}));
vi.mock('@/components/PageShell', () => ({
  PageShell: ({ children }: { children: ReactNode }) => createElement('main', null, children),
}));
vi.mock('@/components/SubscribeMenu', () => ({ SubscribeMenu: () => createElement('details', { id: 'subscribe' }) }));
vi.mock('@/lib/newsletter/status', () => ({ newsletterStatus: () => (h.open ? 'open' : 'closed'), linksWork: () => true }));
// The row is already a view here: the pages only pass it through viewOf.
vi.mock('@/lib/subscribers/service', () => ({
  subscriberFromToken: async (token: string) => (token === 'good' ? h.sub : null),
  viewOf: (sub: unknown) => sub,
}));
vi.mock('@/app/[locale]/subscribe/actions', () => ({ subscribe: async () => ({ status: 'idle' }) }));
vi.mock('@/app/[locale]/prefs/actions', () => ({
  savePreferences: async () => null,
  changeLanguage: async () => null,
  changePause: async () => null,
  changeSubscription: async () => null,
  unsubscribeFrom: async () => null,
}));

const { effectiveStatus, longDate, unsubscribeChoices, welcomeBanner } = await import('@/lib/newsletter/prefs-view');
const { CategoryCheckboxes } = await import('@/components/CategoryCheckboxes');
const { LinkProblem } = await import('@/components/LinkProblem');
const { SubscribeForm } = await import('@/components/SubscribeForm');
const { default: PrefsPage } = await import('@/app/[locale]/prefs/[token]/page');
const { default: UnsubscribePage } = await import('@/app/[locale]/unsubscribe/page');
const { default: SubscribePage } = await import('@/app/[locale]/subscribe/page');
type View = import('@/lib/subscribers/service').SubscriberView;

beforeEach(() => {
  h.locale = 'en';
  h.open = true;
  h.sub = null;
});

const view = (over: Partial<View> = {}): View => ({ status: 'active', locale: 'en', categories: ['ai', 'vc'], pausedUntil: null, ...over });

// ---- prefs-view ---------------------------------------------------------------------------------

describe('effectiveStatus', () => {
  const now = new Date('2026-10-04T12:00:00Z');

  it('a pause that has not ended stays paused, with its end date', () => {
    const out = effectiveStatus(view({ status: 'paused', pausedUntil: '2026-11-01T12:00:00.000Z' }), now);
    expect(out.status).toBe('paused');
    expect(out.pausedUntil?.toISOString()).toBe('2026-11-01T12:00:00.000Z');
  });

  it('an expired pause, one ending right now, or one without an end counts as active', () => {
    expect(effectiveStatus(view({ status: 'paused', pausedUntil: '2026-10-01T00:00:00.000Z' }), now).status).toBe('active');
    expect(effectiveStatus(view({ status: 'paused', pausedUntil: now.toISOString() }), now).status).toBe('active');
    expect(effectiveStatus(view({ status: 'paused', pausedUntil: null }), now)).toEqual({ status: 'active', pausedUntil: null });
  });

  it('every other status passes through', () => {
    for (const status of ['pending', 'active', 'unsubscribed', 'suppressed'] as const) {
      expect(effectiveStatus(view({ status }), now).status).toBe(status);
    }
  });
});

describe('welcomeBanner', () => {
  it('?welcome=1 greets only an active row', () => {
    expect(welcomeBanner('1', 'active')).toBe('prefs.welcome');
    for (const status of ['pending', 'paused', 'unsubscribed', 'suppressed'] as const) expect(welcomeBanner('1', status)).toBeNull();
  });

  it('?welcome=already shows while the row is active or paused', () => {
    expect(welcomeBanner('already', 'active')).toBe('prefs.already');
    expect(welcomeBanner('already', 'paused')).toBe('prefs.already');
    expect(welcomeBanner('already', 'unsubscribed')).toBeNull();
    expect(welcomeBanner('already', 'pending')).toBeNull();
  });

  it('no banner without the param, for other values, or for a repeated param', () => {
    expect(welcomeBanner(undefined, 'active')).toBeNull();
    expect(welcomeBanner('yes', 'active')).toBeNull();
    expect(welcomeBanner(['1'], 'active')).toBeNull();
  });
});

describe('unsubscribeChoices', () => {
  it('one button per category when there are several', () => {
    expect(unsubscribeChoices(view({ categories: ['ai', 'vc', 'social'] }))).toEqual(['ai', 'vc', 'social']);
    expect(unsubscribeChoices(view({ status: 'paused', categories: ['ai', 'vc'] }))).toEqual(['ai', 'vc']);
    expect(unsubscribeChoices(view({ status: 'pending', categories: ['ai', 'vc'] }))).toEqual(['ai', 'vc']);
  });

  it('none with a single category, and none once unsubscribed or suppressed', () => {
    expect(unsubscribeChoices(view({ categories: ['ai'] }))).toEqual([]);
    expect(unsubscribeChoices(view({ status: 'unsubscribed', categories: ['ai', 'vc'] }))).toEqual([]);
    expect(unsubscribeChoices(view({ status: 'suppressed', categories: ['ai', 'vc'] }))).toEqual([]);
  });
});

describe('longDate', () => {
  it('is the Pacific date, not the server one (this runner is on UTC)', () => {
    // 2026-10-31 22:00 PDT, already November 1 in UTC.
    const d = new Date('2026-11-01T05:00:00Z');
    expect(longDate(d, 'en')).toBe('October 31, 2026');
    expect(longDate(d, 'zh')).toBe('2026年10月31日');
  });
});

// ---- pages --------------------------------------------------------------------------------------

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
const html = async (page: Promise<ReactNode>) => load(renderToStaticMarkup((await resolve(await page)) as ReactElement));

type Boundary = ReactElement<{ fallback?: ReactNode; children?: ReactNode }>;
function findSuspense(node: ReactNode): Boundary | null {
  if (Array.isArray(node)) return node.map(findSuspense).find(Boolean) ?? null;
  if (!isValidElement(node)) return null;
  const el = node as Boundary;
  return el.type === Suspense ? el : findSuspense(el.props.children);
}
/** The page's Suspense fallback (what a visitor without JS keeps seeing), parsed. */
async function fallback(page: Promise<ReactNode>) {
  const boundary = findSuspense(await page);
  if (!boundary) throw new Error('no Suspense boundary');
  return load(renderToStaticMarkup(boundary.props.fallback as ReactElement), null, false);
}

const prefsPage = (sp: Record<string, string> = {}, token = 'good') =>
  PrefsPage({ params: Promise.resolve({ token }), searchParams: Promise.resolve(sp) });
const unsubscribePage = (sp: Record<string, string> = { t: 'good' }) => UnsubscribePage({ searchParams: Promise.resolve(sp) });
const subscribePage = () => SubscribePage({ searchParams: Promise.resolve({}) });

describe('noscript in the Suspense fallbacks', () => {
  it('prefs and unsubscribe: the links note next to (not inside) the busy placeholder', async () => {
    for (const page of [prefsPage(), unsubscribePage()]) {
      const $ = await fallback(page);
      const busy = $('div[aria-busy=true]');
      expect(busy).toHaveLength(1);
      expect(busy.children()).toHaveLength(0);
      expect(busy.prev().is('noscript')).toBe(true);
      expect($('noscript').text()).toContain('en:Newsletter.noscript.links');
    }
  });

  it('subscribe: the form note while open; the calendar menu while closed', async () => {
    const open = await fallback(subscribePage());
    expect(open('noscript').text()).toContain('en:Newsletter.noscript.form');
    expect(open('div[aria-busy=true]').children()).toHaveLength(0);
    h.open = false;
    const closed = await fallback(subscribePage());
    expect(closed('noscript')).toHaveLength(1);
    expect(closed('noscript').text()).not.toContain('Newsletter.noscript.form');
    expect(closed('div[aria-busy=true]')).toHaveLength(1);
  });
});

describe('/prefs/[token] uses the view helpers', () => {
  it('?welcome=1 on an active row shows the welcome banner', async () => {
    h.sub = view();
    const $ = await html(prefsPage({ welcome: '1' }));
    expect($.text()).toContain('en:Newsletter.prefs.welcome');
    expect($.text()).toContain('en:Newsletter.prefs.statusActive');
  });

  it('an expired pause renders as active: no "Paused until", and Pause rather than Resume', async () => {
    h.sub = view({ status: 'paused', pausedUntil: new Date(Date.now() - 864e5).toISOString() });
    const $ = await html(prefsPage({ welcome: '1' }));
    expect($.text()).toContain('en:Newsletter.prefs.statusActive');
    expect($.text()).toContain('en:Newsletter.prefs.welcome');
    expect($.text()).not.toContain('prefs.statusPaused');
    expect($('input[name=intent][value=pause]')).toHaveLength(1);
  });

  it('a running pause shows its Pacific end date and offers Resume', async () => {
    // 2099-06-30 22:00 PDT, July 1 in UTC.
    h.sub = view({ status: 'paused', pausedUntil: '2099-07-01T05:00:00.000Z' });
    h.locale = 'zh';
    const $ = await html(prefsPage({ welcome: '1' }));
    expect($.text()).toContain('zh:Newsletter.prefs.statusPaused 2099年6月30日');
    expect($.text()).not.toContain('prefs.welcome');
    expect($('input[name=intent][value=resume]')).toHaveLength(1);
  });

  it('?lang= from the email footer offers the other edition above the preferences, in the page language', async () => {
    h.sub = view({ locale: 'en' });
    h.locale = 'zh';
    const $ = await html(prefsPage({ lang: 'zh' }));
    const offer = $('input[name=locale][type=hidden]').closest('form');
    expect(offer.find('input[name=locale][type=hidden]').attr('value')).toBe('zh');
    expect(offer.text()).toContain('zh:Newsletter.prefs.langNowEn');
    expect(offer.text()).toContain('zh:Newsletter.prefs.langSwitchToZh');
    expect($.html().indexOf('prefs.langNowEn')).toBeLessThan($.html().indexOf('Newsletter.form.language'));
    // The radio stays on the saved edition: nothing changes until the button is pressed.
    expect($('input[type=radio][name=locale][value=en]').attr('checked')).toBeDefined();
    expect($('input[type=radio][name=locale][value=zh]').attr('checked')).toBeUndefined();

    h.sub = view({ locale: 'zh', status: 'pending' });
    h.locale = 'en';
    const back = await html(prefsPage({ lang: 'en' }));
    expect(back.text()).toContain('en:Newsletter.prefs.langNowZh');
    expect(back.text()).toContain('en:Newsletter.prefs.langSwitchToEn');
  });

  it('no offer for the current edition, a junk or repeated ?lang=, or a row that is not editable', async () => {
    const cases: [Partial<View>, Record<string, unknown>][] = [
      [{ locale: 'en' }, { lang: 'en' }],
      [{ locale: 'en' }, { lang: 'fr' }],
      [{ locale: 'en' }, { lang: ['zh'] }],
      [{ locale: 'en' }, {}],
      [{ locale: 'en', status: 'unsubscribed' }, { lang: 'zh' }],
      [{ locale: 'en', status: 'suppressed' }, { lang: 'zh' }],
    ];
    for (const [row, sp] of cases) {
      h.sub = view(row);
      const $ = await html(prefsPage(sp as Record<string, string>));
      expect($('input[name=locale][type=hidden]')).toHaveLength(0);
      expect($.text()).not.toContain('prefs.langNow');
    }
  });

  it('a bad link offers "Subscribe again" and no unsubscribe hint', async () => {
    const $ = await html(prefsPage({}, 'nope'));
    expect($.text()).toContain('en:Newsletter.link.invalid');
    expect($('a[href="/subscribe"]').text()).toBe('en:Newsletter.link.subscribeAgain');
    expect($.text()).not.toContain('link.unsubscribeHint');
  });
});

describe('/unsubscribe', () => {
  it('several categories: the lead, one button per category, and everything', async () => {
    h.sub = view({ categories: ['ai', 'vc', 'social'] });
    const $ = await html(unsubscribePage());
    expect($.text()).toContain('en:Newsletter.unsubscribe.lead');
    expect($('input[name=c]').map((_i, el) => $(el).attr('value')).get()).toEqual(['ai', 'vc', 'social', 'all']);
  });

  it('a single category: only "everything", and no lead offering a choice', async () => {
    h.sub = view({ categories: ['ai'] });
    const $ = await html(unsubscribePage());
    expect($.text()).not.toContain('unsubscribe.lead');
    expect($('input[name=c]').map((_i, el) => $(el).attr('value')).get()).toEqual(['all']);
  });

  it('suppressed: the status line only, no controls on either page', async () => {
    h.sub = view({ status: 'suppressed', categories: ['ai', 'vc'] });
    const u = await html(unsubscribePage());
    expect(u('form')).toHaveLength(0);
    expect(u.text()).toContain('en:Newsletter.prefs.statusSuppressed');
    const p = await html(prefsPage());
    expect(p('form')).toHaveLength(0);
    expect(p.text()).toContain('en:Newsletter.prefs.statusSuppressed');
  });

  it('unsubscribed: only the confirmation', async () => {
    h.sub = view({ status: 'unsubscribed', categories: ['ai', 'vc'] });
    const $ = await html(unsubscribePage());
    expect($.text()).not.toContain('unsubscribe.lead');
    expect($('form')).toHaveLength(0);
    expect($('[role=status]').text()).toBe('en:Newsletter.unsubscribe.done');
  });

  it('a bad or missing link: the unsubscribe hint, and no "Subscribe again"', async () => {
    for (const sp of [{ t: 'nope' }, {}] as Record<string, string>[]) {
      const $ = await html(unsubscribePage(sp));
      expect($.text()).toContain('en:Newsletter.link.invalid');
      expect($.text()).toContain('en:Newsletter.link.unsubscribeHint');
      expect($('a[href="/subscribe"]')).toHaveLength(0);
      expect($('a[href="/"]').text()).toBe('en:Newsletter.link.home');
    }
  });
});

// ---- shared controls ----------------------------------------------------------------------------

describe('LinkProblem', () => {
  const render = async (props: Parameters<typeof LinkProblem>[0]) => load(renderToStaticMarkup(await LinkProblem(props)));

  it('prefs (default): "Subscribe again" unless subscriptions are unavailable; never the unsubscribe hint', async () => {
    for (const kind of ['invalid', 'expired'] as const) {
      const $ = await render({ locale: 'en', kind });
      expect($('a[href="/subscribe"]')).toHaveLength(1);
      expect($.text()).not.toContain('unsubscribeHint');
    }
    expect((await render({ locale: 'en', kind: 'unavailable' }))('a[href="/subscribe"]')).toHaveLength(0);
  });

  it('unsubscribe: the hint under the problem, and no "Subscribe again"', async () => {
    for (const kind of ['invalid', 'unavailable'] as const) {
      const $ = await render({ locale: 'zh', kind, context: 'unsubscribe' });
      const lines = $('p').map((_i, el) => $(el).text()).get();
      const problem = kind === 'unavailable' ? 'unsubscribeUnavailable' : kind;
      expect(lines).toEqual([`zh:Newsletter.link.${problem}`, 'zh:Newsletter.link.unsubscribeHint']);
      expect($('a[href="/subscribe"]')).toHaveLength(0);
      expect($('a[href="/"]')).toHaveLength(1);
    }
  });
});

describe('CategoryCheckboxes', () => {
  const render = (props: Partial<Parameters<typeof CategoryCheckboxes>[0]> = {}) =>
    load(renderToStaticMarkup(createElement(CategoryCheckboxes, { locale: 'en', legend: 'Categories', selected: ['ai'], ...props })));

  it('every chip carries a dot for off and a check for on, both hidden from assistive tech', () => {
    const $ = render();
    const labels = $('label');
    expect(labels).toHaveLength(7);
    labels.each((_i, el) => {
      const chip = $(el);
      expect(chip.attr('class')).toContain('group/chip');
      // The border has to be a utility to beat border-rule; the stylesheet only tints.
      expect(chip.attr('class')).toContain('has-[:checked]:border-transparent');
      expect(chip.find('span[aria-hidden=true]').attr('class')).toContain('group-has-[:checked]/chip:hidden');
      const check = chip.find('svg[aria-hidden=true]');
      expect(check).toHaveLength(1);
      expect(check.attr('class')).toMatch(/(^| )hidden( |$)/);
      expect(check.attr('class')).toContain('group-has-[:checked]/chip:block');
    });
  });

  it('the hint describes the group; an error takes its place in the error colour', () => {
    const plain = render({ hint: 'Pick at least one.' });
    expect(plain('fieldset').attr('aria-describedby')).toBe('category-hint');
    expect(plain('#category-hint').text()).toBe('Pick at least one.');
    expect(plain('#category-hint').attr('class')).toContain('text-muted');

    const bad = render({ hint: 'Pick at least one.', error: 'Pick at least one category.' });
    expect(bad('fieldset').attr('aria-describedby')).toBe('category-hint');
    expect(bad('#category-hint').text()).toBe('Pick at least one category.');
    expect(bad('#category-hint').attr('class')).toContain('text-seal-text');

    const none = render();
    expect(none('fieldset').attr('aria-describedby')).toBeUndefined();
    expect(none('#category-hint')).toHaveLength(0);
  });
});

describe('SubscribeForm before any answer', () => {
  const copy = {
    email: 'Email', emailPlaceholder: 'you@example.com', categories: 'Categories', categoriesHint: 'Pick at least one.',
    language: 'Email language', submit: 'Subscribe', submitting: 'Sending…', privacy: 'Privacy line', privacyLink: 'How I handle your data',
    honeypot: 'Leave this field empty', pending: 'Check your inbox', pendingHint: 'Hint', again: 'Subscribe again',
    errors: { invalid_email: 'bad email', no_category: 'pick one', bot: 'bot', server: 'server', rate_limited: 'slow down', closed: 'closed', busy: 'busy' },
  };

  it('no field error yet; the status line can take focus for answers without a field', () => {
    const $ = load(renderToStaticMarkup(createElement(SubscribeForm, { locale: 'en', categories: ['ai'], copy })));
    expect($('#subscribe-email-error')).toHaveLength(0);
    expect($('input[name=email]').attr('aria-describedby')).toBeUndefined();
    expect($('#subscribe-status').attr()).toMatchObject({ role: 'status', 'aria-live': 'polite', tabindex: '-1' });
    expect($('#category-hint').text()).toBe('Pick at least one.');
  });

  it('the privacy line links to /privacy in the page language, before anyone consents', () => {
    const link = (locale: 'en' | 'zh') => {
      const $ = load(renderToStaticMarkup(createElement(SubscribeForm, { locale, categories: ['ai'], copy })));
      const a = $('a[href$="/privacy"]');
      expect(a).toHaveLength(1);
      // Below the button, in the same small print as the privacy line.
      expect(a.parent().text()).toContain('Privacy line');
      expect($('button[type=submit]').nextAll('p').find('a').attr('href')).toBe(a.attr('href'));
      return { href: a.attr('href'), text: a.text(), line: a.parent().text() };
    };
    expect(link('en')).toEqual({ href: '/privacy', text: 'How I handle your data', line: 'Privacy line How I handle your data' });
    // Chinese runs on without a space.
    expect(link('zh')).toEqual({ href: '/zh/privacy', text: 'How I handle your data', line: 'Privacy lineHow I handle your data' });
  });
});
