import { type BrowserContext, expect, test } from '@playwright/test';
import { Pool } from 'pg';
import { signInByMagicLink } from './helpers/admin';

// Week 10 admin flow on a real database: add → edit → publish → public page → take down.
// The link is one ingest can't read (SSRF-blocked), so nothing leaves the machine and the
// editor has to be filled by hand, which is the path this test cares about.
const email = process.env.ADMIN_EMAIL;
test.skip(!process.env.DATABASE_URL || !email, 'needs DATABASE_URL and ADMIN_EMAIL');
test.beforeEach(() => test.skip(test.info().project.name !== 'mobile', 'one phone-sized run is enough'));

const db = () => new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });

// One magic-link sign-in for the whole file (the endpoint allows 5 per minute per IP); the
// tests reuse its cookies.
test.describe.configure({ mode: 'serial' });
let session: Awaited<ReturnType<BrowserContext['storageState']>>;
test.beforeAll(async ({ browser }, info) => {
  if (info.project.name !== 'mobile') return;
  info.setTimeout(120_000);
  const context = await browser.newContext({ baseURL: info.project.use.baseURL });
  await signInByMagicLink(await context.newPage(), email!);
  session = await context.storageState();
  await context.close();
});
test.use({ storageState: async ({}, provide) => provide(session) });

test('add a link, finish it in the editor, publish, take down', async ({ page }) => {
  const marker = `e2e-${Date.now()}`;
  const url = `https://127.0.0.1/${marker}`;
  const title = `E2E Picks Night ${marker.slice(-6)}`;
  try {
    await page.goto('/admin');
    await expect(page.getByRole('navigation', { name: 'Admin' })).toBeVisible();

    await page.goto('/admin/add');
    await expect(page.getByRole('navigation', { name: 'Admin' })).toHaveCount(0); // Add hides the tab bar
    await page.getByLabel(/Link · 活动链接/).fill(url);
    await page.getByLabel(/Note · 点评/).fill('Worth it for the demos');
    await page.getByRole('button', { name: /Save draft/ }).click();
    await expect(page).toHaveURL(/\/admin\/e\/evt_\w+\?added=manual/);
    await expect(page.getByText(/Couldn't read the page/)).toBeVisible();

    // Publishing now fails the gate and says what is missing.
    await page.getByRole('button', { name: /Publish · 发布/ }).click();
    await expect(page.getByText(/还不能发布，缺少：标题、开始时间、类别/)).toBeVisible();

    await page.getByRole('tab', { name: 'EN' }).click();
    await page.getByLabel('Title', { exact: true }).fill(title);
    await page.getByRole('tab', { name: /Details/ }).click();
    await page.getByLabel(/Category · 类别/).selectOption('ai');
    const d = new Date(Date.now() + 2 * 864e5);
    const day = d.toISOString().slice(0, 10);
    await page.getByLabel(/Starts · 开始/).fill(`${day}T18:30`);
    await page.getByLabel(/Ends · 结束/).fill(`${day}T20:00`);
    await page.getByLabel(/RSVP link/).fill('https://luma.com/e2e-picks-night');
    await page.getByRole('button', { name: /Publish · 发布/ }).click();
    await expect(page.getByText('Published · 已发布')).toBeVisible();

    // Going: a public going on a listed platform stays public.
    await page.getByLabel(/Status · 状态/).selectOption('going');
    await page.getByRole('button', { name: /Save going/ }).click();
    await expect(page.getByText('Saved · 已保存').last()).toBeVisible();

    const pool = db();
    const { rows } = await pool.query(`select slug, status, cover_id, going, going_visibility from events where title_en = $1`, [title]);
    await pool.end();
    expect(rows[0]).toMatchObject({ status: 'published', going: 'going', going_visibility: 'public' });
    expect(rows[0].cover_id).toBeTruthy(); // template cover added on publish

    await page.goto(`/events/${rows[0].slug}`);
    await expect(page.getByRole('heading', { name: title })).toBeVisible();

    await page.goto('/admin/live');
    const row = page.getByRole('listitem').filter({ hasText: title });
    await expect(row).toBeVisible();
    await row.getByRole('button', { name: /Take down/ }).click();
    await expect(page.getByRole('listitem').filter({ hasText: title })).toHaveCount(0);
    expect((await page.request.get(`/events/${rows[0].slug}`)).status()).toBe(404);
  } finally {
    const pool = db();
    await pool.query(`delete from event_sources where event_id in (select id from events where source_url like $1 or title_en = $2)`, [`%${marker}%`, title]);
    const { rows } = await pool.query(`delete from events where source_url like $1 or title_en = $2 returning cover_id`, [`%${marker}%`, title]);
    const ids = rows.map((r) => r.cover_id).filter(Boolean);
    if (ids.length) await pool.query(`delete from covers where id = any($1)`, [ids]);
    await pool.end();
  }
});

test('settings: create a token, shown once, then revoke it', async ({ page }) => {
  const name = `e2e token ${Date.now()}`;
  try {
    await page.goto('/admin/settings');
    await page.getByLabel(/Name · 名字/).fill(name);
    await page.getByRole('button', { name: /Create token/ }).click();
    await expect(page.locator('code').filter({ hasText: /^vp_/ })).toBeVisible();
    await page.reload();
    await expect(page.locator('code').filter({ hasText: /^vp_/ })).toHaveCount(0);
    const row = page.getByRole('listitem').filter({ hasText: name });
    await row.getByRole('button', { name: /Revoke/ }).click();
    await expect(page.getByRole('listitem').filter({ hasText: name }).getByRole('button', { name: /Revoke/ })).toHaveCount(0);
  } finally {
    const pool = db();
    await pool.query(`delete from api_tokens where name = $1`, [name]);
    await pool.end();
  }
});

test('manifest and icons are public; admin pages are not', async ({ playwright }, info) => {
  // Signed out on purpose (test.use's storageState would otherwise carry over).
  const request = await playwright.request.newContext({ baseURL: info.project.use.baseURL, storageState: { cookies: [], origins: [] } });
  const m = await request.get('/admin/manifest.webmanifest');
  expect(m.status()).toBe(200);
  const json = await m.json();
  expect(json).toMatchObject({ start_url: '/admin/add', scope: '/admin/', display: 'standalone' });
  expect((await request.get('/admin/icon-192.png')).status()).toBe(200);
  const drafts = await request.get('/admin/drafts', { maxRedirects: 0 });
  expect([302, 303, 307]).toContain(drafts.status());
});
