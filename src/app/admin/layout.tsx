import type { Metadata, Viewport } from 'next';
import { dark, light, toHex } from '@/lib/tokens';
import { fontVars } from '../fonts';
import '../globals.css';

// Second root layout: /admin lives outside the [locale] segment (guide「双语实现」).
export const metadata: Metadata = {
  title: { default: "Admin · Victor's Picks", template: "%s · Admin · Victor's Picks" },
  robots: { index: false, follow: false },
  manifest: '/admin/manifest.webmanifest',
  appleWebApp: { capable: true, title: 'Picks', statusBarStyle: 'default' },
  icons: { apple: '/admin/apple-touch-icon.png', icon: '/admin/icon-192.png' },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: toHex(light.paper) },
    { media: '(prefers-color-scheme: dark)', color: toHex(dark.paper) },
  ],
};

export default function AdminLayout({ children }: LayoutProps<'/admin'>) {
  return (
    <html lang="en" className={fontVars}>
      <body className="min-h-dvh">
        {/* eslint-disable-next-line @next/next/no-css-tags -- static CJK slice index, see scripts/fonts-cjk.ts */}
        <link rel="stylesheet" href="/fonts/cjk.css" precedence="default" />
        {children}
      </body>
    </html>
  );
}
