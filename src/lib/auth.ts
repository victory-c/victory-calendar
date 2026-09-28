import { passkey } from '@better-auth/passkey';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { APIError, createAuthMiddleware } from 'better-auth/api';
import { nextCookies } from 'better-auth/next-js';
import { magicLink } from 'better-auth/plugins';
import { db } from './db';
import * as authSchema from './db/auth-schema';
import { sendMagicLink } from './email/magic-link';
import { publicHost, publicOrigin } from './host';

export function isAdminEmail(email: string | undefined | null) {
  const admin = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  return Boolean(admin && email && email.trim().toLowerCase() === admin);
}

function createAuth() {
  return betterAuth({
  baseURL: publicOrigin(),
  trustedOrigins: [publicOrigin()],
  database: drizzleAdapter(db, { provider: 'pg', schema: authSchema, transaction: false }),
  session: { expiresIn: 60 * 60 * 24 * 30, updateAge: 60 * 60 * 24 }, // 30-day rolling
  hooks: {
    // Whitelist: any request carrying an email that isn't ADMIN_EMAIL is refused, sign-up included.
    before: createAuthMiddleware(async (ctx) => {
      const email = (ctx.body as { email?: unknown } | undefined)?.email;
      if (typeof email === 'string' && !isAdminEmail(email)) {
        throw new APIError('FORBIDDEN', { message: 'not allowed' });
      }
    }),
  },
  plugins: [
    // disableSignUp must stay false: the first magic-link login *is* the sign-up.
    magicLink({ disableSignUp: false, expiresIn: 300, sendMagicLink: ({ email, url }) => sendMagicLink(email, url) }),
    passkey({ rpID: publicHost().split(':')[0], rpName: "Victor's Picks", origin: publicOrigin() }),
    nextCookies(), // must stay last
  ],
  });
}

type Auth = ReturnType<typeof createAuth>;
let instance: Auth | undefined;
export const getAuth = (): Auth => (instance ??= createAuth());

/**
 * Lazy handle: Better Auth refuses to start in production without BETTER_AUTH_SECRET, and a
 * build must not need runtime secrets. Constructed on first use, at request time.
 */
export const auth = new Proxy({} as Auth, {
  get: (_t, prop) => Reflect.get(getAuth(), prop),
  has: (_t, prop) => Reflect.has(getAuth(), prop),
});

export type Session = Auth['$Infer']['Session'];
