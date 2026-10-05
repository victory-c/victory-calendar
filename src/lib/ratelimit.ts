import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';

// Limits from the guide: subscribe 5 / IP / 10 min and 3 / email / day; tokens 60 / hour. Plus a
// deployment-wide daily cap on subscription email (week 13 review).
export const LIMITS = {
  subscribeIp: { max: 5, window: '10 m' },
  // A day's ceiling per IP too, so one address can't spend the whole daily email budget below.
  subscribeIpDay: { max: 10, window: '1 d' },
  subscribeEmail: { max: 3, window: '1 d' },
  // One budget for every subscription email (confirmations, "already subscribed", resubscribe), so a
  // sign-up flood can't spend Resend Free's 100 a day that magic links and the digest also need.
  // Size it as roughly 100 minus active subscribers minus a margin.
  subscribeSend: { max: Number(process.env.SUBSCRIBE_DAILY_SEND_CAP) || 40, window: '1 d' },
  token: { max: 60, window: '1 h' },
  // Digest test sends from /admin/digest (always to ADMIN_EMAIL); they spend the same Resend budget.
  digestTest: { max: 10, window: '1 d' },
  // Seed rounds (one batch to DIGEST_SEED_EMAILS, at most 10 addresses): 4 a day, ≤ 40 emails.
  digestSeed: { max: 4, window: '1 d' },
} as const;

type LimitName = keyof typeof LIMITS;
type Result = { success: boolean; reset: number; remaining: number };

// The Vercel Marketplace install injects KV_REST_API_*; a direct Upstash setup uses UPSTASH_REDIS_REST_*.
// Redis.fromEnv() reads either pair.
const hasUpstash = () =>
  Boolean(
    (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) ||
      (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN),
  );

const windowMs = (w: string) => {
  const [n, unit] = w.split(' ');
  return Number(n) * ({ s: 1e3, m: 6e4, h: 36e5, d: 864e5 } as Record<string, number>)[unit];
};

// Fallback for local dev and CI (no Upstash): fixed window in process memory.
const memory = new Map<string, { count: number; reset: number }>();
function memoryLimit(name: LimitName, key: string, now = Date.now()): Result {
  const { max, window } = LIMITS[name];
  const k = `${name}:${key}`;
  const cur = memory.get(k);
  if (!cur || cur.reset <= now) {
    memory.set(k, { count: 1, reset: now + windowMs(window) });
    return { success: true, reset: now + windowMs(window), remaining: max - 1 };
  }
  cur.count += 1;
  return { success: cur.count <= max, reset: cur.reset, remaining: Math.max(0, max - cur.count) };
}

const limiters = new Map<LimitName, Ratelimit>();
function upstash(name: LimitName) {
  let l = limiters.get(name);
  if (!l) {
    const { max, window } = LIMITS[name];
    l = new Ratelimit({
      redis: Redis.fromEnv(),
      limiter: Ratelimit.slidingWindow(max, window),
      prefix: `vp:rl:${name}`,
    });
    limiters.set(name, l);
  }
  return l;
}

export async function limit(name: LimitName, key: string): Promise<Result> {
  if (!hasUpstash()) return memoryLimit(name, key);
  const r = await upstash(name).limit(key);
  return { success: r.success, reset: r.reset, remaining: r.remaining };
}

/** Whether `limit(name, key)` would still succeed, without using it up. */
export async function hasRoom(name: LimitName, key: string, now = Date.now()): Promise<boolean> {
  if (!hasUpstash()) {
    const cur = memory.get(`${name}:${key}`);
    return !cur || cur.reset <= now || cur.count < LIMITS[name].max;
  }
  return (await upstash(name).getRemaining(key)).remaining > 0;
}

/** Test hook. */
export function _resetMemoryLimits() {
  memory.clear();
}
