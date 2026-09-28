import type { MetadataRoute } from 'next';
import { publicOrigin } from '@/lib/host';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: '*', allow: ['/', '/*.ics'], disallow: ['/admin', '/api'] },
    sitemap: `${publicOrigin()}/sitemap.xml`,
  };
}
