import { expect, type Page, test } from '@playwright/test';
import en from '../messages/en.json';
import zh from '../messages/zh.json';

// Week 13 newsletter surfaces that must hold with or without a database: link pages never 404 and
// never leak state, the one-click endpoint never redirects or sets cookies, token pages are
// noindex. CI runs this in seed mode (no DATABASE_URL), where the form is closed and link pages say
// "unavailable"; e2e/newsletter-flow.spec.ts covers the open form on a real database.

const N = { en: en.Newsletter, zh: zh.Newsletter };
// Well-formed (passes the token regex) but signed by nobody: no row has this id.
const TOKEN = `sub_0000000000000000.${'A'.repeat(43)}`;

// Mirrors newsletterStatus() for the local `pnpm start` server (never on Vercel): the form opens
// with a database plus a link secret unless NEWSLETTER_OPEN=0, and link pages work with both.
const linksWork = Boolean(process.env.DATABASE_URL && process.env.SUBSCRIBER_LINK_SECRET);
const formOpen = linksWork && process.env.NEWSLETTER_OPEN !== '0';

/** Bad link on a token page: "invalid" with a database, "unavailable" in seed mode. Never the form. */
async function expectLinkProblem(page: Page, locale: 'en' | 'zh') {
  const l = N[locale].link;
  // /unsubscribe words "unavailable" for someone leaving (link.unsubscribeUnavailable).
  await expect(page.getByText(l.invalid).or(page.getByText(l.unavailable)).or(page.getByText(l.unsubscribeUnavailable))).toBeVisible();
  await expect(page.getByRole('link', { name: N[locale].link.home })).toBeVisible();
  await expect(page.locator('main').getByRole('button')).toHaveCount(0);
}

/** On /unsubscribe the visitor wants out: how else to stop the emails, and no "Subscribe again". */
async function expectUnsubscribeHint(page: Page, locale: 'en' | 'zh') {
  await expect(page.getByText(N[locale].link.unsubscribeHint)).toBeVisible();
  await expect(page.locator('main').getByRole('link', { name: N[locale].link.subscribeAgain, exact: true })).toHaveCount(0);
}

const noHorizontalScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

test.describe('closed form (no database or no link secret)', () => {
  test.skip(formOpen, 'the form is open with DATABASE_URL + SUBSCRIBER_LINK_SECRET; see newsletter-flow.spec.ts');

  for (const locale of ['en', 'zh'] as const) {
    const path = locale === 'zh' ? '/zh/subscribe' : '/subscribe';
    test(`${path}: closed copy and the calendar menu, no form, noindex`, async ({ page }) => {
      const res = await page.goto(path);
      expect(res?.status()).toBe(200);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(N[locale].title);
      await expect(page.getByRole('heading', { level: 2, name: N[locale].closed.title })).toBeVisible();
      await expect(page.getByText(N[locale].closed.body)).toBeVisible();
      await expect(page.locator('#subscribe')).toHaveCount(1);
      await expect(page.locator('#subscribe summary')).toBeVisible();
      await expect(page.locator('form')).toHaveCount(0);
      await expect(page.getByRole('textbox', { name: N[locale].form.email, exact: true })).toHaveCount(0);
      await expect(page.getByRole('button', { name: N[locale].form.submit, exact: true })).toHaveCount(0);
      await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
      expect(await noHorizontalScroll(page)).toBeLessThanOrEqual(0);
    });
  }

  test('?c= preselects the calendar menu while closed', async ({ page }) => {
    await page.goto('/zh/subscribe?c=ai,hackathon');
    await page.locator('#subscribe summary').click();
    await expect(page.locator('#subscribe ul a')).toHaveText(['Apple 日历', 'Outlook', 'Google 日历']);
    await expect(page.locator('#subscribe input')).toHaveValue(/\/calendar\.ics\?c=ai,hackathon&lang=zh$/);
  });

  test('no Subscribe entry points: header, footer, calendar menu, sitemap', async ({ page, request }) => {
    for (const [path, site] of [['/', en.Site], ['/zh/about', zh.Site]] as const) {
      await page.goto(path);
      const link = { name: site.subscribe, exact: true };
      await expect(page.getByRole('banner').getByRole('link', link), path).toHaveCount(0);
      await expect(page.getByRole('contentinfo').getByRole('link', link), path).toHaveCount(0);
      // Includes the calendar menu's "by email" row, which is in the DOM even while it is shut.
      await expect(page.locator('a[href$="/subscribe"], a[href*="/subscribe?"]'), path).toHaveCount(0);
    }
    const sitemap = await (await request.get('/sitemap.xml')).text();
    expect(sitemap).toContain('/about</loc>');
    expect(sitemap).not.toMatch(/\/subscribe<\/loc>/);
  });
});

