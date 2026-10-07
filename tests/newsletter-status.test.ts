import { afterEach, describe, expect, it, vi } from 'vitest';
import { alertsMode, digestMode, hasVerifiedSender, linksWork, newsletterStatus, privacyContact } from '@/lib/newsletter/status';

// When the form takes sign-ups (src/lib/newsletter/status.ts). On Vercel the shared resend.dev
// sender only reaches the account owner, so the form must stay closed until RESEND_FROM is on a
// verified domain, whatever way the address is written, and until /privacy has a contact address.

type Env = Partial<
  Record<
    'VERCEL' | 'DATABASE_URL' | 'SUBSCRIBER_LINK_SECRET' | 'RESEND_API_KEY' | 'RESEND_FROM' | 'NEWSLETTER_OPEN' | 'PRIVACY_CONTACT_EMAIL' | 'ADMIN_EMAIL',
    string | undefined
  >
>;

/** Production on Vercel with a database, a link secret, a Resend key and a privacy contact; `over` changes the rest. */
function env(over: Env = {}) {
  const all: Env = {
    VERCEL: '1',
    DATABASE_URL: 'postgres://localhost:5432/never_connected',
    SUBSCRIBER_LINK_SECRET: 'test-secret-status',
    RESEND_API_KEY: 're_test',
    RESEND_FROM: undefined,
    NEWSLETTER_OPEN: undefined,
    PRIVACY_CONTACT_EMAIL: 'privacy@example.org',
    ADMIN_EMAIL: undefined,
    ...over,
  };
  for (const [k, v] of Object.entries(all)) vi.stubEnv(k, v);
}

afterEach(() => vi.unstubAllEnvs());

describe('newsletterStatus on Vercel: the sender decides', () => {
  it.each([
    ['unset', undefined, 'closed'],
    ['empty', '', 'closed'],
    ['the shared sender', 'onboarding@resend.dev', 'closed'],
    ['the shared sender with a display name', "Victor's Picks <onboarding@resend.dev>", 'closed'],
    ['the shared sender in capitals', 'ONBOARDING@RESEND.DEV', 'closed'],
    ['the shared sender with trailing space', 'onboarding@resend.dev  ', 'closed'],
    ['a verified domain with a display name', "Victor's Picks <hi@mail.example.org>", 'open'],
    ['a verified domain, bare', 'hi@mail.example.org', 'open'],
  ] as const)('RESEND_FROM %s → %s', (_label, from, want) => {
    env({ RESEND_FROM: from });
    expect(newsletterStatus()).toBe(want);
    expect(hasVerifiedSender()).toBe(want === 'open');
  });

  it('a verified From without a Resend key is closed', () => {
    env({ RESEND_FROM: "Victor's Picks <hi@mail.example.org>", RESEND_API_KEY: undefined });
    expect(hasVerifiedSender()).toBe(false);
    expect(newsletterStatus()).toBe('closed');
  });
});

