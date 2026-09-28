import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

const nextConfig: NextConfig = {
  cacheComponents: true,
  typedRoutes: false,
  poweredByHeader: false,
  async rewrites() {
    // App Router can't have a dynamic segment with a suffix; /events/x.ics → /ics/x.
    return [{ source: '/events/:slug.ics', destination: '/ics/:slug' }];
  },
};

export default withNextIntl(nextConfig);
