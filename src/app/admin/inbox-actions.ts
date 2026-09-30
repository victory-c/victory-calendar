'use server';

// Candidate inbox mutations. Server Functions bypass proxy.ts, so each one calls requireAdmin()
// first. Adding goes through the same ingest + cover chain as the Add page.
import { refresh, updateTag } from 'next/cache';
import { after } from 'next/server';
import { AdminError, setGoing } from '@/lib/admin/events';
import { requireAdmin } from '@/lib/admin-session';
import { runCoverChain } from '@/lib/covers/chain';
import {
  type Candidate, clearInbox, dismissCandidates, getCandidates, markAdded, restoreCandidates, snoozeCandidates,
} from '@/lib/inbox/candidates';
import { bestLink, type SnoozeFor, snoozeUntil } from '@/lib/inbox/keys';
import { FORCE_COOLDOWN_MS, PAGE_COOLDOWN_MS, syncIcsFeeds } from '@/lib/inbox/sync-ics';
import { ingest } from '@/lib/ingest/pipeline';
import { readSetting } from '@/lib/settings';

export type InboxState = { ok: boolean; message: string } | null;

const FEED_ZH: Record<string, string> = { gcal: 'Google 日历', luma: 'Luma', partiful: 'Partiful' };

/** Opening the page syncs at most every 10 minutes; the refresh button at most every minute. */
export async function syncInbox(force = false): Promise<InboxState> {
  await requireAdmin();
  const r = await syncIcsFeeds({ cooldownMs: force ? FORCE_COOLDOWN_MS : PAGE_COOLDOWN_MS });
  if (!r.ran) {
    if (r.reason === 'no_feeds') return { ok: false, message: 'No calendar feeds set · 还没配置日历订阅地址' };
    return force ? { ok: true, message: 'Synced a moment ago · 刚同步过' } : null;
  }
  refresh();
  const failed = r.feeds.filter((f) => !f.ok);
  const created = r.feeds.reduce((n, f) => n + f.created, 0);
  if (failed.length) {
    return { ok: false, message: `${failed.map((f) => FEED_ZH[f.kind]).join('、')} 同步失败（${failed.map((f) => f.error).join(', ')}）` };
  }
  return { ok: true, message: created ? `${created} new · 新增 ${created} 条` : 'Up to date · 没有新的' };
}

type AddOutcome = { id: string; eventId: string | null; published: boolean; error?: string };

async function addOne(c: Candidate, publish: boolean): Promise<AddOutcome> {
  if (c.eventId) return { id: c.id, eventId: c.eventId, published: false };
  const url = bestLink(c.links);
  if (!url) return { id: c.id, eventId: null, published: false, error: 'no_link' };
  const result = await ingest({
    url,
    comment: c.suggestComment,
    mode: publish ? 'publish' : 'draft',
    name: null,
    fallbackName: c.title,
    createdVia: 'inbox',
  });
  if (result.status === 400) return { id: c.id, eventId: null, published: false, error: result.body.error };
  const eventId = result.status === 409 ? result.body.existing_id : result.body.id;
  await markAdded(c.id, eventId);
  if (result.status !== 201) return { id: c.id, eventId, published: false };
  const published = result.body.status === 'published';
  after(async () => {
    const r = await runCoverChain({ eventId, ...result.cover }).catch((e) => (console.error('[inbox] cover chain', e), null));
    if (published && r?.coverId) {
      const { revalidateTag } = await import('next/cache');
      revalidateTag('events', { expire: 0 });
    }
  });
  return { id: c.id, eventId, published };
}

/** Run `fn` over `items`, at most `n` at a time (each ingest fetches a page and may call the model). */
async function pool<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}

/** 「添加所选」: every selected row through ingest; drafts unless 「直接发布」 is on. */
export async function addCandidates(ids: string[], publish: boolean): Promise<InboxState> {
  await requireAdmin();
  const rows = await getCandidates(ids.slice(0, 50));
  const results = await pool(rows, 4, (c) =>
    addOne(c, publish).catch((e): AddOutcome => {
      console.error('[inbox] add failed', e instanceof Error ? e.message : e);
      return { id: c.id, eventId: null, published: false, error: 'failed' };
    }),
  );
  if (results.some((r) => r.published)) updateTag('events');
  refresh();
  const failed = results.filter((r) => r.error);
  const done = results.length - failed.length;
  if (failed.length) {
    const noLink = failed.filter((r) => r.error === 'no_link').length;
    return {
      ok: done > 0,
      message: `添加了 ${done} 条，${failed.length} 条失败${noLink ? `（${noLink} 条没有链接，请到 Add 页粘贴）` : ''}`,
    };
  }
  return { ok: true, message: publish ? `Added ${done} · 已添加 ${done} 条（能发布的已发布）` : `Added ${done} drafts · 已生成 ${done} 条草稿` };
}

const CYCLE = ['none', 'interested', 'going'] as const;
export type StampGoing = (typeof CYCLE)[number];

/**
 * The row's going stamp. Going belongs to an event, so a row that isn't added yet becomes a
 * draft first; a draft is never public, so this never publishes anything.
 */
export async function setCandidateGoing(id: string, going: StampGoing): Promise<InboxState> {
  await requireAdmin();
  if (!CYCLE.includes(going)) return { ok: false, message: 'bad value' };
  const [c] = await getCandidates([id]);
  if (!c) return { ok: false, message: 'Not found · 找不到这一行' };
  if (going === 'none' && !c.eventId) return { ok: true, message: '' };
  try {
    const added = await addOne(c, false);
    if (!added.eventId) return { ok: false, message: added.error === 'no_link' ? '没有链接，没法记录会去' : `添加失败（${added.error}）` };
    const r = await setGoing(added.eventId, going, (await readSetting('going_visibility_default')).v);
    updateTag('events');
    refresh();
    return { ok: true, message: r.reason ? '已记录，活动结束后才公开' : '已记录' };
  } catch (e) {
    return { ok: false, message: e instanceof AdminError ? e.message : 'failed' };
  }
}

export async function dismissRows(ids: string[]) {
  await requireAdmin();
  await dismissCandidates(ids);
  refresh();
}

export async function snoozeRows(ids: string[], kind: SnoozeFor) {
  await requireAdmin();
  await snoozeCandidates(ids, snoozeUntil(kind === 'next_week' ? 'next_week' : 'tomorrow', new Date()));
  refresh();
}

export async function restoreRows(ids: string[]) {
  await requireAdmin();
  await restoreCandidates(ids);
  refresh();
}

export async function clearInboxData(): Promise<InboxState> {
  await requireAdmin();
  await clearInbox();
  refresh();
  return { ok: true, message: 'Inbox data cleared · 收件箱数据已清空' };
}
