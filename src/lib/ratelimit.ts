import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';

// Limits from the guide: subscribe 5 / IP / 10 min and 3 / email / day; tokens 60 / hour.
export const LIMITS = {
  subscribeIp: { max: 5, window: '10 m' },
  subscribeEmail: { max: 3, window: '1 d' },
  token: { max: 60, window: '1 h' },
} as const;

type LimitName = keyof typeof LIMITS;
type Result = { success: boolean; reset: number; remaining: number };

const hasUpstash = () => Boolean(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);

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

/** Test hook. */
export function _resetMemoryLimits() {
  memory.clear();
}
