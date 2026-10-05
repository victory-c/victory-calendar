import { randomBytes } from 'node:crypto';
import { type BrowserContext, expect, test } from '@playwright/test';
import { Pool } from 'pg';
import { coverage, sendAfterFor, upcomingIssueWeek } from '../src/lib/digest/week';
import { signInByMagicLink } from './helpers/admin';

// Week 14 /admin/digest on a real database: More → Digest, schedule refused without intros, write
// both intros (focus stays on Save; an AI draft over a filled intro asks first), the preview renders
// them (zh, then en + one category), schedule (focus moves to the result), read-only while
// scheduled, unschedule. Nothing is mailed: Send test and Send now are never pressed. One
// published event is seeded in the covered week so the preview is a digest, not the empty notice.
// The upcoming week's issue row is restored (or deleted) afterwards; a row that is already
// scheduled or sent is never touched (the test skips).
const email = process.env.ADMIN_EMAIL;
test.skip(!process.env.DATABASE_URL || !email, 'needs DATABASE_URL and ADMIN_EMAIL');
test.beforeEach(() => test.skip(test.info().project.name !== 'mobile', 'one phone-sized run is enough'));

const db = () => new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });

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

type IssueRow = {
  id: string;
  status: string;
  intro_en: string | null;
  intro_zh: string | null;
  featured_ids: string[];
  keep_cover_ids: string[];
  auto_fields: string[];
  send_after: Date | null;
};

const ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz';
const id = (prefix: string) => `${prefix}_${Array.from(randomBytes(16), (b) => ALPHABET[b & 31]).join('')}`;

