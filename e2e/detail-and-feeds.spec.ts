import { expect, test } from '@playwright/test';

// Runs against seed data (CI has no database). Slugs come from src/lib/events/seed.ts.
test.skip(!!process.env.DATABASE_URL && !process.env.E2E_SEEDED, 'seed slugs; run with DATABASE_URL= or after pnpm db:seed');

test('detail page: titles, JSON-LD, hreflang, RSVP and calendar menu', async ({ page }) => {
  await page.goto('/zh/events/chinese-founders-mixer');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('湾区华人创业者交流夜');
  await expect(page.locator('p[lang="en"]', { hasText: 'Chinese Founders Mixer' })).toBeVisible();
  const ld = JSON.parse((await page.locator('script[type="application/ld+json"]').textContent()) ?? '{}');
  expect(ld['@type']).toBe('Event');
  expect(ld.startDate).toMatch(/T19:00-0[78]:00$/);
  await expect(page.locator('link[rel="alternate"][hreflang="zh-Hans"]')).toHaveCount(1);
  await expect(page.getByRole('link', { name: /去 Luma 报名/ })).toHaveAttribute('href', /luma\.com/);
  await page.getByText('加入日历').click();
  const items = page.locator('details ul a');
  await expect(items).toHaveText(['Apple 日历 · .ics', 'Outlook', 'Google 日历']);
});

test('unknown events are 404', async ({ page }) => {
  const res = await page.goto('/events/does-not-exist');
  expect(res?.status()).toBe(404);
});

test('per-event .ics downloads with a VTIMEZONE', async ({ request }) => {
  const res = await request.get('/events/agents-evals-night.ics');
  expect(res.status()).toBe(200);
  expect(res.headers()['content-type']).toContain('text/calendar');
  const body = await res.text();
  expect(body).toContain('BEGIN:VTIMEZONE');
  expect(body).toContain('DTSTART;TZID=America/Los_Angeles');
});

test('category feed filters and ignores unknown slugs', async ({ request }) => {
  const body = await (await request.get('/calendar.ics?c=hackathon,bogus&lang=zh')).text();
  const summaries = body.split(/\r?\n/).filter((l) => l.startsWith('SUMMARY:'));
  expect(summaries.length).toBeGreaterThan(0);
  expect(body).toContain('X-WR-CALNAME:Victor 精选 · 黑客松');
  expect(body).not.toContain('Agents & Evals Night');
});

test('going.ics never includes cycling', async ({ request }) => {
  const body = await (await request.get('/calendar/going.ics')).text();
  expect(body).toContain('BEGIN:VCALENDAR');
  expect(body).not.toContain('Gran Fondo');
});

test('RSS in both languages, robots and sitemap', async ({ request }) => {
  const zh = await (await request.get('/zh/feed.xml')).text();
  expect(zh).toContain('<language>zh-Hans</language>');
  expect(zh).toContain('湾区华人创业者交流夜');
  const en = await (await request.get('/feed.xml')).text();
  expect(en).toContain('<language>en</language>');
  const robots = await (await request.get('/robots.txt')).text();
  expect(robots).toContain('Disallow: /admin');
  expect(robots).toContain('Disallow: /api');
  const sitemap = await (await request.get('/sitemap.xml')).text();
  expect(sitemap).toContain('hreflang="zh-Hans"');
  expect(sitemap).toContain('/events/agents-evals-night');
});

test('zh per-event .ics carries the Chinese title', async ({ request }) => {
  const body = await (await request.get('/zh/events/chinese-founders-mixer.ics')).text();
  expect(body).toContain('湾区华人创业者交流夜');
});

test('multi-day events show when they end', async ({ page }) => {
  await page.goto('/events/weekend-agent-hackathon');
  // Seed dates are relative to today, so match the shape: start day+time – end day+time.
  const text = (await page.locator('main time').first().textContent()) ?? '';
  expect(text).toMatch(/^\w{3}, \w{3} \d{1,2} · 9:00\u00a0AM\u2009–\u2009\w{3}, \w{3} \d{1,2} · 7:00\u00a0PM PT$/);
  await page.goto('/zh/events/weekend-agent-hackathon');
  const zh = (await page.locator('main time').first().textContent()) ?? '';
  expect(zh).toMatch(/^\d{1,2}月\d{1,2}日周. 9:00\u2009–\u2009\d{1,2}月\d{1,2}日周. 19:00 北美太平洋时间$/);
});