describe('newsletterStatus on Vercel: the /privacy contact address (D1)', () => {
  const VERIFIED = "Victor's Picks <hi@mail.example.org>";

  it.each([
    ['unset', undefined],
    ['empty', ''],
    ['blank', '   '],
    ['not an address', 'privacy team'],
    ['two addresses', 'a@example.org, b@example.org'],
    ['an address with a mailto query', 'a@example.org?cc=b@example.org'],
    ['a display name', 'Victor <privacy@example.org>'],
  ] as const)('%s keeps a verified sender closed', (_label, contact) => {
    env({ RESEND_FROM: VERIFIED, PRIVACY_CONTACT_EMAIL: contact });
    expect(hasVerifiedSender()).toBe(true);
    expect(privacyContact()).toBeNull();
    expect(newsletterStatus()).toBe('closed');
  });

  it('a plain address (spaces trimmed) opens it', () => {
    env({ RESEND_FROM: VERIFIED, PRIVACY_CONTACT_EMAIL: '  privacy@example.org ' });
    expect(privacyContact()).toBe('privacy@example.org');
    expect(newsletterStatus()).toBe('open');
  });

  it('never falls back to ADMIN_EMAIL (the sign-in address)', () => {
    env({ RESEND_FROM: VERIFIED, PRIVACY_CONTACT_EMAIL: undefined, ADMIN_EMAIL: 'owner@example.edu' });
    expect(privacyContact()).toBeNull();
    expect(newsletterStatus()).toBe('closed');
  });

  it("NEWSLETTER_OPEN still wins both ways: '1' opens without it, '0' closes with it", () => {
    env({ NEWSLETTER_OPEN: '1', PRIVACY_CONTACT_EMAIL: undefined });
    expect(newsletterStatus()).toBe('open');
    env({ NEWSLETTER_OPEN: '0', RESEND_FROM: VERIFIED });
    expect(newsletterStatus()).toBe('closed');
  });

  it('off Vercel (dev, CI, e2e) it is not needed', () => {
    env({ VERCEL: undefined, PRIVACY_CONTACT_EMAIL: undefined });
    expect(newsletterStatus()).toBe('open');
  });

  it('the address gates only sign-ups: emailed links and the digest send gate ignore it', () => {
    env({ RESEND_FROM: VERIFIED, PRIVACY_CONTACT_EMAIL: undefined });
    expect(linksWork()).toBe(true);
    expect(digestMode()).toBe('live');
  });
});

describe('newsletterStatus: NEWSLETTER_OPEN', () => {
  it("'0' closes it even with a verified sender", () => {
    env({ RESEND_FROM: "Victor's Picks <hi@mail.example.org>", NEWSLETTER_OPEN: '0' });
    expect(newsletterStatus()).toBe('closed');
    vi.stubEnv('VERCEL', undefined);
    expect(newsletterStatus()).toBe('closed');
  });

  it("'1' opens it on Vercel without a verified sender or even a key (owner testing)", () => {
    env({ NEWSLETTER_OPEN: '1', RESEND_FROM: 'onboarding@resend.dev', RESEND_API_KEY: undefined });
    expect(newsletterStatus()).toBe('open');
    expect(hasVerifiedSender()).toBe(false);
  });

  it.each([
    ['no database', { DATABASE_URL: undefined }],
    ['an empty database URL', { DATABASE_URL: '' }],
    ['no link secret', { SUBSCRIBER_LINK_SECRET: undefined }],
    ['an empty link secret', { SUBSCRIBER_LINK_SECRET: '' }],
  ] as const)("'1' cannot open it with %s", (_label, over) => {
    env({ NEWSLETTER_OPEN: '1', RESEND_FROM: "Victor's Picks <hi@mail.example.org>", ...over });
    expect(newsletterStatus()).toBe('closed');
  });

  it('any other value is ignored', () => {
    env({ NEWSLETTER_OPEN: 'true', RESEND_FROM: 'onboarding@resend.dev' });
    expect(newsletterStatus()).toBe('closed');
    env({ NEWSLETTER_OPEN: 'yes', RESEND_FROM: "Victor's Picks <hi@mail.example.org>" });
    expect(newsletterStatus()).toBe('open');
  });
});

describe('newsletterStatus off Vercel (dev, CI, e2e)', () => {
  it('open with a database and a link secret, whatever the sender', () => {
    env({ VERCEL: undefined, RESEND_API_KEY: undefined, RESEND_FROM: 'onboarding@resend.dev' });
    expect(newsletterStatus()).toBe('open');
    vi.stubEnv('VERCEL', '');
    expect(newsletterStatus()).toBe('open');
  });

  it('closed without either', () => {
    env({ VERCEL: undefined, DATABASE_URL: undefined });
    expect(newsletterStatus()).toBe('closed');
    env({ VERCEL: undefined, SUBSCRIBER_LINK_SECRET: undefined });
    expect(newsletterStatus()).toBe('closed');
  });
});

