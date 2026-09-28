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

test('language switch keeps the path and query and is the only thing that sets the cookie', async ({ page, context }) => {
  await page.goto('/?c=ai');
  expect((await context.cookies()).find((c) => c.name === 'NEXT_LOCALE')).toBeUndefined();
  const zh = page.getByRole('navigation', { name: 'Language' }).getByRole('link', { name: '中' });
  // The pill hydrates with the query string (its static fallback can't know it).
  await expect(zh).toHaveAttribute('href', '/_locale?l=zh&to=%2Fzh%3Fc%3Dai');
  await zh.click();
  await expect(page).toHaveURL(/\/zh\?c=ai$/);
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-Hans');
  expect((await context.cookies()).find((c) => c.name === 'NEXT_LOCALE')?.value).toBe('zh');
  const en = page.getByRole('navigation', { name: '语言' }).getByRole('link', { name: 'EN' });
  await expect(en).toHaveAttribute('href', '/_locale?l=en&to=%2F%3Fc%3Dai');
  await en.click();
  await expect(page).toHaveURL(/\/\?c=ai$/);
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  expect((await context.cookies()).find((c) => c.name === 'NEXT_LOCALE')?.value).toBe('en');
});

test('opening a shared /zh link does not pin the language', async ({ request }) => {
  const res = await request.get('/zh/about', { headers: { 'accept-language': 'en-US,en;q=0.9' }, maxRedirects: 0 });
  expect(res.status()).toBe(200);
  expect(res.headers()['set-cookie'] ?? '').not.toContain('NEXT_LOCALE');
  const home = await request.get('/', { headers: { 'accept-language': 'en-US,en;q=0.9' }, maxRedirects: 0 });
  expect(home.status()).toBe(200);
});

test('Traditional Chinese first choice goes to /zh even with an English fallback', async ({ request }) => {
  for (const al of ['zh-TW,en-US;q=0.9,en;q=0.8', 'zh-HK,en;q=0.5', 'zh-Hant-TW,en;q=0.9']) {
    const res = await request.get('/about', { headers: { 'accept-language': al }, maxRedirects: 0 });
    expect(res.status(), al).toBe(307);
    expect(res.headers().location, al).toMatch(/\/zh\/about$/);
  }
});

test('the switch endpoint refuses off-site redirects', async ({ request }) => {
  const res = await request.get('/_locale?l=zh&to=//evil.example.com', { maxRedirects: 0 });
  expect(res.status()).toBe(307);
  expect(new URL(res.headers().location, 'http://x').pathname).toBe('/');
});

test('unknown URLs are 404: bilingual server-rendered page for unmatched paths', async ({ request }) => {
  for (const p of ['/zh/nope', '/nope', '/fr', '/events/a/b']) {
    const res = await request.get(p);
    expect(res.status(), p).toBe(404);
    expect(await res.text(), p).toContain('页面不存在');
  }
  for (const p of ['/api', '/.env']) expect((await request.get(p)).status(), p).toBe(404);
});

test('baseline security headers', async ({ request }) => {
  const h = (await request.get('/')).headers();
  expect(h['x-content-type-options']).toBe('nosniff');
  expect(h['x-frame-options']).toBe('DENY');
  expect(h['referrer-policy']).toBe('strict-origin-when-cross-origin');
  expect(h['x-powered-by']).toBeUndefined();
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

test('the switch endpoint cannot be bent into an off-site redirect with dot segments', async ({ request }) => {
  for (const to of ['/.//evil.example.com', '/a/..//evil.example.com', '%2F.%2F%2Fevil.example.com', '/%2e%2e//evil.example.com']) {
    const res = await request.get(`/_locale?l=en&to=${to}`, { maxRedirects: 0 });
    expect(res.status(), to).toBe(307);
    const loc = res.headers().location;
    expect(loc.startsWith('//'), `${to} → ${loc}`).toBe(false);
    expect(new URL(loc, 'http://localhost').host, `${to} → ${loc}`).not.toContain('evil');
  }
});
