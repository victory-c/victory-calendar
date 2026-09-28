import { expect, test } from '@playwright/test';

test.skip(!!process.env.DATABASE_URL && !process.env.E2E_SEEDED, 'seed data expected');

test('calendar: month title, prev/next, agenda anchors', async ({ page }) => {
  await page.goto('/zh/calendar?m=2026-10');
  await expect(page.getByRole('heading', { level: 2, name: '2026年10月' })).toBeVisible();
  await page.getByRole('link', { name: '下个月' }).click();
  await expect(page).toHaveURL(/m=2026-11/);
  await expect(page.getByRole('heading', { level: 2, name: '2026年11月' })).toBeVisible();
});

test('calendar grid is desktop-only; phones get the agenda', async ({ page }, info) => {
  await page.goto('/calendar');
  const grid = page.locator('table');
  if (info.project.name === 'mobile') await expect(grid).toBeHidden();
  else await expect(grid).toBeVisible();
});

test('/going lists only public seals and never cycling', async ({ page }) => {
  await page.goto('/going');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Where Victor is going');
  await expect(page.getByText('East Bay Hills Gran Fondo')).toHaveCount(0);
  await expect(page.getByText('Hardware Pitch Night')).toHaveCount(0); // private venue → only after it ends
  await expect(page.locator('.seal:visible').first()).toBeVisible();
});

test('facet form filters by area and price without JavaScript', async ({ browser }) => {
  const ctx = await browser.newContext({ javaScriptEnabled: false });
  const page = await ctx.newPage();
  await page.goto('/?r=east_bay&free=1');
  const cats = await page.locator('article[data-cat]').evaluateAll((els) => els.map((e) => e.getAttribute('data-cat')));
  expect(cats.length).toBeGreaterThan(0);
  expect(new Set(cats)).toEqual(new Set(['campus']));
  await ctx.close();
});

test('ISO week pages and impossible weeks', async ({ page }) => {
  expect((await page.goto('/week/2026-W41'))?.status()).toBe(200);
  expect((await page.goto('/week/2027-W53'))?.status()).toBe(404);
});

test('about page in both languages', async ({ page }) => {
  await page.goto('/zh/about');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('关于');
  await expect(page.getByText('无付费植入').first()).toBeVisible();
});