test('cycling start points are never published', async ({ page, request }) => {
  await page.goto('/events/east-bay-gran-fondo');
  await expect(page.locator('main')).not.toContainText('Tilden start line');
  const ld = await page.locator('script[type="application/ld+json"]').textContent();
  expect(ld).not.toContain('Tilden');
  const ics = await (await request.get('/events/east-bay-gran-fondo.ics')).text();
  expect(ics).not.toContain('Tilden');
  expect(ics).toContain('LOCATION:Berkeley');
});

test('ICS: UTC DTSTAMP and a final CRLF', async ({ request }) => {
  const body = await (await request.get('/calendar.ics')).text();
  for (const line of body.split('\r\n').filter((l) => l.startsWith('DTSTAMP:'))) expect(line).toMatch(/^DTSTAMP:\d{8}T\d{6}Z$/);
  expect(body.endsWith('END:VCALENDAR\r\n')).toBe(true);
});

test('subscribe menu follows the category selection', async ({ page }) => {
  await page.goto('/zh?c=ai,hackathon');
  await page.getByText('订阅这几类').click();
  const links = page.locator('#subscribe ul a');
  await expect(links).toHaveText(['Apple 日历', 'Outlook', 'Google 日历']);
  await expect(links.first()).toHaveAttribute('href', /^webcal:\/\/.+\/calendar\.ics\?c=ai,hackathon&lang=zh$/);
  await expect(page.locator('#subscribe input')).toHaveValue(/\/calendar\.ics\?c=ai,hackathon&lang=zh$/);
});

test('/going offers the going.ics subscription', async ({ page }) => {
  await page.goto('/going');
  await page.getByText('Subscribe to where Victor is going').click();
  await expect(page.locator('#subscribe ul a').first()).toHaveAttribute('href', /^webcal:\/\/.+\/calendar\/going\.ics$/);
});

test('month views canonicalize to themselves, share tags present', async ({ page }) => {
  await page.goto('/zh/calendar?m=2026-10');
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', /\/zh\/calendar\?m=2026-10$/);
  await expect(page.locator('link[rel="alternate"][hreflang="en"]')).toHaveAttribute('href', /\/calendar\?m=2026-10$/);
  await page.goto('/');
  await expect(page.locator('meta[property="og:site_name"]')).toHaveAttribute('content', "Victor's Picks");
  await expect(page).toHaveTitle("Victor's Picks · This week's picks");
});

test('cancelled events say so in the title', async ({ page }) => {
  await page.goto('/zh/events/build-in-public-happy-hour');
  await expect(page).toHaveTitle(/^\[已取消\] /);
});

test('every list page has a description for share cards', async ({ page }) => {
  for (const p of ['/calendar', '/zh/calendar?m=2026-10', '/week/2026-W41', '/zh/week/2026-W41', '/archive', '/going', '/about', '/']) {
    await page.goto(p);
    await expect(page.locator('meta[name="description"]'), p).toHaveAttribute('content', /.{20,}/);
    await expect(page.locator('meta[property="og:description"]'), p).toHaveAttribute('content', /.{20,}/);
  }
});

test('add-to-calendar menu stays inside a phone screen', async ({ page }, info) => {
  test.skip(info.project.name !== 'mobile', 'phone layout only');
  for (const p of ['/events/bilingual-ai-salon', '/zh/events/weekend-agent-hackathon']) {
    await page.goto(p);
    await page.locator('summary', { hasText: /Add to calendar|加入日历/ }).click();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, p).toBeLessThanOrEqual(0);
    const box = await page.locator('details ul').last().boundingBox();
    const vw = page.viewportSize()!.width;
    expect(box && box.x >= 0 && box.x + box.width <= vw, p).toBe(true);
  }
});
