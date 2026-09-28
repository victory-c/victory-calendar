import type { Metadata } from 'next';
import Link from 'next/link';
import { fontVars } from './fonts';
import './globals.css';

// URLs that match no route (/zh/nope, /api, /.env, /fr…). The root layout sits under the
// [locale] segment, so this page renders standalone: bilingual, server-side, works without JS.
export const metadata: Metadata = {
  title: "Page not found · 页面不存在 · Victor's Picks",
  robots: { index: false, follow: false },
};

export default function GlobalNotFound() {
  return (
    <html lang="en" className={fontVars}>
      <body className="min-h-dvh">
        <main id="main" className="mx-auto max-w-2xl px-4 py-20">
          <p className="font-mono text-sm text-muted">404</p>
          <h1 className="mt-2 text-h2">
            Page not found · <span lang="zh-Hans">页面不存在</span>
          </h1>
          <ul className="mt-8 flex flex-wrap gap-3 text-sm">
            <li>
              <Link href="/" className="inline-flex h-11 items-center rounded-full border border-rule px-5">
                Back to this week
              </Link>
            </li>
            <li>
              <Link href="/zh" lang="zh-Hans" className="inline-flex h-11 items-center rounded-full border border-rule px-5">
                回到本周
              </Link>
            </li>
          </ul>
        </main>
      </body>
    </html>
  );
}
