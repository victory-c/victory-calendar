import { maskEmail } from './email/send';

// Error text that is safe to log. Drizzle puts a failed query's bound params (addresses, IPs, user
// agents) on a later line of the message, and providers echo recipients back, so keep only the
// first line of each error in the cause chain, mask any address or link token left in it, and cap
// each line so the root cause stays visible.

const ADDRESS = /[^\s@<>()[\]"',;:]+@[^\s@<>()[\]"',;:]+/g;
const TOKEN = /sub_[0-9a-z]{16}\.[\w-]{43}/g;

export function describeError(err: unknown): string {
  const parts: string[] = [];
  let e: unknown = err;
  for (let i = 0; e != null && i < 3; i++) {
    const raw = e instanceof Error ? `${e.name}: ${e.message.split('\n')[0]}` : String(e).split('\n')[0];
    const line = raw.replace(TOKEN, '[token]').replace(ADDRESS, (m) => maskEmail(m));
    parts.push(line.length > 200 ? `${line.slice(0, 200)}…` : line);
    e = e instanceof Error ? e.cause : undefined;
  }
  return parts.join(' <- ');
}
