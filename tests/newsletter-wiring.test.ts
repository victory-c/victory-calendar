import * as nodeModule from 'node:module';
import { NextRequest } from 'next/server';
import { createElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

// Week 13 wiring: proxy matcher for token paths and the BotID prefix, next.config headers and
// rewrites, the BotID client init, and the "Subscribe" entry points that appear only while
// newsletterStatus() is 'open' (header, footer, calendar menu, sitemap).

vi.mock('next-intl/server', async () => {
  const messages = { en: (await import('../messages/en.json')).default, zh: (await import('../messages/zh.json')).default };
  const lookup = (tree: unknown, key: string) =>
    key.split('.').reduce<unknown>((node, k) => (node as Record<string, unknown> | undefined)?.[k], tree);
  return {
    getTranslations: async ({ locale, namespace }: { locale: 'en' | 'zh'; namespace: string }) => (key: string) => {
      const v = lookup((messages[locale] as Record<string, unknown>)[namespace], key);
      if (typeof v !== 'string') throw new Error(`missing message ${namespace}.${key}`);
      return v;
    },
  };
});
vi.mock('@/i18n/navigation', () => ({
  // Locale prefixing is next-intl's job; here the raw href is what the component chose.
  Link: ({ href, children, ...rest }: { href: string; children: ReactNode }) => createElement('a', { href, ...rest }, children),
}));
vi.mock('@/components/LangSwitch', () => ({ LangSwitch: () => null, LangSwitchFallback: () => null }));
vi.mock('@/lib/events/queries', () => ({ getWindow: async () => ({ events: [] }) }));
// The sitemap's sent digest issues (the real query would need a database).
vi.mock('@/lib/digest/archive-queries', () => ({
  listSentIssues: async () => [{ isoWeek: '2026-W42', sentAt: new Date('2026-10-12T01:05:00Z'), introEn: 'Hi', introZh: '你好' }],
}));
vi.mock('botid/client/core', () => ({ initBotId: vi.fn() }));

const BOTID = '/149e9513-01fa-4fb0-aad4-566afd725d1b/2d206a39-8ed7-437e-a3be-862e0f06eea3';
const TOKEN = `sub_0000000000000000.${'A'.repeat(43)}`;

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

/** The env newsletterStatus() reads, for each state the entry points care about. */
function gate(state: 'open' | 'flag-closed' | 'no-db' | 'vercel-unverified' | 'vercel-verified' | 'vercel-no-contact') {
  vi.stubEnv('DATABASE_URL', state === 'no-db' ? undefined : 'postgres://localhost:5432/never_connected');
  vi.stubEnv('SUBSCRIBER_LINK_SECRET', 'test-secret-wiring');
  vi.stubEnv('NEWSLETTER_OPEN', state === 'flag-closed' ? '0' : undefined);
  vi.stubEnv('VERCEL', state.startsWith('vercel') ? '1' : undefined);
  const verified = state === 'vercel-verified' || state === 'vercel-no-contact';
  vi.stubEnv('RESEND_API_KEY', verified ? 're_test' : undefined);
  vi.stubEnv('RESEND_FROM', verified ? "Victor's Picks <picks@mail.example.org>" : 'onboarding@resend.dev');
  // On Vercel the form also waits for the /privacy contact address (D1).
  vi.stubEnv('PRIVACY_CONTACT_EMAIL', state === 'vercel-no-contact' ? undefined : 'privacy@example.org');
  vi.stubEnv('PUBLIC_HOST', 'picks.example.org');
}

describe('proxy matcher (compiled by Next itself)', () => {
  let matches: (path: string) => boolean;
  beforeAll(async () => {
    // The same static analysis `next build` runs on src/proxy.ts, so this also proves the config
    // stays statically readable, then the runtime matcher Next uses per request.
    const { loadBindings } = await import('next/dist/build/swc/index.js');
    const { getPageStaticInfo } = await import('next/dist/build/analysis/get-page-static-info.js');
    const { getMiddlewareRouteMatcher } = await import('next/dist/shared/lib/router/utils/middleware-route-matcher.js');
    await loadBindings();
    const info = await getPageStaticInfo({
      pageFilePath: `${process.cwd()}/src/proxy.ts`,
      nextConfig: {},
      isDev: false,
      page: '/src/proxy',
      // PAGE_TYPES.ROOT; the enum is a `const enum`, which isolatedModules can't read.
      pageType: 'root' as Parameters<typeof getPageStaticInfo>[0]['pageType'],
    });
    const matchers = info.middleware?.matchers ?? [];
    expect(matchers.length).toBeGreaterThan(0);
    const run = getMiddlewareRouteMatcher(matchers);
    matches = (path) => run(path, {} as never, {});
  });

  it.each([
    ['/', true],
    ['/zh', true],
    ['/subscribe', true],
    ['/zh/subscribe', true],
    ['/unsubscribe', true],
    ['/zh/unsubscribe', true],
    ['/_locale', true],
    ['/admin', true],
    // Token paths contain a dot; without their own entries they would skip next-intl and 404.
    ['/confirm/sub_x.y', true],
    [`/confirm/${TOKEN}`, true],
    [`/zh/confirm/${TOKEN}`, true],
    ['/prefs/sub_x.y', true],
    ['/zh/prefs/sub_x.y', true],
    [`/prefs/${TOKEN}`, true],
    // Files and excluded first segments.
    ['/events/x.ics', false],
    ['/zh/events/x.ics', false],
    ['/fonts/a.woff2', false],
    ['/feed.xml', false],
    ['/api/unsubscribe', false],
    ['/api/webhooks/resend', false],
    ['/ics/en/x', false],
    ['/og/x', false],
    ['/_next/static/chunks/a.js', false],
    // BotID's proxied calls have no dot, so the prefix itself must be excluded.
    [`${BOTID}/a`, false],
    [`${BOTID}/a-4-a/c.js`, false],
    [BOTID, false],
    // Near misses stay ordinary paths.
    ['/confirmations/a.b', false],
    ['/apix', true],
  ])('%s → %s', (path, want) => {
    expect(matches(path)).toBe(want);
  });
});

// next-intl's ESM middleware imports the extensionless 'next/server'. Next's bundler resolves it;
// Node's own ESM loader (which Vitest uses for node_modules) can't, so map it for these tests.
const canLoadIntl = typeof nodeModule.registerHooks === 'function';
if (canLoadIntl) nodeModule.registerHooks({ resolve: (spec, ctx, next) => next(spec === 'next/server' ? 'next/server.js' : spec, ctx) });

describe.runIf(canLoadIntl)('proxy routes token paths through next-intl', () => {
  const run = async (path: string, acceptLanguage = 'en-US,en;q=0.9') => {
    const { default: proxy } = await import('@/proxy');
    return proxy(new NextRequest(`http://localhost:3000${path}`, { headers: { 'accept-language': acceptLanguage } }));
  };

  it('rewrites an English confirm link (token with a dot) to the [locale] segment', async () => {
    const res = await run(`/confirm/${TOKEN}`);
    expect(res.headers.get('location')).toBeNull();
    expect(new URL(res.headers.get('x-middleware-rewrite')!).pathname).toBe(`/en/confirm/${TOKEN}`);
  });

  it('keeps the query on /unsubscribe?t=', async () => {
    const res = await run(`/unsubscribe?t=${TOKEN}`);
    const to = new URL(res.headers.get('x-middleware-rewrite')!);
    expect(to.pathname).toBe('/en/unsubscribe');
    expect(to.searchParams.get('t')).toBe(TOKEN);
  });

  it('serves /zh/prefs/<token> as is', async () => {
    const res = await run(`/zh/prefs/${TOKEN}`);
    expect(res.status).not.toBe(307);
    const rewrite = res.headers.get('x-middleware-rewrite');
    if (rewrite) expect(new URL(rewrite).pathname).toBe(`/zh/prefs/${TOKEN}`);
  });

  it('a zh-first browser on an English link keeps the token through the /zh redirect', async () => {
    const res = await run(`/prefs/${TOKEN}`, 'zh-CN,zh;q=0.9');
    expect(res.status).toBe(307);
    expect(new URL(res.headers.get('location')!).pathname).toBe(`/zh/prefs/${TOKEN}`);
  });
});

describe('next.config', () => {
  type Rule = { source: string; headers: { key: string; value: string }[] };
  const load = async () => {
    const { default: config } = await import('../next.config');
    const { getPathMatch } = await import('next/dist/shared/lib/router/utils/path-match.js');
    const rules = (await config.headers!()) as Rule[];
    // Later rules win for the same key (Next docs, headers.md), like the server applies them.
    const effective = (path: string) => {
      const out: Record<string, string> = {};
      for (const r of rules) if (getPathMatch(r.source)(path)) for (const h of r.headers) out[h.key.toLowerCase()] = h.value;
      return out;
    };
    return { config, rules, effective };
  };

  it.each(['/confirm/sub_x.y', `/zh/confirm/${TOKEN}`, `/prefs/${TOKEN}`, '/zh/prefs/sub_x.y', '/unsubscribe', '/zh/unsubscribe'])(
    'token page %s gets X-Robots-Tag: noindex, nofollow',
    async (path) => {
      const { effective } = await load();
      expect(effective(path)['x-robots-tag']).toBe('noindex, nofollow');
      expect(effective(path)['x-frame-options']).toBe('DENY');
    },
  );

  it.each(['/', '/zh', '/subscribe', '/zh/subscribe', '/about', '/privacy', '/zh/privacy', '/events/x', '/confirmations'])('%s stays indexable', async (path) => {
    const { effective } = await load();
    expect(effective(path)['x-robots-tag']).toBeUndefined();
  });

  it('withBotId is outermost: its rewrites come last and only its prefix may be framed by itself', async () => {
    const { config, rules, effective } = await load();
    expect(rules.at(-1)!.source).toBe(`${BOTID}/:path*`);
    expect(effective(`${BOTID}/a`)['x-frame-options']).toBe('SAMEORIGIN');
    expect(effective('/')['x-frame-options']).toBe('DENY');
    expect(effective('/')['content-security-policy']).toBe("frame-ancestors 'none'");
    const rewrites = (await config.rewrites!()) as { source: string; destination: string }[];
    expect(Array.isArray(rewrites)).toBe(true);
    expect(rewrites.map((r) => r.source)).toEqual([
      '/events/:slug.ics',
      '/zh/events/:slug.ics',
      '/feed.xml',
      '/zh/feed.xml',
      `${BOTID}/a-4-a/c.js`,
      `${BOTID}/:path*`,
    ]);
    expect(rewrites.at(-1)!.destination).toMatch(/^https:\/\/api\.vercel\.com\/bot-protection\/v1\/proxy\//);
    expect(config.cacheComponents).toBe(true);
  });
});

describe('instrumentation-client', () => {
  it('protects only the two subscribe page POSTs', async () => {
    vi.resetModules();
    const { initBotId } = await import('botid/client/core');
    vi.mocked(initBotId).mockClear();
    await import('@/instrumentation-client');
    expect(initBotId).toHaveBeenCalledTimes(1);
    expect(vi.mocked(initBotId).mock.calls[0][0]).toEqual({
      protect: [
        { path: '/subscribe', method: 'POST' },
        { path: '/zh/subscribe', method: 'POST' },
      ],
    });
  });

  it('a failing init never breaks the page', async () => {
    vi.resetModules();
    const { initBotId } = await import('botid/client/core');
    vi.mocked(initBotId).mockImplementationOnce(() => {
      throw new Error('blocked');
    });
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(import('@/instrumentation-client')).resolves.toBeDefined();
    expect(err).toHaveBeenCalledWith('[botid] init failed', expect.any(Error));
  });
});

describe('Subscribe entry points follow newsletterStatus()', () => {
  const html = async (el: Promise<ReactElement>) => renderToStaticMarkup(await el);
  const header = async (locale: 'en' | 'zh' = 'en') => html((await import('@/components/SiteHeader')).SiteHeader({ locale }));
  const footer = async (locale: 'en' | 'zh' = 'en') => html((await import('@/components/SiteFooter')).SiteFooter({ locale }));
  const menu = async (props: Parameters<typeof import('@/components/SubscribeMenu').SubscribeMenu>[0]) =>
    html((await import('@/components/SubscribeMenu')).SubscribeMenu(props));
  const sitemapUrls = async () => (await (await import('@/app/sitemap')).default()).map((e) => e.url);
  const subscribeLinks = (markup: string) => [...markup.matchAll(/<a [^>]*href="(\/subscribe[^"]*)"[^>]*>([^<]*)<\/a>/g)].map((m) => [m[1], m[2]]);

  describe('open', () => {
    it('header and footer link to /subscribe with Site.subscribe', async () => {
      gate('open');
      expect(subscribeLinks(await header())).toEqual([['/subscribe', 'Subscribe']]);
      expect(subscribeLinks(await header('zh'))).toEqual([['/subscribe', '订阅']]);
      expect(subscribeLinks(await footer())).toEqual([['/subscribe', 'Subscribe']]);
      expect(subscribeLinks(await footer('zh'))).toEqual([['/subscribe', '订阅']]);
    });

    it('the header link is visible on phones (no hidden/sm: gate) and has a 44 px hit area', async () => {
      gate('open');
      const cls = /<a [^>]*class="([^"]*)"[^>]*href="\/subscribe"|<a [^>]*href="\/subscribe"[^>]*class="([^"]*)"/.exec(await header());
      const classes = (cls?.[1] ?? cls?.[2] ?? '').split(' ');
      expect(classes).not.toContain('hidden');
      expect(classes).toContain('h-9');
      expect(classes).toEqual(expect.arrayContaining(['relative', 'after:absolute', 'after:-inset-y-1']));
    });

    it('the calendar menu offers the same categories by email, outside the counted <ul>', async () => {
      gate('open');
      const m = await menu({ locale: 'zh', cats: ['ai', 'hackathon'] });
      expect(subscribeLinks(m)).toEqual([['/subscribe?c=ai,hackathon', '每周精选，发到你的邮箱']]);
      const ul = /<ul>([\s\S]*?)<\/ul>/.exec(m)![1];
      expect(ul).not.toContain('/subscribe');
      expect(ul.match(/<a /g)).toHaveLength(3);
      expect(m.match(/<input /g)).toHaveLength(1);
      expect(subscribeLinks(await menu({ locale: 'en' }))).toEqual([['/subscribe', 'Get the picks by email']]);
    });

    it('F19: the site\'s language and online filters ride along on the feed and the email link; site-only filters get a note', async () => {
      gate('open');
      const m = await menu({ locale: 'zh', cats: ['ai'], facets: { evLang: 'zh', onlineOnly: true }, siteOnly: true });
      expect(subscribeLinks(m)).toEqual([['/subscribe?c=ai&amp;ev_lang=zh&amp;online=1', '每周精选，发到你的邮箱']]);
      expect(m).toContain('value="https://picks.example.org/calendar.ics?c=ai&amp;lang=zh&amp;ev_lang=zh&amp;online=1"');
      expect(m).toContain('href="webcal://picks.example.org/calendar.ics?c=ai&amp;lang=zh&amp;ev_lang=zh&amp;online=1"');
      expect(m).toContain('订阅当前筛选');
      expect(m).toContain('区域、价格、线下筛选只在网站上生效。');
      // Outlook gets the feed name with the facets in it.
      expect(m).toContain(encodeURIComponent('Victor 精选 · AI 与技术 · 中文或双语活动 · 线上').replace(/%20/g, '+'));
      // No facets, no note: the menu is exactly as before.
      const plain = await menu({ locale: 'en', cats: ['ai'] });
      expect(plain).toContain('Subscribe to these categories');
      expect(plain).not.toContain('site only');
      expect(plain).toContain('value="https://picks.example.org/calendar.ics?c=ai"');
      // going.ics takes no facets and shows no note.
      const going = await menu({ locale: 'en', going: true, facets: { evLang: 'zh', onlineOnly: true }, siteOnly: true });
      expect(going).toContain('value="https://picks.example.org/calendar/going.ics"');
      expect(going).not.toContain('site only');
    });

    it('no email link on the going.ics menu (going alerts are switched on at /subscribe or in preferences)', async () => {
      gate('open');
      expect(subscribeLinks(await menu({ locale: 'en', going: true }))).toEqual([]);
    });

    it('sitemap lists /subscribe with its zh alternate', async () => {
      gate('open');
      const entries = await (await import('@/app/sitemap')).default();
      const sub = entries.find((e) => e.url === 'https://picks.example.org/subscribe');
      expect(sub?.alternates?.languages).toEqual({
        en: 'https://picks.example.org/subscribe',
        'zh-Hans': 'https://picks.example.org/zh/subscribe',
        'x-default': 'https://picks.example.org/subscribe',
      });
      expect((await sitemapUrls()).filter((u) => /confirm|prefs|unsubscribe/.test(u))).toEqual([]);
    });

    it('on Vercel with a verified sender it is open too', async () => {
      gate('vercel-verified');
      expect(subscribeLinks(await header())).toHaveLength(1);
      expect(await sitemapUrls()).toContain('https://picks.example.org/subscribe');
    });
  });

  describe.each(['flag-closed', 'no-db', 'vercel-unverified', 'vercel-no-contact'] as const)('closed (%s)', (state) => {
    it('no Subscribe link in header, footer or calendar menu', async () => {
      gate(state);
      expect(subscribeLinks(await header())).toEqual([]);
      expect(subscribeLinks(await footer('zh'))).toEqual([]);
      const m = await menu({ locale: 'en', cats: ['ai'] });
      expect(subscribeLinks(m)).toEqual([]);
      expect(m).toContain('id="subscribe"'); // the calendar menu itself is unchanged
    });

    it('sitemap leaves /subscribe out', async () => {
      gate(state);
      const urls = await sitemapUrls();
      expect(urls).toContain('https://picks.example.org/about');
      expect(urls.some((u) => u.endsWith('/subscribe'))).toBe(false);
    });
  });
});

describe('sitemap: the /weekly digest archive (week 15)', () => {
  it('lists /weekly, /privacy and each sent issue with its zh alternate and send time', async () => {
    gate('flag-closed');
    const entries = await (await import('@/app/sitemap')).default();
    const urls = entries.map((e) => e.url);
    expect(urls).toEqual(expect.arrayContaining(['https://picks.example.org/weekly', 'https://picks.example.org/privacy']));
    const issue = entries.find((e) => e.url === 'https://picks.example.org/weekly/2026-W42');
    expect(issue?.lastModified).toEqual(new Date('2026-10-12T01:05:00Z'));
    expect(issue?.alternates?.languages).toEqual({
      en: 'https://picks.example.org/weekly/2026-W42',
      'zh-Hans': 'https://picks.example.org/zh/weekly/2026-W42',
      'x-default': 'https://picks.example.org/weekly/2026-W42',
    });
  });
});