test.describe('link pages never 404', () => {
  for (const locale of ['en', 'zh'] as const) {
    const prefix = locale === 'zh' ? '/zh' : '';

    test(`${prefix}/confirm/<token> lands on ${prefix}/subscribe?link=invalid`, async ({ page }) => {
      const res = await page.goto(`${prefix}/confirm/${TOKEN}`);
      expect(res?.status()).toBe(200);
      await expect(page).toHaveURL(new RegExp(`^https?://[^/]+${prefix}/subscribe\\?link=invalid$`));
      await expect(page.getByText(N[locale].link.invalid)).toBeVisible();
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(N[locale].title);
    });

    test(`${prefix}/prefs/<bad> shows the link problem with status 200`, async ({ page }) => {
      // The dotted token is the case the proxy matcher used to skip (it looks like a file).
      for (const bad of [TOKEN, 'nope']) {
        const res = await page.goto(`${prefix}/prefs/${bad}`);
        expect(res?.status(), bad).toBe(200);
        await expect(page.getByRole('heading', { level: 1 })).toHaveText(N[locale].prefs.title);
        await expectLinkProblem(page, locale);
      }
    });

    test(`${prefix}/unsubscribe with a bad or missing token shows the link problem`, async ({ page }) => {
      for (const q of [`?t=${TOKEN}`, '?t=bad', '']) {
        const res = await page.goto(`${prefix}/unsubscribe${q}`);
        expect(res?.status(), q).toBe(200);
        await expect(page.getByRole('heading', { level: 1 })).toHaveText(N[locale].unsubscribe.title);
        await expectLinkProblem(page, locale);
        await expectUnsubscribeHint(page, locale);
      }
    });
  }

  test('the confirm link answers with a 303, and HEAD (link scanners) does nothing', async ({ request }) => {
    const res = await request.get(`/confirm/${TOKEN}`, { maxRedirects: 0 });
    expect(res.status()).toBe(303);
    const to = new URL(res.headers().location, 'http://localhost');
    expect(to.pathname + to.search).toBe('/subscribe?link=invalid');
    expect(res.headers()['x-robots-tag']).toBe('noindex, nofollow');
    const head = await request.head(`/zh/confirm/${TOKEN}`, { maxRedirects: 0 });
    expect(head.status()).toBe(200);
    expect(head.headers().location).toBeUndefined();
  });
});

test.describe('token pages stay out of search and referrers', () => {
  test('X-Robots-Tag and noindex metadata on link pages, not on /subscribe', async ({ request, page }) => {
    for (const path of [`/prefs/${TOKEN}`, `/zh/prefs/${TOKEN}`, `/unsubscribe?t=${TOKEN}`, '/zh/unsubscribe']) {
      const res = await request.get(path, { maxRedirects: 0 });
      expect(res.status(), path).toBe(200);
      expect(res.headers()['x-robots-tag'], path).toBe('noindex, nofollow');
    }
    for (const path of ['/subscribe', '/zh/subscribe', '/']) {
      expect((await request.get(path, { maxRedirects: 0 })).headers()['x-robots-tag'], path).toBeUndefined();
    }
    await page.goto(`/prefs/${TOKEN}`);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex, nofollow');
    await expect(page.locator('meta[name="referrer"]')).toHaveAttribute('content', 'no-referrer');
    await expect(page.locator('link[rel="canonical"]')).toHaveCount(0);
  });

  test('robots.txt still disallows /api and does not hide the token pages', async ({ request }) => {
    const robots = await (await request.get('/robots.txt')).text();
    expect(robots).toContain('Disallow: /api');
    // Crawlers must be able to fetch the pages to see their noindex.
    expect(robots).not.toMatch(/Disallow: \/(zh\/)?(prefs|confirm|unsubscribe)/);
  });
});

test.describe('RFC 8058 one-click endpoint', () => {
  test('POST with a bad token: no redirect, no cookie, either encoding', async ({ request }) => {
    for (const body of [{ form: { 'List-Unsubscribe': 'One-Click' } }, { multipart: { 'List-Unsubscribe': 'One-Click' } }]) {
      const res = await request.post('/api/unsubscribe?t=bad', { ...body, maxRedirects: 0 });
      const label = Object.keys(body)[0];
      expect(Math.floor(res.status() / 100), label).not.toBe(3);
      // 400 for a bad token with a database; 503 in seed mode, where link actions can't run.
      expect([400, 503], label).toContain(res.status());
      expect(res.headers().location, label).toBeUndefined();
      expect(res.headers()['set-cookie'], label).toBeUndefined();
      expect(res.headers()['cache-control'], label).toContain('no-store');
    }
  });

  test('GET only redirects to the manual page; HEAD does nothing', async ({ request }) => {
    const bad = await request.get('/api/unsubscribe?t=x', { maxRedirects: 0 });
    expect(bad.status()).toBe(303);
    const badTo = new URL(bad.headers().location, 'http://localhost');
    expect(badTo.pathname + badTo.search).toBe('/unsubscribe');
    expect(bad.headers()['set-cookie']).toBeUndefined();

    // A well-formed token keeps riding along; nobody owns this one, so the page stays English.
    const ok = await request.get(`/api/unsubscribe?t=${TOKEN}`, { maxRedirects: 0 });
    expect(ok.status()).toBe(303);
    const okTo = new URL(ok.headers().location, 'http://localhost');
    expect(okTo.pathname).toBe('/unsubscribe');
    expect(okTo.searchParams.get('t')).toBe(TOKEN);

    const head = await request.head(`/api/unsubscribe?t=${TOKEN}`, { maxRedirects: 0 });
    expect(head.status()).toBe(200);
    expect(head.headers().location).toBeUndefined();
  });

  test('the manual page reached from GET shows no buttons for a token nobody owns', async ({ page }) => {
    await page.goto(`/api/unsubscribe?t=${TOKEN}`);
    await expect(page).toHaveURL(/\/unsubscribe\?t=/);
    await expectLinkProblem(page, 'en');
    await expectUnsubscribeHint(page, 'en');
  });
});
