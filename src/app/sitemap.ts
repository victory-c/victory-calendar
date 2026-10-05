import type { MetadataRoute } from 'next';
import { listSentIssues } from '@/lib/digest/archive-queries';
import { getWindow } from '@/lib/events/queries';
import { publicOrigin } from '@/lib/host';
import { newsletterStatus } from '@/lib/newsletter/status';

// Token pages (/confirm, /prefs, /unsubscribe) never join. Digest issues are listed once sent (D7).
const PAGES = ['/', '/calendar', '/going', '/archive', '/weekly', '/about', '/privacy'];

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const origin = publicOrigin();
  const [{ events }, issues] = await Promise.all([getWindow(-1, 90), listSentIssues()]);
  const entry = (path: string, lastModified?: Date): MetadataRoute.Sitemap[number] => {
    const p = path === '/' ? '' : path;
    return {
      url: `${origin}${p || '/'}`,
      lastModified,
      alternates: { languages: { en: `${origin}${p || '/'}`, 'zh-Hans': `${origin}/zh${p}`, 'x-default': `${origin}${p || '/'}` } },
    };
  };
  // /subscribe is noindex while the form is closed, so it is listed only when open.
  const pages = newsletterStatus() === 'open' ? [...PAGES, '/subscribe'] : PAGES;
  return [
    ...pages.map((p) => entry(p)),
    ...issues.map((i) => entry(`/weekly/${i.isoWeek}`, i.sentAt ?? undefined)),
    ...events.filter((e) => e.status === 'published').map((e) => entry(`/events/${e.slug}`, e.publishedAt ?? undefined)),
  ];
}
