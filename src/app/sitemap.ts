import type { MetadataRoute } from 'next';
import { getWindow } from '@/lib/events/queries';
import { publicOrigin } from '@/lib/host';
import { newsletterStatus } from '@/lib/newsletter/status';

// /privacy joins in M3 with the newsletter. Token pages (/confirm, /prefs, /unsubscribe) never do.
const PAGES = ['/', '/calendar', '/going', '/archive', '/about'];

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const origin = publicOrigin();
  const { events } = await getWindow(-1, 90);
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
    ...events.filter((e) => e.status === 'published').map((e) => entry(`/events/${e.slug}`, e.publishedAt ?? undefined)),
  ];
}
