import ipaddr from 'ipaddr.js';

/**
 * The visitor's address for the consent record and per-IP limits. Vercel sets x-real-ip and
 * overwrites x-forwarded-for; anything that doesn't parse becomes null (consent_ip is inet).
 */
export function clientIp(h: Headers): string | null {
  const raw = h.get('x-real-ip') ?? h.get('x-forwarded-for')?.split(',')[0]?.trim();
  if (!raw || !ipaddr.isValid(raw)) return null;
  return ipaddr.process(raw).toString();
}
