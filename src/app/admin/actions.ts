'use server';

// Every admin mutation. Server Functions bypass proxy.ts, so each one calls requireAdmin()
// first; anything that can change what the public sees ends with updateTag('events').
import { refresh, updateTag } from 'next/cache';
import { redirect } from 'next/navigation';
import { after } from 'next/server';
import { retranslate } from '@/lib/admin/ai';
import {
  AdminError, cancelEvent, confirmAi, dismissDraft, type EventPatch, getAdminEvent, GOING, GOING_VIS, publish, saveEvent,
  setGoing, unpublish,
} from '@/lib/admin/events';
import { alertWanted, goingSavedMessage, publishedMessage } from '@/lib/admin/going-message';
import { requireAdmin } from '@/lib/admin-session';
import { createToken, revokeToken, type Scope, SCOPES } from '@/lib/api/tokens';
import { type AiTier, generateAiCandidate, isAiTier } from '@/lib/covers/ai';
import { type BraveHit, searchBrave } from '@/lib/covers/brave';
import {
  type BravePick, coverFromAiCandidate, coverFromBrave, coverFromOpenverse, coverFromUpload, coverFromUrl, coverToTemplate, runCoverChain,
} from '@/lib/covers/chain';
import { coverErrorText } from '@/lib/covers/errors';
import { type OpenverseHit, searchOpenverse } from '@/lib/covers/openverse';
import { ingest } from '@/lib/ingest/pipeline';
import { alertsMode } from '@/lib/newsletter/status';
import { peekRemaining } from '@/lib/ratelimit';
import { readSetting, writeSetting } from '@/lib/settings';

export type ActionState = { ok: boolean; message: string; token?: string } | null;

const refreshPublic = () => updateTag('events');
const errText = (e: unknown) => (e instanceof AdminError || e instanceof Error ? e.message : 'error');

// ---- add ---------------------------------------------------------------------------------------

export async function addLink(_prev: ActionState, fd: FormData): Promise<ActionState> {
  await requireAdmin();
  const url = String(fd.get('url') ?? '').trim();
  if (!url) return { ok: false, message: 'Paste a link · 请先粘贴链接' };
  const mode = fd.get('mode') === 'publish' ? 'publish' : 'draft';
  const result = await ingest({
    url,
    comment: String(fd.get('comment') ?? '').trim() || null,
    name: String(fd.get('name') ?? '').trim() || null,
    mode,
    createdVia: fd.get('client') === 'share-target' ? 'share_target' : 'admin',
  });
  if (result.status === 400) return { ok: false, message: result.body.error };
  if (result.status === 409) redirect(`/admin/e/${result.body.existing_id}?added=dup`);
  if (result.status === 202) redirect(`/admin/e/${result.body.id}?added=manual`);
  const { id, status, not_published } = result.body;
  if (status === 'published') refreshPublic();
  after(async () => {
    const r = await runCoverChain({ eventId: id, ...result.cover }).catch((e) => (console.error('[admin] cover chain', e), null));
    if (status === 'published' && r?.coverId) {
      const { revalidateTag } = await import('next/cache');
      revalidateTag('events', { expire: 0 });
    }
  });
  const q = new URLSearchParams({ added: status });
  if (not_published?.length) q.set('blocked', not_published.join(','));
  redirect(`/admin/e/${id}?${q}`);
}

// ---- editor ------------------------------------------------------------------------------------

const TEXT_FIELDS = [
  'titleEn', 'titleZh', 'summaryEn', 'summaryZh', 'noteEn', 'noteZh', 'category', 'eventLanguage', 'tz', 'start', 'end',
  'format', 'venueName', 'city', 'neighborhood', 'address', 'region', 'priceText', 'access', 'hostName', 'hostUrl',
  'sourceUrl', 'coverPolicy', 'tags',
] as const;
const BOOL_FIELDS = ['allDay', 'addressPublic', 'privateVenue', 'featured'] as const;

/** The editor posts every field; checkboxes are only present when ticked. */
function patchFrom(fd: FormData): EventPatch {
  const p: Record<string, unknown> = {};
  for (const k of TEXT_FIELDS) if (fd.has(k)) p[k] = String(fd.get(k));
  for (const k of BOOL_FIELDS) p[k] = fd.get(k) === 'on';
  return p as EventPatch;
}

