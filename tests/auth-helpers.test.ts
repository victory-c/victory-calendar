import { afterEach, describe, expect, it, vi } from 'vitest';
import { isAuthorizedCron } from '@/lib/cron';
import { maskEmail } from '@/lib/email/send';
import { _resetMemoryLimits, limit } from '@/lib/ratelimit';

afterEach(() => {
  vi.unstubAllEnvs();
  _resetMemoryLimits();
});

describe('cron auth', () => {
  it('requires the exact bearer secret', () => {
    vi.stubEnv('CRON_SECRET', 's3cret');
    const req = (h?: string) => new Request('http://x/api/cron/sync', { headers: h ? { authorization: h } : {} });
    expect(isAuthorizedCron(req('Bearer s3cret'))).toBe(true);
    expect(isAuthorizedCron(req('Bearer nope'))).toBe(false);
    expect(isAuthorizedCron(req())).toBe(false);
  });
  it('fails closed when CRON_SECRET is unset', () => {
    vi.stubEnv('CRON_SECRET', '');
    expect(isAuthorizedCron(new Request('http://x', { headers: { authorization: 'Bearer ' } }))).toBe(false);
  });
});

describe('log hygiene', () => {
  it('masks emails', () => {
    expect(maskEmail('victor@example.com')).toBe('v***@example.com');
    expect(maskEmail('bad')).toBe('***');
  });
});

describe('ratelimit memory fallback', () => {
  it('allows 5 subscribe attempts per IP then blocks', async () => {
    vi.stubEnv('UPSTASH_REDIS_REST_URL', '');
    const results = [];
    for (let i = 0; i < 6; i++) results.push((await limit('subscribeIp', '1.2.3.4')).success);
    expect(results).toEqual([true, true, true, true, true, false]);
    expect((await limit('subscribeIp', '5.6.7.8')).success).toBe(true);
  });
});
