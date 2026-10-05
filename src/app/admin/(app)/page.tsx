import Link from 'next/link';
import { Suspense } from 'react';
import { PasskeyPanel } from '@/components/admin/PasskeyPanel';
import { Screen } from '@/components/admin/ui';
import { requireAdmin } from '@/lib/admin-session';

async function More() {
  const session = await requireAdmin();
  return (
    <>
      <p className="text-muted">Signed in · 已登录：{session.user.email}</p>
      <ul className="mt-6 divide-y divide-rule border-y border-rule">
        <li>
          <Link href="/admin/digest" className="flex h-12 items-center justify-between">
            <span>Weekly digest · 周报</span>
            <span aria-hidden>→</span>
          </Link>
        </li>
        <li>
          <Link href="/admin/settings" className="flex h-12 items-center justify-between">
            <span>Settings, tokens, shortcuts · 设置、令牌、快捷指令</span>
            <span aria-hidden>→</span>
          </Link>
        </li>
        <li>
          <Link href="/" className="flex h-12 items-center justify-between">
            <span>Public site · 公开站</span>
            <span aria-hidden>↗</span>
          </Link>
        </li>
      </ul>
      <PasskeyPanel />
    </>
  );
}

export default function AdminHome() {
  return (
    <Screen title="More · 更多">
      <Suspense fallback={<p className="text-muted">…</p>}>
        <More />
      </Suspense>
    </Screen>
  );
}
