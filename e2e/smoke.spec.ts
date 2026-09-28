import { expect, test } from '@playwright/test';

test('English home renders with lang="en"', async ({ page }) => {
  const res = await page.goto('/');
  expect(res?.status()).toBe(200);
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.getByRole('link', { name: "Victor's Picks" })).toBeVisible();
});

test('Chinese home renders with lang="zh-Hans"', async ({ page }) => {
  const res = await page.goto('/zh');
  expect(res?.status()).toBe(200);
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-Hans');
  await expect(page.getByRole('link', { name: 'Victor 精选' })).toBeVisible();
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

test('language switch keeps the path and query and sticks', async ({ page }) => {
  await page.goto('/?c=ai');
  const zh = page.getByRole('navigation', { name: 'Language' }).getByRole('link', { name: '中' });
  await expect(zh).toHaveAttribute('href', '/zh?c=ai');
  await zh.click();
  await expect(page).toHaveURL(/\/zh\?c=ai$/);
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-Hans');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('本周精选');
  // The pill hydrates with the query string (its static fallback can't know it).
  const en = page.getByRole('navigation', { name: '语言' }).getByRole('link', { name: 'EN' });
  await expect(en).toHaveAttribute('href', '/en?c=ai');
  await en.click();
  await expect(page).toHaveURL(/\/\?c=ai$/);
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText("This week's picks");
});

test('category chips are pressed buttons that filter via ?c=', async ({ page }) => {
  await page.goto('/');
  const chip = page.getByRole('button', { name: 'Hackathons' });
  await expect(chip).toHaveAttribute('aria-pressed', 'false');
  await chip.click();
  await expect(page).toHaveURL(/\?c=hackathon$/);
  await expect(chip).toHaveAttribute('aria-pressed', 'true');
  const cats = await page.locator('article[data-cat]').evaluateAll((els) => els.map((e) => e.getAttribute('data-cat')));
  expect(new Set(cats)).toEqual(new Set(['hackathon']));
});
