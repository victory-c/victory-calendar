import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

const nextConfig: NextConfig = {
  cacheComponents: true,
  typedRoutes: false,
  poweredByHeader: false,
  // ical-timezones reads its VTIMEZONE files relative to __dirname, which bundling breaks.
  serverExternalPackages: ['@touch4it/ical-timezones'],
  outputFileTracingIncludes: {
    '/calendar.ics': ['./node_modules/@touch4it/ical-timezones/zones/**/*'],
    '/calendar/going.ics': ['./node_modules/@touch4it/ical-timezones/zones/**/*'],
    '/ics/[slug]': ['./node_modules/@touch4it/ical-timezones/zones/**/*'],
  },
  async headers() {
    return [
      // Font slices are content-hashed; the index stylesheets are not.
      { source: '/fonts/:dir/:file*', headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }] },
      { source: '/fonts/:sheet.css', headers: [{ key: 'Cache-Control', value: 'public, max-age=86400, stale-while-revalidate=604800' }] },
    ];
  },
  async rewrites() {
    // App Router can't have a dynamic segment with a suffix; /events/x.ics → /ics/x.
    return [{ source: '/events/:slug.ics', destination: '/ics/:slug' }];
  },
};

export default withNextIntl(nextConfig);
