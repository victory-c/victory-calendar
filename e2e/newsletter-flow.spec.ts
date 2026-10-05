import { expect, type Page, test } from '@playwright/test';
import { Pool } from 'pg';
import en from '../messages/en.json';
import zh from '../messages/zh.json';
import { linkToken } from '../src/lib/subscribers/token';
import { CATEGORIES, type Category } from '../src/lib/taxonomy';

// Week 13 double opt-in on a real database: form → pending row → confirm link → preference
// center (save, pause, resume) → manual unsubscribe page → RFC 8058 one-click → resubscribe.
// The confirmation email goes to the server log without RESEND_API_KEY, so the link is rebuilt
// here from the row with the same secret. Locally `pnpm start` is not on Vercel, so the form is
// open whenever the database and the link secret are there.
test.skip(
  !process.env.DATABASE_URL || !process.env.SUBSCRIBER_LINK_SECRET || process.env.NEWSLETTER_OPEN === '0',
  'needs DATABASE_URL and SUBSCRIBER_LINK_SECRET with the form open',
);
test.beforeEach(() => test.skip(test.info().project.name !== 'mobile', 'one phone-sized run is enough'));
test.describe.configure({ mode: 'serial' });
// BotID's challenge script (botid/client/core loads it from this origin; withBotId rewrites it to
// api.vercel.com) is answered locally, so the run needs no internet. `{ b: 1 }` settles the
// challenge without a follow-up script, so the action's POST still carries x-is-human.
test.beforeEach(async ({ page }) => {
  await page.route(
    (u) => u.pathname.endsWith('/a-4-a/c.js'),
    (r) => r.fulfill({ contentType: 'text/javascript', body: 'window.V_C&&window.V_C.push({b:1})' }),
  );
});

const N = { en: en.Newsletter, zh: zh.Newsletter };
const run = `${Date.now()}${Math.floor(Math.random() * 1e4)}`;
const EMAIL = `e2e+${run}@example.com`;
const EMAIL_ZH = `e2e+${run}-zh@example.com`;
// The per-IP limit is 5 per 10 minutes and this file submits four times; a fresh TEST-NET-3
// address per run keeps reruns from tripping it (clientIp reads x-forwarded-for locally).
const IP = `203.0.113.${1 + (Date.now() % 254)}`;
test.use({ extraHTTPHeaders: { 'x-forwarded-for': IP } });

type Row = {
  id: string;
  status: string;
  locale: string;
  categories: string[];
  token_version: number;
  consent_at: Date | null;
  consent_ip: string | null;
  consent_source: string | null;
  confirmed_at: Date | null;
  paused_until: Date | null;
  unsubscribed_at: Date | null;
};

let pool: Pool;
let token = '';
test.beforeAll(({}, info) => {
  if (info.project.name === 'mobile') pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
});
test.afterAll(async ({}, info) => {
  if (info.project.name !== 'mobile') return;
  await pool.query('delete from subscribers where email = any($1::text[])', [[EMAIL, EMAIL_ZH]]);
  await pool.end();
});

async function row(email = EMAIL): Promise<Row | undefined> {
  const { rows } = await pool.query<Row>(
    `select id, status, locale, categories, token_version, consent_at, host(consent_ip) as consent_ip, consent_source,
            confirmed_at, paused_until, unsubscribed_at
       from subscribers where email = $1`,
    [email],
  );
  return rows[0];
}

/** Checkbox or radio by its label. CategoryCheckboxes hides the input inside its label, so click the label. */
async function setChoice(page: Page, role: 'checkbox' | 'radio', name: string, on = true) {
  const input = page.getByRole(role, { name, exact: true });
  if ((await input.isChecked()) !== on) await page.locator('label').filter({ has: input }).click();
  await expect(input).toBeChecked({ checked: on });
}

/** A category chip's check mark: shown only while ticked, so on/off doesn't depend on colour. */
const chipCheck = (page: Page, name: string) =>
  page.locator('label').filter({ has: page.getByRole('checkbox', { name, exact: true }) }).locator('svg');

const label = (c: Category, l: 'en' | 'zh' = 'en') => CATEGORIES[c][l];
const noHorizontalScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

