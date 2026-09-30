import { publicOrigin } from '../host';
import type { Category } from '../taxonomy';
import type { covers } from '../db/schema';

/** Template cover image: rendered on demand by /og/template/[category] and cached for a year. */
export function templateUrl(category: Category, hostName: string | null, size = 1200) {
  const q = new URLSearchParams({ s: String(size) });
  if (hostName) q.set('h', hostName);
  return `${publicOrigin()}/og/template/${category}?${q}`;
}

/** covers row for cover chain step 3. The site draws the same tile in CSS and never loads these URLs. */
export function templateCoverRow(category: Category, hostName: string | null): Omit<typeof covers.$inferInsert, 'id'> {
  return {
    kind: 'template', url1600: templateUrl(category, hostName, 1600), url800: templateUrl(category, hostName, 800),
    url400: templateUrl(category, hostName, 400), urlOgEn: '', urlOgZh: '', thumbhash: '', dominant: '', bytes: 0,
  };
}
