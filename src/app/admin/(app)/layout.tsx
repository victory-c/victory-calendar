import { Suspense } from 'react';
import { TabBar } from '@/components/admin/TabBar';

// Signed-in admin screens: content above the bottom tab bar. Each page checks the session itself
// (requireAdmin inside its Suspense boundary), since Server Functions bypass proxy.ts.
export default function AdminAppLayout({ children }: LayoutProps<'/admin'>) {
  return (
    <>
      <div className="pb-[calc(4.5rem+env(safe-area-inset-bottom))]">{children}</div>
      <Suspense>
        <TabBar />
      </Suspense>
    </>
  );
}