/** Submit the form once it can vouch for itself: hydrated (button enabled) and past the 3 s fill time. */
async function submit(page: Page, path: '/subscribe' | '/zh/subscribe', locale: 'en' | 'zh') {
  const button = page.getByRole('button', { name: N[locale].form.submit, exact: true });
  await expect(button).toBeEnabled();
  await page.waitForTimeout(3_200);
  const action = page.waitForResponse((r) => r.request().method() === 'POST' && new URL(r.url()).pathname === path);
  await button.click();
  const res = await action;
  // The Server Action posts to the page itself through the intl proxy: no redirect on the way.
  expect(res.status()).toBe(200);
  expect(res.request().headers()['next-action']).toBeTruthy();
  // instrumentation-client protects exactly this path, so BotID's challenge header rides along.
  expect(res.request().headers()['x-is-human']).toBeTruthy();
  return res;
}

test('entry points appear while the form is open', async ({ page, request }) => {
  await page.goto('/?c=ai,hackathon');
  const header = page.getByRole('banner').getByRole('link', { name: en.Site.subscribe, exact: true });
  await expect(header).toBeVisible(); // on a phone too
  await expect(header).toHaveAttribute('href', '/subscribe');
  await expect(page.getByRole('contentinfo').getByRole('link', { name: en.Site.subscribe, exact: true })).toHaveAttribute('href', '/subscribe');
  expect(await noHorizontalScroll(page)).toBeLessThanOrEqual(0);

  await page.locator('#subscribe summary').click();
  await expect(page.locator('#subscribe ul a')).toHaveCount(3);
  await expect(page.locator('#subscribe input')).toHaveCount(1);
  await expect(page.locator('#subscribe').getByRole('link', { name: N.en.title })).toHaveAttribute('href', '/subscribe?c=ai,hackathon');

  await page.goto('/zh');
  await expect(page.getByRole('banner').getByRole('link', { name: zh.Site.subscribe, exact: true })).toHaveAttribute('href', '/zh/subscribe');
  expect(await noHorizontalScroll(page)).toBeLessThanOrEqual(0);

  const sitemap = await (await request.get('/sitemap.xml')).text();
  expect(sitemap).toMatch(/\/subscribe<\/loc>/);
});

test('sign up on /subscribe: field errors, then pending with a consent record', async ({ page }) => {
  await page.goto('/subscribe?c=ai');
  await expect(page.getByRole('checkbox', { name: label('ai'), exact: true })).toBeChecked();
  await expect(page.getByRole('checkbox', { name: label('hackathon'), exact: true })).not.toBeChecked();
  await expect(page.getByRole('radio', { name: 'English', exact: true })).toBeChecked();
  await expect(chipCheck(page, label('ai'))).toBeVisible();
  await expect(chipCheck(page, label('hackathon'))).toBeHidden();
  expect(await noHorizontalScroll(page)).toBeLessThanOrEqual(0);

  // Field errors sit under their field and take focus; the status line under the button stays empty.
  const email = page.getByRole('textbox', { name: N.en.form.email, exact: true });
  const status = page.locator('#subscribe-status');
  await email.fill('reader@localhost'); // passes the browser's type=email check, not the server's
  await setChoice(page, 'checkbox', label('ai'), false);
  await expect(chipCheck(page, label('ai'))).toBeHidden();
  await submit(page, '/subscribe', 'en');
  await expect(page.locator('#subscribe-email-error')).toHaveText(N.en.state.invalidEmail);
  await expect(email).toHaveAttribute('aria-invalid', 'true');
  await expect(email).toHaveAttribute('aria-describedby', 'subscribe-email-error');
  await expect(email).toBeFocused();
  await expect(status).toBeEmpty();

  await email.fill(EMAIL.toUpperCase());
  await submit(page, '/subscribe', 'en');
  await expect(page.locator('#category-hint')).toHaveText(N.en.state.noCategory);
  await expect(page.getByRole('checkbox', { name: label('ai'), exact: true })).toBeFocused();
  await expect(page.locator('#subscribe-email-error')).toHaveCount(0);
  await expect(status).toBeEmpty();
  expect(await row()).toBeUndefined();

  await expect(email).toHaveValue(EMAIL.toUpperCase());
  for (const c of ['ai', 'hackathon', 'cycling'] as const) await setChoice(page, 'checkbox', label(c));
  await submit(page, '/subscribe', 'en');
  await expect(page.getByText(N.en.state.pending)).toBeVisible();
  await expect(page.getByText(N.en.state.pendingHint)).toBeVisible();

  const r = await row();
  expect(r).toMatchObject({
    status: 'pending',
    locale: 'en',
    categories: ['ai', 'hackathon', 'cycling'],
    token_version: 1,
    consent_ip: IP,
    consent_source: 'subscribe',
    confirmed_at: null,
  });
  expect(r!.consent_at).toBeTruthy();
  token = linkToken({ id: r!.id, tokenVersion: r!.token_version });
});

