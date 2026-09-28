import type { Metadata, Viewport } from 'next';
import { fontVars } from '../fonts';
import '../globals.css';

// Second root layout: /admin lives outside the [locale] segment (guide「双语实现」).
export const metadata: Metadata = {
  title: { default: "Admin · Victor's Picks", template: "%s · Admin · Victor's Picks" },
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover' };

export default function AdminLayout({ children }: LayoutProps<'/admin'>) {
  return (
    <html lang="en" className={fontVars}>
      <body className="min-h-dvh">{children}</body>
    </html>
  );
}