test('write the intros, preview them, schedule and unschedule', async ({ page }) => {
  test.setTimeout(90_000);
  // The page computes the same week on the server (same machine clock).
  const week = upcomingIssueWeek(new Date());
  const cov = coverage(week);
  const marker = randomBytes(3).toString('hex');
  const EN = `E2E intro ${marker}: a quiet week, one good night.`;
  const ZH = `E2E 开场白 ${marker}：这周不多，但有一晚值得去。`;
  const TITLE_ZH = `E2E 周报活动 ${marker}`;
  const eventId = id('evt');
  const coverId = id('cov');

  const pool = db();
  const { rows: before } = await pool.query<IssueRow>(
    `select id, status, intro_en, intro_zh, featured_ids, keep_cover_ids, auto_fields, send_after from digest_issues where iso_week = $1`,
    [week],
  );
  await pool.end();
  test.skip(before.length > 0 && before[0].status !== 'draft', `${week} is already ${before[0]?.status}; not touching a real issue`);

  try {
    {
      const p = db();
      await p.query(
        `insert into covers (id, kind, url_1600, url_800, url_400, url_og_en, url_og_zh, thumbhash, dominant, bytes)
         values ($1, 'template', 'template:ai', 'template:ai', 'template:ai', '', '', '', '', 0)`,
        [coverId],
      );
      // Wednesday of the covered week, 18:30 PDT/PST-ish: well inside [from, to).
      const start = new Date(cov.from.getTime() + 2 * 864e5 + 18.5 * 3600_000);
      await p.query(
        `insert into events (id, slug, status, source_url, title_en, title_zh, note_en, note_zh, category, start_at, tz, city,
                             format, cover_id, published_at, going)
         values ($1, $2, 'published', $3, $4, $5, 'Worth it for the demos', '值得去看 demo', 'ai', $6, 'America/Los_Angeles',
                 'San Francisco', 'in_person', $7, now(), 'none')`,
        [eventId, `e2e-digest-${marker}`, `https://luma.com/e2e-digest-${marker}`, `E2E Digest Night ${marker}`, TITLE_ZH, start, coverId],
      );
      await p.end();
    }

    // More → Digest; the More tab stays highlighted.
    await page.goto('/admin');
    await page.getByRole('link', { name: /Weekly digest · 周报/ }).click();
    await expect(page).toHaveURL(/\/admin\/digest$/);
    await expect(page.getByRole('heading', { name: 'Digest · 周报' })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Admin' }).getByRole('link', { name: /更多/ })).toHaveAttribute('aria-current', 'page');
    const status = page.getByRole('region', { name: 'Status · 状态' });
    await expect(status).toContainText(week);
    await expect(status).toContainText('Draft · 草稿');

    const en = page.getByLabel(/English intro/);
    const zh = page.getByLabel(/中文开场白/);
    // The editor's own status line, not the WeChat panel's copy status below it.
    const message = page.getByRole('status').and(page.locator('p'));

    // Schedule saves first, then refuses: both intros are required.
    await en.fill('');
    await zh.fill('');
    await page.getByRole('button', { name: 'Schedule · 排期' }).click();
    await expect(message).toContainText('先写好中英文开场白');

    // Write both and save.
    await en.fill(EN);
    await zh.fill(ZH);
    await page.getByRole('button', { name: 'Save · 保存' }).click();
    await expect(message).toHaveText('Saved · 已保存');
    // The fields remount with the saved issue; the status line and Save stay, and so does focus.
    await expect(page.getByRole('button', { name: 'Save · 保存' })).toBeFocused();

    // "Draft from English" over a filled Chinese intro asks first; cancelling posts nothing.
    let asked = '';
    page.once('dialog', (d) => {
      asked = d.message();
      void d.dismiss();
    });
    await page.getByRole('button', { name: '↻ 从英文起草' }).click();
    await expect.poll(() => asked).toContain('用 AI 草稿替换现在的中文开场白');
    await expect(zh).toHaveValue(ZH);
    await expect(message).toHaveText('Saved · 已保存');
    {
      const p = db();
      const { rows } = await p.query<IssueRow>(`select status, intro_en, intro_zh, auto_fields from digest_issues where iso_week = $1`, [week]);
      await p.end();
      expect(rows[0]).toMatchObject({ status: 'draft', intro_en: EN, intro_zh: ZH, auto_fields: [] });
    }

    // Preview: Chinese, all categories by default — a digest with the intro and the seeded event.
    const frame = page.frameLocator('iframe[title="Email preview · 邮件预览"]');
    await expect(page.getByTestId('digest-subject')).toHaveText(/^本周 \d+ 场精选/);
    await expect(frame.locator('body')).toContainText(ZH);
    await expect(frame.locator('body')).toContainText(TITLE_ZH);
    await expect(frame.locator('body')).toContainText('无付费植入');
    await expect(page.getByText(/ KB \/ 90\.0 KB/)).toBeVisible();

    // English, AI only, through the preview form (a GET: the choice is in the URL).
    await page.getByLabel('English', { exact: true }).check();
    for (const name of ['黑客松', '创投与创业者', '校园创业', '大会与主题周', '骑行活动', '社交与玩乐']) {
      await page.getByLabel(name, { exact: true }).uncheck();
    }
    await page.getByRole('button', { name: 'Preview · 预览' }).click();
    await expect(page).toHaveURL(/[?&]l=en/);
    await expect(page).toHaveURL(/[?&]c=ai(&|$)/);
    await expect(page.getByTestId('digest-subject')).toHaveText(/^\d+ picks? this week/);
    await expect(frame.locator('body')).toContainText(EN);
    await expect(frame.locator('body')).toContainText(`E2E Digest Night ${marker}`);

    // Schedule: Sunday 17:00 PT before the covered week; the intros become read-only.
    await page.getByRole('button', { name: 'Schedule · 排期' }).click();
    await expect(message).toContainText('已排期');
    await expect(message).toBeFocused(); // the Schedule button is gone; the result takes focus
    await expect(status).toContainText('Scheduled · 已排期');
    await expect(en).toHaveAttribute('readonly', '');
    await expect(page.getByRole('button', { name: 'Save · 保存' })).toHaveCount(0);
    {
      const p = db();
      const { rows } = await p.query<IssueRow>(`select status, send_after from digest_issues where iso_week = $1`, [week]);
      await p.end();
      expect(rows[0].status).toBe('scheduled');
      expect(new Date(rows[0].send_after!).toISOString()).toBe(sendAfterFor(week).toISOString());
    }

    // Unschedule: back to an editable draft.
    await page.getByRole('button', { name: 'Unschedule · 撤回排期' }).click();
    await expect(message).toContainText('已撤回排期');
    await expect(status).toContainText('Draft · 草稿');
    await expect(en).not.toHaveAttribute('readonly');
    {
      const p = db();
      const { rows } = await p.query<IssueRow>(`select status, send_after from digest_issues where iso_week = $1`, [week]);
      await p.end();
      expect(rows[0]).toMatchObject({ status: 'draft', send_after: null });
    }
  } finally {
    const p = db();
    if (before.length > 0) {
      const b = before[0];
      await p.query(
        `update digest_issues set status = $2, intro_en = $3, intro_zh = $4, featured_ids = $5, keep_cover_ids = $6,
                auto_fields = $7, send_after = $8
          where id = $1`,
        [b.id, b.status, b.intro_en, b.intro_zh, b.featured_ids, b.keep_cover_ids, b.auto_fields, b.send_after],
      );
    } else {
      // Created by opening the page; nothing was ever sent for it (no digest_sends rows).
      await p.query(`delete from digest_issues where iso_week = $1 and status in ('draft', 'scheduled')`, [week]);
    }
    await p.query(`delete from events where id = $1`, [eventId]);
    await p.query(`delete from covers where id = $1`, [coverId]);
    await p.end();
  }
});
