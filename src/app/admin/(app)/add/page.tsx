import { Suspense } from 'react';
import { AddForm } from '@/components/admin/AddForm';
import { requireAdmin } from '@/lib/admin-session';

export const metadata = { title: 'Add' };

// Android's share_target lands here too: /admin/add?url=…&text=…&title=… (manifest).
async function Add({ searchParams }: PageProps<'/admin/add'>) {
  await requireAdmin();
  const q = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';
  const shared = one(q.url) || one(q.text).match(/https?:\/\/\S+/)?.[0] || '';
  const client = one(q.url) || one(q.text) ? 'share-target' : null;
  return <AddForm initialUrl={shared} client={client} />;
}

export default function AddPage(props: PageProps<'/admin/add'>) {
  return (
    <Suspense>
      <Add {...props} />
    </Suspense>
  );
}