test('confirm link: HEAD does nothing, GET activates and lands on prefs with the welcome banner', async ({ page, request }) => {
  const head = await request.head(`/confirm/${token}`, { maxRedirects: 0 });
  expect(head.status()).toBe(200);
  expect((await row())!.status).toBe('pending');

  const res = await page.goto(`/confirm/${token}`);
  expect(res?.status()).toBe(200);
  expect(res?.headers()['x-robots-tag']).toBe('noindex, nofollow');
  await expect(page).toHaveURL(new RegExp(`/prefs/${token.replace('.', '\\.')}\\?welcome=1$`));
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(N.en.prefs.title);
  await expect(page.getByText(N.en.prefs.welcome)).toBeVisible();
  await expect(page.getByText(N.en.prefs.statusActive, { exact: true })).toBeVisible();
  await expect(page.getByText(EMAIL, { exact: false })).toHaveCount(0); // never the address
  expect(await noHorizontalScroll(page)).toBeLessThanOrEqual(0);
  const r = await row();
  expect(r!.status).toBe('active');
  expect(r!.confirmed_at).toBeTruthy();

  // A second click is harmless and says so.
  await page.goto(`/confirm/${token}`);
  await expect(page).toHaveURL(/\?welcome=already$/);
  await expect(page.getByText(N.en.prefs.already)).toBeVisible();
});

test('prefs: change categories and email language, save', async ({ page }) => {
  await page.goto(`/prefs/${token}`);
  await setChoice(page, 'checkbox', label('hackathon'), false);
  await setChoice(page, 'checkbox', label('social'));
  await setChoice(page, 'radio', N.en.form.zh);
  await page.getByRole('button', { name: N.en.prefs.save, exact: true }).click();
  await expect(page.getByText(N.en.prefs.saved)).toBeVisible();
  // Focus comes back to the pressed button once the save settles.
  await expect(page.getByRole('button', { name: N.en.prefs.save, exact: true })).toBeFocused();
  await expect.poll(async () => (await row())?.categories).toEqual(['ai', 'cycling', 'social']);
  expect((await row())!.locale).toBe('zh');
  // The page re-renders from the row.
  await page.reload();
  await expect(page.getByRole('checkbox', { name: label('social'), exact: true })).toBeChecked();
  await expect(page.getByRole('checkbox', { name: label('hackathon'), exact: true })).not.toBeChecked();
  await expect(page.getByRole('radio', { name: N.en.form.zh, exact: true })).toBeChecked();
});

test('prefs: pause for four weeks, then resume', async ({ page }) => {
  await page.goto(`/prefs/${token}`);
  await page.getByRole('button', { name: N.en.prefs.pause, exact: true }).click();
  await expect(page.getByText(N.en.prefs.paused)).toBeVisible();
  await expect(page.getByText(/^Paused until \w+ \d{1,2}, \d{4}$/)).toBeVisible();
  // Same button, now "Resume now", and it keeps focus.
  await expect(page.getByRole('button', { name: N.en.prefs.resume, exact: true })).toBeFocused();
  const paused = await row();
  expect(paused!.status).toBe('paused');
  const days = (paused!.paused_until!.getTime() - Date.now()) / 864e5;
  expect(days).toBeGreaterThan(27.9);
  expect(days).toBeLessThan(28.1);

  await page.getByRole('button', { name: N.en.prefs.resume, exact: true }).click();
  await expect(page.getByText(N.en.prefs.resumed)).toBeVisible();
  await expect(page.getByText(N.en.prefs.statusActive, { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: N.en.prefs.pause, exact: true })).toBeVisible();
  const resumed = await row();
  expect(resumed).toMatchObject({ status: 'active', paused_until: null });
});

