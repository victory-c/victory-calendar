import { expect, type Page } from '@playwright/test';
import { Pool } from 'pg';

// Magic links are read back from the database. Specs sign in from several workers at once, so
// "send link → read newest token → verify" runs under a Postgres advisory lock.
const LOCK = 4_207_001;

export async function signInByMagicLink(page: Page, email: string) {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  const client = await pool.connect();
  try {
    await client.query('select pg_advisory_lock($1)', [LOCK]);
    await page.goto('/admin/sign-in');
    await page.getByLabel(/Email link/).fill(email);
    // Better Auth's magic-link plugin allows 5 requests per IP per 60 s; the whole suite sends
    // about that many, so wait the window out instead of failing (callers allow 2 minutes).
    for (let attempt = 0; ; attempt++) {
      await page.getByRole('button', { name: /Send link/ }).click();
      const sent = page.getByText(/Check your inbox/);
      const limited = page.getByText(/Too many requests/);
      await expect(sent.or(limited)).toBeVisible();
      if (await sent.isVisible()) break;
      if (attempt >= 4) throw new Error('magic link still rate-limited');
      await page.waitForTimeout(15_000);
    }
    // Better Auth stores magic-link tokens as verification.identifier (storeToken: "plain").
    const { rows } = await client.query(
      `select identifier from verification where value like $1 order by created_at desc limit 1`,
      [`%${email}%`],
    );
    expect(rows[0]?.identifier).toBeTruthy();
    await page.goto(`/api/auth/magic-link/verify?token=${rows[0].identifier}&callbackURL=%2Fadmin`);
    await expect(page).toHaveURL(/\/admin$/);
  } finally {
    await client.query('select pg_advisory_unlock($1)', [LOCK]).catch(() => undefined);
    client.release();
    await pool.end();
  }
}
