// Locale choice (PRD §9): the NEXT_LOCALE cookie is written ONLY by the language switch; without
// it, the visitor's first Accept-Language preference decides — any zh* tag (zh-CN, zh-TW,
// zh-Hant-HK…) means Chinese, everything else English.
export type SiteLocale = 'en' | 'zh';
export const LOCALE_COOKIE = 'NEXT_LOCALE';
export const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export function topLanguage(acceptLanguage: string | null | undefined) {
  if (!acceptLanguage) return null;
  const tags = acceptLanguage
    .split(',')
    .map((part, i) => {
      const [tag, ...params] = part.trim().split(';');
      const q = params.map((p) => p.trim()).find((p) => p.startsWith('q='));
      return { tag: tag.trim().toLowerCase(), q: q ? Number(q.slice(2)) : 1, i };
    })
    .filter((t) => t.tag && Number.isFinite(t.q) && t.q > 0)
    .sort((a, b) => b.q - a.q || a.i - b.i);
  return tags[0]?.tag ?? null;
}

export function preferredLocale(acceptLanguage: string | null | undefined, cookie: string | undefined): SiteLocale {
  if (cookie === 'en' || cookie === 'zh') return cookie;
  const top = topLanguage(acceptLanguage);
  return top && (top === 'zh' || top.startsWith('zh-')) ? 'zh' : 'en';
}

/**
 * Same-origin, path-only redirect target for the language switch; anything else → "/".
 * Checks the NORMALIZED path too: dot segments can turn "/.//evil.com" into "//evil.com",
 * which a Location header would read as a protocol-relative off-site URL.
 */
export function safeReturnPath(to: string | null, origin: string) {
  if (!to || !to.startsWith('/') || to.startsWith('//') || /[\\\u0000-\u001f]/.test(to)) return '/';
  try {
    const u = new URL(to, origin);
    if (u.origin !== origin) return '/';
    const path = u.pathname;
    if (!path.startsWith('/') || path.startsWith('//') || path.includes('\\')) return '/';
    return `${path}${u.search}`;
  } catch {
    return '/';
  }
}

/** Href for the language switch: /_locale?l=zh&to=/zh/events/x?c=ai */
export function switchHref(target: SiteLocale, pathname: string, search?: string) {
  const rest = pathname === '/' ? '' : pathname;
  const path = `${target === 'zh' ? '/zh' : ''}${rest}` || '/';
  const to = `${path}${search ? `?${search}` : ''}`;
  return `/_locale?${new URLSearchParams({ l: target, to })}`;
}