test('GET on the one-click URL never unsubscribes; the manual page acts only on a press', async ({ page, request }) => {
  const get = await request.get(`/api/unsubscribe?t=${token}`, { maxRedirects: 0 });
  expect(get.status()).toBe(303);
  const to = new URL(get.headers().location, 'http://localhost');
  // The subscriber switched to Chinese on the prefs page, so the manual page is the zh one.
  expect(to.pathname).toBe('/zh/unsubscribe');
  expect(to.searchParams.get('t')).toBe(token);
  expect((await request.head(`/api/unsubscribe?t=${token}`)).status()).toBe(200);
  expect((await row())!.status).toBe('active');

  await page.goto(to.pathname + to.search);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(N.zh.unsubscribe.title);
  await expect(page.getByText(N.zh.unsubscribe.lead)).toBeVisible();
  const stop = (c: Category) => page.getByRole('button', { name: N.zh.unsubscribe.category.replace('{category}', label(c, 'zh')) });
  for (const c of ['ai', 'cycling', 'social'] as const) await expect(stop(c)).toBeVisible();
  await expect(page.getByRole('button', { name: N.zh.unsubscribe.all, exact: true })).toBeVisible();
  // Loading the page (as a link scanner would, scripts included) changed nothing.
  expect(await row()).toMatchObject({ status: 'active', categories: ['ai', 'cycling', 'social'] });

  await stop('cycling').click();
  const stopped = page.getByText(N.zh.unsubscribe.stopped.replace('{category}', label('cycling', 'zh')));
  await expect(stopped).toBeVisible();
  // refresh() removed the pressed button, so focus moves to the message.
  await expect(stopped).toBeFocused();
  await expect.poll(async () => (await row())?.categories).toEqual(['ai', 'social']);
  expect((await row())!.status).toBe('active');
  await expect(stop('cycling')).toHaveCount(0);
});

test('RFC 8058 one-click POST: 200, no redirect, no cookie, idempotent', async ({ request, page }) => {
  const first = await request.post(`/api/unsubscribe?t=${token}`, { form: { 'List-Unsubscribe': 'One-Click' }, maxRedirects: 0 });
  expect(first.status()).toBe(200);
  expect(first.headers().location).toBeUndefined();
  expect(first.headers()['set-cookie']).toBeUndefined();
  expect(first.headers()['content-type']).toContain('text/plain');
  const r = await row();
  expect(r!.status).toBe('unsubscribed');
  expect(r!.unsubscribed_at).toBeTruthy();

  const again = await request.post(`/api/unsubscribe?t=${token}`, { multipart: { 'List-Unsubscribe': 'One-Click' }, maxRedirects: 0 });
  expect(again.status()).toBe(200);
  expect(again.headers()['set-cookie']).toBeUndefined();
  expect((await row())!.status).toBe('unsubscribed');

  // The manual page now only confirms; the preference center offers the way back.
  await page.goto(`/zh/unsubscribe?t=${token}`);
  await expect(page.getByText(N.zh.unsubscribe.done)).toBeVisible();
  await expect(page.getByRole('button', { name: N.zh.unsubscribe.all, exact: true })).toHaveCount(0);
  await expect(page.getByText(N.zh.unsubscribe.lead)).toHaveCount(0);

  await page.goto(`/prefs/${token}`);
  await expect(page.getByText(N.en.prefs.statusUnsubscribed, { exact: true })).toBeVisible();
  await page.getByRole('button', { name: N.en.prefs.resubscribe, exact: true }).click();
  // Confirmed once already, so holding the link is enough: straight back to active.
  await expect(page.getByText(N.en.prefs.resubscribed)).toBeVisible();
  await expect.poll(async () => (await row())?.status).toBe('active');
});

test('/zh/subscribe posts to itself (no redirect) and records zh consent', async ({ page }) => {
  await page.goto('/zh/subscribe');
  await expect(page.getByRole('radio', { name: '中文', exact: true })).toBeChecked();
  for (const c of ['ai', 'hackathon', 'vc', 'campus', 'conference', 'cycling', 'social'] as const) {
    await expect(page.getByRole('checkbox', { name: label(c, 'zh'), exact: true })).toBeChecked();
  }
  await page.getByRole('textbox', { name: N.zh.form.email, exact: true }).fill(EMAIL_ZH);
  await submit(page, '/zh/subscribe', 'zh');
  await expect(page.getByText(N.zh.state.pending)).toBeVisible();
  expect(await row(EMAIL_ZH)).toMatchObject({
    status: 'pending',
    locale: 'zh',
    categories: ['ai', 'hackathon', 'vc', 'campus', 'conference', 'cycling', 'social'],
    consent_source: 'zh/subscribe',
    consent_ip: IP,
  });
});
