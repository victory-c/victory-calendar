import { expect, test } from '@playwright/test';
import { signInByMagicLink } from './helpers/admin';

// G0 rehearsal: magic link → register passkey → sign out → sign in with passkey.
// Needs a database and ADMIN_EMAIL (.env.local); skipped in CI until CI gets Postgres.
const email = process.env.ADMIN_EMAIL;
test.skip(!process.env.DATABASE_URL || !email, 'needs DATABASE_URL and ADMIN_EMAIL');
test.skip(({ browserName }) => browserName !== 'chromium', 'virtual authenticator is Chromium-only');

test('admin signs in by magic link, adds a passkey, and signs back in with it', async ({ page, request }) => {
  test.setTimeout(120_000); // may wait out the magic-link rate limit (see helpers/admin.ts)
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
