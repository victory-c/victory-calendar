import { connection } from 'next/server';
import { Suspense } from 'react';
import { quickAction } from '@/app/admin/actions';
import { EventRow } from '@/components/admin/EventRow';
import { btn, Chip, Screen } from '@/components/admin/ui';
import { type AdminEvent, listLive } from '@/lib/admin/events';
import { requireAdmin } from '@/lib/admin-session';
import { GOING_LABELS } from '@/lib/taxonomy';

export const metadata = { title: 'Live' };

function Section({ title, list }: { title: string; list: AdminEvent[] }) {
  if (list.length === 0) return null;
  return (
    <section className="mb-6">
      <h2 className="mb-1 font-mono text-xs uppercase text-muted">{title} · {list.length}</h2>
      <ul>
        {list.map((e) => (
          <EventRow
            key={e.id}
            e={e}
            chips={
              e.going !== 'none' && e.going !== 'interested' ? (
                <Chip tone="seal">
                  {GOING_LABELS[e.going].zh}
                  {e.goingVisibility !== 'public' ? ` · ${e.goingVisibility === 'hidden' ? '隐藏' : '活动后'}` : ''}
                </Chip>
              ) : e.going === 'interested' ? (
                <Chip>想去</Chip>
              ) : undefined
            }
            actions={
              <>
                {e.going === 'interested' || e.going === 'going' ? (
                  <form action={quickAction.bind(null, e.id, e.going === 'going' ? 'interested' : 'going')}>
                    <button className={btn.small} aria-pressed={e.going === 'going'}>
                      {e.going === 'going' ? '会去 ✓' : '标为会去'}
                    </button>
                  </form>
                ) : null}
                <form action={quickAction.bind(null, e.id, 'unpublish')}>
                  <button className={btn.small}>Take down · 下架</button>
                </form>
              </>
            }
          />
        ))}
      </ul>
    </section>
  );
}

async function Live() {
  await requireAdmin();
  await connection();
  const { week, later, past } = await listLive(new Date());
  if (week.length + later.length + past.length === 0) return <p className="py-10 text-center text-muted">Nothing published yet · 还没有发布的活动</p>;
  return (
    <>
      <Section title="This week · 本周" list={week} />
      <Section title="Upcoming · 即将" list={later} />
      <Section title="Past 60 days · 过去" list={past} />
    </>
  );
}

export default function LivePage() {
  return (
    <Screen title="Live · 已发布" sub="Set going in the editor · 会去状态在编辑器里设置">
      <Suspense fallback={<p className="text-muted">…</p>}>
        <Live />
      </Suspense>
    </Screen>
  );
}