/**
 * The editor's one form. Every submit saves all fields first, then runs the button that was
 * pressed (`_op`): save | publish | unpublish | cancel | dismiss | confirm | rt:<field>:<to>.
 * Saving first means a re-translate or publish never throws away unsaved edits.
 */
export async function editorAction(id: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  await requireAdmin();
  const op = String(fd.get('_op') ?? 'save');
  let touchedPublic = false;
  try {
    const { changed, event } = await saveEvent(id, patchFrom(fd));
    touchedPublic = changed.length > 0 && event.status !== 'draft';
    let message = changed.length ? 'Saved · 已保存' : 'No changes · 没有改动';
    if (op === 'publish') {
      const r = await publish(id);
      if (!r.ok) return { ok: false, message: `Can't publish yet · 还不能发布，缺少：${r.blockers.map((b) => BLOCKER[b] ?? b).join('、')}` };
      touchedPublic = true;
      // Publishing an event already marked publicly going queues its going alert (F20), unless
      // tomorrow's Sunday digest carries it.
      message = publishedMessage(r.alert);
    } else if (op === 'unpublish') {
      await unpublish(id);
      touchedPublic = true;
      message = 'Taken down · 已下架';
    } else if (op === 'cancel') {
      await cancelEvent(id);
      touchedPublic = true;
      message = 'Marked cancelled · 已标记取消';
    } else if (op === 'dismiss') {
      await dismissDraft(id);
      redirect('/admin/drafts');
    } else if (op === 'confirm') {
      await confirmAi(id);
      message = 'AI fields confirmed · 已确认全部 AI 字段';
    } else if (op.startsWith('rt:')) {
      message = await retranslateInto(id, op);
      touchedPublic = touchedPublic || event.status !== 'draft';
    }
    return { ok: true, message };
  } catch (e) {
    if (e && typeof e === 'object' && 'digest' in e) throw e; // redirect()
    return { ok: false, message: ERR[errText(e)] ?? errText(e) };
  } finally {
    if (touchedPublic) refreshPublic();
    refresh();
  }
}

const BLOCKER: Record<string, string> = { title: '标题', start_at: '开始时间', category: '类别', note: '点评', source_url: '来源链接' };
const ERR: Record<string, string> = {
  end_before_start: 'End is before start · 结束时间早于开始时间',
  source_url: 'Source link must be a plain https link · 来源链接必须是普通 https 链接',
  published_needs_start_and_category: 'A published event needs a start time and a category · 已发布的活动必须有时间和类别',
  ai_unavailable: 'AI is not set up yet · AI 还没配置（checklist 8）',
};

async function retranslateInto(id: string, op: string) {
  const [, field, to] = op.split(':') as [string, 'title' | 'summary' | 'note', 'en' | 'zh'];
  if (!['title', 'summary', 'note'].includes(field) || !['en', 'zh'].includes(to)) throw new Error('bad field');
  const ev = await getAdminEvent(id);
  const source = ev?.[`${field}${to === 'zh' ? 'En' : 'Zh'}` as 'titleEn'] ?? null;
  if (!source) return 'Nothing to translate · 另一种语言还是空的';
  const out = await retranslate(field, source, to);
  await saveEvent(id, { [`${field}${to === 'zh' ? 'Zh' : 'En'}`]: out } as EventPatch);
  return 'Translated · 已重译';
}

/**
 * Going from a list row: the default visibility and no alert switch, so the alert takes its
 * default, on (F20 G5). Same safety rules as the editor: a going that can't be public is stored as
 * after_event. The line says whether an alert was queued.
 */
async function quickGoing(id: string, going: 'going' | 'interested'): Promise<string> {
  // No `alert`: the default (on) for a new mark, and never an explicit switch that would turn a
  // declined alert back on (setGoing's `explicit`).
  const r = await setGoing(id, going, (await readSetting('going_visibility_default')).v);
  refreshPublic();
  return goingSavedMessage(r, { wanted: true, mode: alertsMode() });
}

