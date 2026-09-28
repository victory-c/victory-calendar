import { expect, test } from '@playwright/test';
import { Pool } from 'pg';

// G0 rehearsal: magic link → register passkey → sign out → sign in with passkey.
// Needs a database and ADMIN_EMAIL (.env.local); skipped in CI until CI gets Postgres.
const email = process.env.ADMIN_EMAIL;
test.skip(!process.env.DATABASE_URL || !email, 'needs DATABASE_URL and ADMIN_EMAIL');
test.skip(({ browserName }) => browserName !== 'chromium', 'virtual authenticator is Chromium-only');

async function latestMagicToken() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  try {
    // Better Auth stores magic-link tokens as verification.identifier (storeToken: "plain").
    const { rows } = await pool.query(
      `select identifier from verification where value like $1 order by created_at desc limit 1`,
      [`%${email}%`],
    );
    return rows[0]?.identifier as string | undefined;
  } finally {
    await pool.end();
  }
}

test('admin signs in by magic link, adds a passkey, and signs back in with it', async ({ page, request }) => {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
  });

  const refused = await request.post('/api/auth/sign-in/magic-link', {
    data: { email: 'stranger@example.com', callbackURL: '/admin' },
    headers: { origin: test.info().project.use.baseURL! },
  });
  expect(refused.status()).toBe(403);

  await page.goto('/admin/sign-in');
  await page.getByLabel(/Email link/).fill(email!);
  await page.getByRole('button', { name: /Send link/ }).click();
  await expect(page.getByText(/Check your inbox/)).toBeVisible();

  const token = await latestMagicToken();
  expect(token).toBeTruthy();
  await page.goto(`/api/auth/magic-link/verify?token=${token}&callbackURL=%2Fadmin`);
  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByText(/Signed in/)).toBeVisible();

  await page.getByRole('button', { name: /Add passkey/ }).click();
  await expect(page.getByText(/Passkey added/)).toBeVisible();

  await page.getByRole('button', { name: /Sign out/ }).click();
  await expect(page).toHaveURL(/\/admin\/sign-in$/);

  await page.getByRole('button', { name: /Sign in with passkey/ }).click();
  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByText(/Signed in/)).toBeVisible();
});