describe('linksWork', () => {
  it('needs only a database and a link secret: emailed links keep working while the form is closed', () => {
    env({ NEWSLETTER_OPEN: '0', RESEND_FROM: 'onboarding@resend.dev', RESEND_API_KEY: undefined });
    expect(newsletterStatus()).toBe('closed');
    expect(linksWork()).toBe(true);
    env({ DATABASE_URL: undefined });
    expect(linksWork()).toBe(false);
    env({ SUBSCRIBER_LINK_SECRET: '' });
    expect(linksWork()).toBe(false);
  });
});

describe('digestMode: the digest send gate', () => {
  const VERIFIED = "Victor's Picks <hi@mail.example.org>";
  it.each([
    // DIGEST_SENDING, VERCEL, RESEND_API_KEY, RESEND_FROM → mode
    ['0', '1', 're_test', VERIFIED, 'off'], // the documented production stop wins over a verified sender
    ['0', undefined, undefined, undefined, 'off'],
    [undefined, '1', 're_test', VERIFIED, 'live'],
    [undefined, undefined, 're_test', VERIFIED, 'live'],
    [undefined, '1', 're_test', 'onboarding@resend.dev', 'off'], // shared sender on Vercel: claim nothing
    [undefined, '1', undefined, undefined, 'off'], // today's production
    [undefined, undefined, undefined, undefined, 'dev'], // local and CI: log transport
    ['', undefined, 're_test', 'onboarding@resend.dev', 'dev'],
    ['false', '1', 're_test', VERIFIED, 'live'], // only the exact value 0 stops it
  ] as const)('DIGEST_SENDING=%s VERCEL=%s key=%s from=%s → %s', (flag, vercel, key, from, want) => {
    env({ VERCEL: vercel, RESEND_API_KEY: key, RESEND_FROM: from });
    vi.stubEnv('DIGEST_SENDING', flag);
    expect(digestMode()).toBe(want);
  });
});

describe('alertsMode: the going-alert send gate (F20)', () => {
  const VERIFIED = "Victor's Picks <hi@mail.example.org>";
  it.each([
    // ALERTS_SENDING, DIGEST_SENDING, VERCEL, RESEND_API_KEY, RESEND_FROM → mode
    [undefined, undefined, '1', 're_test', VERIFIED, 'live'], // follows the digest once a verified sender exists
    [undefined, undefined, '1', undefined, undefined, 'off'], // today's production: claims nothing, opt-ins hidden
    [undefined, undefined, '1', 're_test', 'onboarding@resend.dev', 'off'],
    [undefined, undefined, undefined, undefined, undefined, 'dev'], // local and CI: log transport
    ['0', undefined, '1', 're_test', VERIFIED, 'off'], // alerts alone switched off; the digest keeps sending
    ['0', undefined, undefined, undefined, undefined, 'off'],
    [undefined, '0', '1', 're_test', VERIFIED, 'off'], // the digest's stop stops alerts too
    ['1', '0', undefined, undefined, undefined, 'off'], // ALERTS_SENDING can't switch on what the digest gate keeps off
    ['false', undefined, '1', 're_test', VERIFIED, 'live'], // only the exact value 0 stops it
    ['', undefined, undefined, 're_test', VERIFIED, 'live'],
  ] as const)('ALERTS_SENDING=%s DIGEST_SENDING=%s VERCEL=%s key=%s from=%s → %s', (alerts, digest, vercel, key, from, want) => {
    env({ VERCEL: vercel, RESEND_API_KEY: key, RESEND_FROM: from });
    vi.stubEnv('ALERTS_SENDING', alerts);
    vi.stubEnv('DIGEST_SENDING', digest);
    expect(alertsMode()).toBe(want);
  });

  it('ALERTS_SENDING=0 leaves the digest gate alone', () => {
    env({ RESEND_FROM: VERIFIED });
    vi.stubEnv('ALERTS_SENDING', '0');
    expect(alertsMode()).toBe('off');
    expect(digestMode()).toBe('live');
  });
});
