import Link from 'next/link';
import { Suspense } from 'react';
import { InboxList, type InboxItem } from '@/components/admin/InboxList';
import { Screen } from '@/components/admin/ui';
import { requireAdmin } from '@/lib/admin-session';
import { feedStatus, listInbox } from '@/lib/inbox/candidates';
import { configuredFeeds, FEED_KINDS, feedEnvName } from '@/lib/inbox/sync-ics';

export const metadata = { title: 'Inbox' };
// Server Actions on this page run ingest for up to a few rows in parallel.
export const maxDuration = 60;

const FEED_LABEL = { gcal: 'Google Calendar', luma: 'Luma', partiful: 'Partiful' } as const;

async function Inbox({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  await requireAdmin();
  const { view } = await searchParams;
  const hidden = view === 'hidden';
  const now = new Date();
  const [rows, status] = await Promise.all([listInbox(now), feedStatus()]);
  const configured = new Set(configuredFeeds().map((f) => f.kind));
  const byKind = new Map(status.map((s) => [s.source, s]));

  const items: InboxItem[] = rows
    .filter((r) => (hidden ? r.view === 'snoozed' || r.view === 'dismissed' : r.view === 'inbox' || r.view === 'added'))
    .map((r) => ({
      id: r.id,
      title: r.title,
      startAt: r.startAt.toISOString(),
      endAt: r.endAt?.toISOString() ?? null,
      location: r.location,
      links: r.links,
      sourceKinds: r.sourceKinds,
      suggestComment: r.suggestComment,
      suggestGoing: r.suggestGoing,
      cancelled: r.eventStatus === 'CANCELLED',
      view: r.view,
      snoozedUntil: r.snoozedUntil?.toISOString() ?? null,
      event: r.event ? { id: r.event.id, status: r.event.status, going: r.event.going } : null,
    }));
  const hiddenCount = rows.filter((r) => r.view === 'snoozed' || r.view === 'dismissed').length;

  return (
    <>
      <ul className="mb-4 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted" aria-label="Feeds · 订阅源">
        {FEED_KINDS.map((k) => {
          const s = byKind.get(k);
          const state = !configured.has(k)
            ? `未配置 ${feedEnvName(k)}`
            : s?.error
              ? `出错 ${s.error}`
              : s?.lastOkAt
                ? `同步于 ${s.lastOkAt.toLocaleString('zh-CN', { timeZone: 'America/Los_Angeles', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`
                : '还没同步';
          return (
            <li key={k}>
              <span className={s?.error ? 'text-seal-text' : undefined}>
                {FEED_LABEL[k]} · {state}
              </span>
            </li>
          );
        })}
      </ul>
      <InboxList items={items} hidden={hidden} autoSync={!hidden && configured.size > 0} />
      <p className="mt-6 text-center text-sm text-muted">
        {hidden ? (
          <Link href="/admin/inbox" className="underline">Back to inbox · 返回收件箱</Link>
        ) : hiddenCount > 0 ? (
          <Link href="/admin/inbox?view=hidden" className="underline">
            Snoozed or dismissed · 稍后与已忽略（{hiddenCount}）
          </Link>
        ) : null}
      </p>
    </>
  );
}

export default function InboxPage({ searchParams }: PageProps<'/admin/inbox'>) {
  return (
    <Screen title="Inbox · 收件箱" sub="Private until you add it · 勾选添加之前都不会公开">
      <Suspense fallback={<p className="text-muted">…</p>}>
        <Inbox searchParams={searchParams as Promise<{ view?: string }>} />
      </Suspense>
    </Screen>
  );
}
