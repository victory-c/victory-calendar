import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

const nextConfig: NextConfig = {
  cacheComponents: true,
  typedRoutes: false,
  poweredByHeader: false,
  // Root layout lives under [locale], so unmatched URLs need app/global-not-found.tsx.
  experimental: { globalNotFound: true },
  async headers() {
    return [
      // Baseline hardening for every response (nothing on this site is meant to be framed).
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
        ],
      },
      // Font slices are content-hashed (8 hex chars); only those get the one-year immutable header,
      // so a 404 for some other name is never cached for a year.
      {
        source: '/fonts/:dir/:file([0-9a-f]{8}\\.woff2)',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }],
      },
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
