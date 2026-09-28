import { Suspense } from 'react';
import { PasskeyPanel } from '@/components/admin/PasskeyPanel';
import { requireAdmin } from '@/lib/admin-session';

async function Home() {
  const session = await requireAdmin();
  return (
    <>
      <p className="mt-2 text-muted">Signed in · 已登录：{session.user.email}</p>
      <PasskeyPanel />
    </>
  );
}

export default function AdminHome() {
  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <h1 className="text-h2">Admin · 后台</h1>
      <Suspense fallback={<p className="mt-2 text-muted">…</p>}>
        <Home />
      </Suspense>
    </main>
  );
}
