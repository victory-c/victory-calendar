import { expect, test } from '@playwright/test';

test('English home renders with lang="en"', async ({ page }) => {
  const res = await page.goto('/');
  expect(res?.status()).toBe(200);
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.getByRole('heading', { level: 1 })).toContainText("Victor's Picks");
});

test('Chinese home renders with lang="zh-Hans"', async ({ page }) => {
  const res = await page.goto('/zh');
  expect(res?.status()).toBe(200);
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-Hans');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Victor 精选');
});

test('first visit with zh Accept-Language goes to /zh', async ({ browser }) => {
  const ctx = await browser.newContext({ locale: 'zh-CN' });
  const page = await ctx.newPage();
  await page.goto('/');
  await expect(page).toHaveURL(/\/zh$/);
  await ctx.close();
});

test('no horizontal scroll', async ({ page }) => {
  await page.goto('/');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test('/admin without a session redirects to sign-in', async ({ page }) => {
  await page.goto('/admin');
  await expect(page).toHaveURL(/\/admin\/sign-in$/);
});
