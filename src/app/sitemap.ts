import type { MetadataRoute } from 'next';
import { getWindow } from '@/lib/events/queries';
import { publicOrigin } from '@/lib/host';

// /privacy joins in M3 with the newsletter.
const PAGES = ['/', '/calendar', '/going', '/about'];

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
  return [
    ...PAGES.map((p) => entry(p)),
    ...events.filter((e) => e.status === 'published').map((e) => entry(`/events/${e.slug}`, e.publishedAt ?? undefined)),
  ];
}
