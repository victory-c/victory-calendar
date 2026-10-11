import { expect, test } from '@playwright/test';

// The public digest archive (M3 week 15). Works with or without a database: in seed mode there is
// no sent issue, so the index shows its empty state and every issue page is a 404.

test('/weekly index renders in both languages', async ({ page }) => {
  const res = await page.goto('/weekly');
  expect(res?.status()).toBe(200);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Weekly picks');
  // Either the issues (each links to its archive) or the empty state before the first send.
  const issues = page.locator('main li a[href*="/weekly/"]');
  if ((await issues.count()) === 0) await expect(page.getByText('No issues have gone out yet.')).toBeVisible();
  else await expect(issues.first()).toHaveText(/^Week of /);

  const zh = await page.goto('/zh/weekly');
  expect(zh?.status()).toBe(200);
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-Hans');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('周报');
  await expect(page.locator('link[rel="alternate"][hreflang="en"]')).toHaveAttribute('href', /\/weekly$/);
});

test('malformed, impossible and unknown weeks are 404', async ({ request }) => {
  for (const p of ['/weekly/not-a-week', '/weekly/2026-w42', '/weekly/2026-W99', '/weekly/2027-W53', '/weekly/__placeholder__', '/weekly/2020-W01', '/zh/weekly/2020-W01']) {
    expect((await request.get(p)).status(), p).toBe(404);
  }
});

// Mirrors newsletterStatus() for the local `pnpm start` server (see newsletter.spec.ts): the empty
// archive index is listed only while the newsletter is open.
const newsletterOpen = Boolean(process.env.DATABASE_URL && process.env.SUBSCRIBER_LINK_SECRET) && process.env.NEWSLETTER_OPEN !== '0';

test('the sitemap lists the archive index only while the newsletter is open', async ({ request }) => {
  const res = await request.get('/sitemap.xml');
  expect(res.status()).toBe(200);
  const body = await res.text();
  if (newsletterOpen) expect(body).toMatch(/\/weekly<\/loc>/);
  else expect(body).not.toMatch(/\/weekly<\/loc>/);
});