/**
 * Row buttons in the Drafts and Live lists (no editor fields involved). Plain form actions, which
 * return nothing; QuickGoing (markGoing) is the going button that shows its result line.
 */
export async function quickAction(id: string, op: 'confirm' | 'unpublish' | 'dismiss' | 'going' | 'interested') {
  await requireAdmin();
  if (op === 'going' || op === 'interested') await quickGoing(id, op);
  if (op === 'confirm') await confirmAi(id);
  if (op === 'dismiss') await dismissDraft(id);
  if (op === 'unpublish') {
    await unpublish(id);
    refreshPublic();
  }
  refresh();
}

/** The Live list's 标为会去 / 会去 ✓ toggle with its result line (components/admin/QuickGoing). */
export async function markGoing(id: string, going: 'going' | 'interested', _prev: ActionState): Promise<ActionState> {
  await requireAdmin();
  if (going !== 'going' && going !== 'interested') return { ok: false, message: 'bad value' };
  const message = await quickGoing(id, going);
  refresh();
  return { ok: true, message };
}

/** The editor's going form: status, visibility and (for a public going) the "Alert subscribers" switch. */
export async function saveGoing(id: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  await requireAdmin();
  const going = String(fd.get('going'));
  const vis = String(fd.get('visibility'));
  if (!(GOING as readonly string[]).includes(going) || !(GOING_VIS as readonly string[]).includes(vis)) {
    return { ok: false, message: 'bad value' };
  }
  const wanted = alertWanted(fd);
  // Only a posted switch is Victor's explicit choice (it can turn a declined alert back on);
  // without one, setGoing applies the default.
  const opts = fd.has('alert') ? { alert: wanted } : {};
  const r = await setGoing(id, going as (typeof GOING)[number], vis as (typeof GOING_VIS)[number], undefined, opts);
  refreshPublic();
  refresh();
  return { ok: true, message: goingSavedMessage(r, { wanted, mode: alertsMode() }) };
}

// ---- covers ------------------------------------------------------------------------------------

export async function switchToTemplate(id: string): Promise<ActionState> {
  await requireAdmin();
  try {
    await coverToTemplate(id);
    refreshPublic();
    refresh();
    return { ok: true, message: 'Template cover · 已换成模板封面' };
  } catch (e) {
    return { ok: false, message: errText(e) };
  }
}

export async function coverFromLink(id: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  await requireAdmin();
  const url = String(fd.get('imageUrl') ?? '').trim();
  if (!url) return { ok: false, message: 'Paste an image link · 请粘贴图片链接' };
  try {
    await coverFromUrl(id, url);
    refreshPublic();
    refresh();
    return { ok: true, message: 'Cover updated · 封面已更新' };
  } catch (e) {
    return { ok: false, message: errText(e) };
  }
}

export async function coverFromBlobUpload(id: string, blobUrl: string): Promise<ActionState> {
  await requireAdmin();
  try {
    await coverFromUpload(id, blobUrl);
    refreshPublic();
    refresh();
    return { ok: true, message: 'Cover updated · 封面已更新' };
  } catch (e) {
    return { ok: false, message: errText(e) };
  }
}

// ---- cover selector steps 4–6 (M4 F11): manual only, runCoverChain never reaches them ---------
// Searches return data and change nothing; each costs one of the day's searches (Openverse cache
// hits are free). An AI tap makes a preview only; "Use this" applies it.

export type CoverSearchState<H> = { ok: boolean; message: string; hits?: H[]; remaining?: number | null };
export type AiPreviewState = { ok: boolean; message: string; url?: string; tier?: AiTier; remaining?: number };

// After a failed call the count may still have moved (a failed AI call can be billed).
const leftToday = (name: 'coverOpenverse' | 'coverBrave' | 'coverAi') => peekRemaining(name, 'global').catch(() => null);
const found = (n: number) => (n ? `${n} found · 找到 ${n} 张` : 'Nothing found; try other words · 没找到，换个词试试');
const applied = (lowRes: boolean) =>
  lowRes ? "Cover updated with a smaller copy (original unavailable) · 原图取不到，已用较小的版本作封面" : 'Cover updated · 封面已更新';

