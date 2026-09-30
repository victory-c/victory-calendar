import Link from 'next/link';
import { Suspense } from 'react';
import { quickAction } from '@/app/admin/actions';
import { EventRow } from '@/components/admin/EventRow';
import { btn, Chip, Screen } from '@/components/admin/ui';
import { listDrafts } from '@/lib/admin/events';
import { requireAdmin } from '@/lib/admin-session';

export const metadata = { title: 'Drafts' };

async function Drafts() {
  await requireAdmin();
  const drafts = await listDrafts();
  if (drafts.length === 0) {
    return (
      <p className="py-10 text-center text-muted">
        No drafts · 没有草稿。<Link href="/admin/add" className="underline">Add one · 去添加</Link>
      </p>
    );
  }
  return (
    <ul>
      {drafts.map((e) => (
        <EventRow
          key={e.id}
          e={e}
          chips={
            <>
              {e.autoFields.length > 0 && <Chip tone="ai">AI × {e.autoFields.length}</Chip>}
              {!e.startAt && <Chip tone="seal">需要时间</Chip>}
              {!e.category && <Chip tone="seal">需要类别</Chip>}
              {!e.noteEn && !e.noteZh && <Chip>没有点评</Chip>}
            </>
          }
          actions={
            e.autoFields.length > 0 ? (
              <form action={quickAction.bind(null, e.id, 'confirm')}>
                <button className={btn.small}>Confirm AI · 确认</button>
              </form>
            ) : undefined
          }
        />
      ))}
    </ul>
  );
}

export default function DraftsPage() {
  return (
    <Screen title="Drafts · 草稿" sub="AI chips mark fields the model filled · AI 标记是模型填的字段">
      <Suspense fallback={<p className="text-muted">…</p>}>
        <Drafts />
      </Suspense>
    </Screen>
  );
}
