'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

// Guide「PWA 外壳」: bottom tabs Inbox, Add, Drafts, Live, More. Add and the editor hide it and
// show their own sticky action bar instead.
const TABS = [
  { href: '/admin/inbox', zh: '收件箱', en: 'Inbox', d: 'M4 13h4l2 3h4l2-3h4M4 13V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v7M4 13v5a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5' },
  { href: '/admin/add', zh: '添加', en: 'Add', d: 'M12 5v14M5 12h14' },
  { href: '/admin/drafts', zh: '草稿', en: 'Drafts', d: 'M5 4h10l4 4v12H5zM14 4v5h5M8 13h8M8 17h5' },
  { href: '/admin/live', zh: '已发布', en: 'Live', d: 'M4 6h16M4 12h16M4 18h10' },
  { href: '/admin', zh: '更多', en: 'More', d: 'M6 12h.01M12 12h.01M18 12h.01' },
] as const;

export function TabBar() {
  const path = usePathname();
  if (path.startsWith('/admin/add') || path.startsWith('/admin/e/')) return null;
  const active = (href: string) => (href === '/admin' ? path === '/admin' || path.startsWith('/admin/settings') : path.startsWith(href));
  return (
    <nav
      aria-label="Admin"
      className="fixed inset-x-0 bottom-0 z-20 border-t border-rule bg-paper/95 backdrop-blur"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <ul className="mx-auto grid max-w-2xl grid-cols-5">
        {TABS.map((t) => (
          <li key={t.href}>
            <Link
              href={t.href}
              aria-current={active(t.href) ? 'page' : undefined}
              className="flex h-14 flex-col items-center justify-center gap-0.5 text-xs text-muted aria-[current=page]:text-ink"
            >
              <svg aria-hidden viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth={t.href === '/admin' ? 3 : 1.6} strokeLinecap="round" strokeLinejoin="round">
                <path d={t.d} />
              </svg>
              <span lang="zh-Hans">{t.zh}</span>
              <span className="sr-only">{t.en}</span>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