export async function searchOpenverseCovers(q: string, page = 1): Promise<CoverSearchState<OpenverseHit>> {
  await requireAdmin();
  try {
    const r = await searchOpenverse(String(q), { page: Number(page) || 1 });
    return { ok: true, message: found(r.hits.length), hits: r.hits, remaining: r.remaining };
  } catch (e) {
    return { ok: false, message: coverErrorText(e), remaining: await leftToday('coverOpenverse') };
  }
}

export async function searchBraveCovers(q: string): Promise<CoverSearchState<BraveHit>> {
  await requireAdmin();
  try {
    const r = await searchBrave(String(q));
    return { ok: true, message: found(r.hits.length), hits: r.hits, remaining: r.remaining };
  } catch (e) {
    return { ok: false, message: coverErrorText(e), remaining: await leftToday('coverBrave') };
  }
}

export async function pickOpenverseCover(id: string, openverseId: string): Promise<ActionState> {
  await requireAdmin();
  try {
    const { lowRes } = await coverFromOpenverse(id, String(openverseId));
    refreshPublic();
    refresh();
    return { ok: true, message: applied(lowRes) };
  } catch (e) {
    return { ok: false, message: coverErrorText(e) };
  }
}

export async function pickBraveCover(id: string, pick: BravePick): Promise<ActionState> {
  await requireAdmin();
  try {
    const { lowRes } = await coverFromBrave(id, {
      imageUrl: String(pick?.imageUrl ?? ''), pageUrl: String(pick?.pageUrl ?? ''), thumbUrl: pick?.thumbUrl ? String(pick.thumbUrl) : null,
    });
    refreshPublic();
    refresh();
    return { ok: true, message: applied(lowRes) };
  } catch (e) {
    return { ok: false, message: coverErrorText(e) };
  }
}

export async function generateAiCover(id: string, tier: AiTier): Promise<AiPreviewState> {
  await requireAdmin();
  if (!isAiTier(tier)) return { ok: false, message: 'Unknown model · 未知模型' };
  try {
    const r = await generateAiCandidate(id, tier);
    return { ok: true, message: 'Preview ready; nothing changed yet · 预览好了，封面还没换', ...r };
  } catch (e) {
    return { ok: false, message: coverErrorText(e), remaining: (await leftToday('coverAi')) ?? undefined };
  }
}

export async function applyAiCover(id: string, previewUrl: string, tier: AiTier): Promise<ActionState> {
  await requireAdmin();
  try {
    await coverFromAiCandidate(id, String(previewUrl), tier);
    refreshPublic();
    refresh();
    return { ok: true, message: applied(false) };
  } catch (e) {
    return { ok: false, message: coverErrorText(e) };
  }
}

// ---- settings ----------------------------------------------------------------------------------

export async function toggleSwitch(key: 'show_attendance' | 'official_covers_to_template', on: boolean) {
  await requireAdmin();
  await writeSetting(key, { on });
  refreshPublic();
  refresh();
}

export async function saveDefaults(fd: FormData) {
  await requireAdmin();
  const policy = fd.get('coverPolicy') === 'template' ? 'template' : 'official';
  const vis = String(fd.get('goingVisibility'));
  await writeSetting('cover_policy_default', { policy });
  if ((GOING_VIS as readonly string[]).includes(vis)) await writeSetting('going_visibility_default', { v: vis as (typeof GOING_VIS)[number] });
  refresh();
}

export async function newToken(_prev: ActionState, fd: FormData): Promise<ActionState> {
  await requireAdmin();
  const name = String(fd.get('name') ?? '').trim().slice(0, 60);
  const scopes = SCOPES.filter((s) => fd.get(`scope_${s}`) === 'on') as Scope[];
  if (!name || scopes.length === 0) return { ok: false, message: 'Name and at least one scope · 需要名字和至少一个权限' };
  const { token } = await createToken(name, scopes);
  refresh();
  return { ok: true, message: 'Copy it now; it is shown once · 只显示这一次，现在复制', token };
}

export async function dropToken(id: string) {
  await requireAdmin();
  await revokeToken(id);
  refresh();
}
