import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => ({ db: {} }));

afterEach(() => vi.unstubAllEnvs());

describe('isAdminEmail', () => {
  it('matches ADMIN_EMAIL case-insensitively and nothing else', async () => {
    vi.stubEnv('ADMIN_EMAIL', 'Victor@Example.com');
    const { isAdminEmail } = await import('@/lib/auth');
    expect(isAdminEmail('victor@example.com')).toBe(true);
    expect(isAdminEmail(' VICTOR@example.com ')).toBe(true);
    expect(isAdminEmail('someone@example.com')).toBe(false);
    expect(isAdminEmail(undefined)).toBe(false);
  });
  it('fails closed when ADMIN_EMAIL is unset', async () => {
    vi.stubEnv('ADMIN_EMAIL', '');
    const { isAdminEmail } = await import('@/lib/auth');
    expect(isAdminEmail('')).toBe(false);
    expect(isAdminEmail('a@b.c')).toBe(false);
  });
});
