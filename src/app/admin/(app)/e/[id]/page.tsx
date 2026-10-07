import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { CoverPanel } from '@/components/admin/CoverPanel';
import { EditorShell, type EditorValues } from '@/components/admin/EditorShell';
import { GoingForm } from '@/components/admin/GoingForm';
import { CoverImage } from '@/components/CoverImage';
import { getAdminEvent, toWallTime } from '@/lib/admin/events';
import { requireAdmin } from '@/lib/admin-session';
import { getGoingMark } from '@/lib/alerts/marks';
import { blobConfigured } from '@/lib/covers/blob';
import { braveConfigured } from '@/lib/covers/brave';
import { OPENVERSE_QUERY } from '@/lib/covers/openverse';
import { platformName } from '@/lib/events/platform';
import { fmtWhen } from '@/lib/format/date';
import { aiConfigured } from '@/lib/ingest/extract';
import { alertsMode } from '@/lib/newsletter/status';
import { peekRemaining } from '@/lib/ratelimit';
import { isCategory } from '@/lib/taxonomy';

export const metadata = { title: 'Edit' };

const ADDED: Record<string, string> = {
  draft: 'Saved as a draft · 已存为草稿',
  published: 'Published · 已发布',
  dup: 'Already added; this is the existing event · 这个链接已经添加过，这是已有的活动',
  manual: "Couldn't read the page; fill in the details · 读不到页面内容，请手动补充",
};
const BLOCKER: Record<string, string> = { title: '标题', start_at: '开始时间', category: '类别', note: '点评', cancelled: '活动已取消' };

async function Editor({ params, searchParams }: PageProps<'/admin/e/[id]'>) {
  await requireAdmin();
  const { id } = await params;
  const q = await searchParams;
  const e = await getAdminEvent(id);
  if (!e) notFound();
  const added = typeof q.added === 'string' ? ADDED[q.added] : null;
  const blocked = typeof q.blocked === 'string' ? q.blocked.split(',').map((b) => BLOCKER[b] ?? b) : [];

  const values: EditorValues = {
    titleEn: e.titleEn ?? '', titleZh: e.titleZh ?? '', summaryEn: e.summaryEn ?? '', summaryZh: e.summaryZh ?? '',
    noteEn: e.noteEn ?? '', noteZh: e.noteZh ?? '', category: e.category ?? '', eventLanguage: e.eventLanguage, tz: e.tz,
    start: toWallTime(e.startAt, e.tz), end: toWallTime(e.endAt, e.tz), allDay: e.allDay, format: e.format,
    venueName: e.venueName ?? '', city: e.city ?? '', neighborhood: e.neighborhood ?? '', region: e.region ?? '',
    address: e.address ?? '', addressPublic: e.addressPublic, privateVenue: e.privateVenue, priceText: e.priceText ?? '',
    access: e.access, hostName: e.hostName ?? '', hostUrl: e.hostUrl ?? '', sourceUrl: e.sourceUrl, tags: e.tags.join(', '),
    featured: e.featured, coverPolicy: e.coverPolicy,
  };

  const preview = isCategory(e.category) ? (
    <CoverImage cover={e.cover} category={e.category} hostName={e.hostName} alt="" size={160} locale="zh" />
  ) : (
    <span className="grid size-40 place-items-center rounded-cover border border-dashed border-rule text-sm text-muted">先选类别</span>
  );

  // Cover selector steps 4–6: what's configured, and today's searches / generations left.
  const left = (name: Parameters<typeof peekRemaining>[0]) => peekRemaining(name, 'global').catch(() => null);
  // The going form's alert switch starts from the stored mark (F20), so a declined alert shows off.
  const [openverse, brave, ai, mark] = await Promise.all([left('coverOpenverse'), left('coverBrave'), left('coverAi'), getGoingMark(e.id)]);
  const now = new Date(); // after the admin session (request data): fine under Cache Components
  const sources = {
    blobReady: blobConfigured(), aiReady: aiConfigured(), braveReady: braveConfigured(),
    openverseQuery: isCategory(e.category) ? OPENVERSE_QUERY[e.category] : '',
    braveQuery: (e.titleEn || e.titleZh || '').slice(0, 200),
    remaining: { openverse, brave, ai },
  };

  return (
    <>
      {(added || blocked.length > 0) && (
        <p role="status" className="mx-auto max-w-5xl px-4 pt-4 text-sm">
          {added}
          {blocked.length > 0 && <span className="text-seal-text"> · 没有发布，缺少：{blocked.join('、')}</span>}
        </p>
      )}
      <EditorShell
        id={e.id}
        version={e.updatedAt.getTime()}
        status={e.status}
        values={values}
        autoFields={e.autoFields}
        heading={e.titleZh || e.titleEn || platformName(e.sourceUrl) || 'Untitled'}
        when={e.startAt ? fmtWhen({ startAt: e.startAt, endAt: e.endAt, allDay: e.allDay }, 'zh') : null}
        publicHref={e.status === 'published' || e.status === 'cancelled' ? `/events/${e.slug}` : null}
        cover={<CoverPanel id={e.id} preview={preview} kind={e.cover?.kind ?? null} letterboxed={e.cover?.letterboxed ?? false} attribution={e.cover?.attribution ?? null} blobReady={blobConfigured()} hasCategory={isCategory(e.category)} sources={sources} />}
        going={
          <GoingForm
            id={e.id}
            going={e.going}
            visibility={e.goingVisibility}
            status={e.status}
            alertOn={mark?.alert ?? true}
            mode={alertsMode()}
            startAt={e.startAt}
            now={now.getTime()}
          />
        }
      />
    </>
  );
}

export default function EditPage(props: PageProps<'/admin/e/[id]'>) {
  return (
    <Suspense fallback={<p className="p-4 text-muted">…</p>}>
      <Editor {...props} />
    </Suspense>
  );
}
