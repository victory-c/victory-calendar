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
    '/ics/[lang]/[slug]': ['./node_modules/@touch4it/ical-timezones/zones/**/*'],
  },
  async headers() {
    return [
      // Font slices are content-hashed; the index stylesheets are not.
      { source: '/fonts/:dir/:file*', headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }] },
      { source: '/fonts/:sheet.css', headers: [{ key: 'Cache-Control', value: 'public, max-age=86400, stale-while-revalidate=604800' }] },
    ];
  },
  async rewrites() {
    // App Router can't have a dynamic segment with a suffix; /events/x.ics → /ics/en/x.
    return [
      // Route Handlers see the original URL, so the language travels as a path segment.
      { source: '/events/:slug.ics', destination: '/ics/en/:slug' },
      { source: '/zh/events/:slug.ics', destination: '/ics/zh/:slug' },
      { source: '/feed.xml', destination: '/rss/en' },
      { source: '/zh/feed.xml', destination: '/rss/zh' },
    ];
  },
};

export default withNextIntl(nextConfig);
