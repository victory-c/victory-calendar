import { expect, test } from '@playwright/test';
import { Pool } from 'pg';
import { signInByMagicLink } from './helpers/admin';

// G0 rehearsal: magic link → register passkey → sign out → sign in with passkey.
// Needs a database and ADMIN_EMAIL (.env.local); skipped in CI until CI gets Postgres.
const email = process.env.ADMIN_EMAIL;
test.skip(!process.env.DATABASE_URL || !email, 'needs DATABASE_URL and ADMIN_EMAIL');
test.skip(({ browserName }) => browserName !== 'chromium', 'virtual authenticator is Chromium-only');

const cleanups: (() => Promise<void>)[] = [];
test.afterEach(async () => {
  for (const run of cleanups.splice(0)) await run().catch(() => undefined);
});

test('admin signs in by magic link, adds a passkey, and signs back in with it', async ({ page, request }) => {
  test.setTimeout(120_000); // may wait out the magic-link rate limit (see helpers/admin.ts)
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
  });
  // Remove the passkey this run registers (only its own: the other project may be mid-run), or they
  // pile up in the dev database past WebAuthn's 64-entry excludeCredentials limit and registering fails.
  cleanups.push(async () => {
    const { credentials } = await cdp.send('WebAuthn.getCredentials', { authenticatorId });
    const ids = credentials.map((c) => c.credentialId.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''));
    if (!ids.length) return;
    const db = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
    await db.query('delete from passkey where credential_id = any($1)', [ids]).finally(() => db.end());
  });

  const refused = await request.post('/api/auth/sign-in/magic-link', {
    data: { email: 'stranger@example.com', callbackURL: '/admin' },
    headers: { origin: test.info().project.use.baseURL! },
  });
  expect(refused.status()).toBe(403);

  await signInByMagicLink(page, email!);
  await expect(page.getByText(/Signed in/)).toBeVisible();

  await page.getByRole('button', { name: /Add passkey/ }).click();
  await expect(page.getByText(/Passkey added/)).toBeVisible();

  await page.getByRole('button', { name: /Sign out/ }).click();
  await expect(page).toHaveURL(/\/admin\/sign-in$/);

  await page.getByRole('button', { name: /Sign in with passkey/ }).click();
  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByText(/Signed in/)).toBeVisible();
});
