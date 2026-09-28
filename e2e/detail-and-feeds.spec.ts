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
