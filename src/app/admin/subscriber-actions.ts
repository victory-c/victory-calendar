'use server';

// /admin/subscribers mutations and the lookup (M3 week 15). Server Functions bypass proxy.ts, so the
// one exported action calls requireAdmin() first. The lookup is a POST (this action), never a ?q=
// GET, so an address never lands in a URL, browser history or request logs (DESIGN D14). Suppress
// and Delete take the id from the lookup result, never an address. `_op`: find | suppress | delete.
import { refresh } from 'next/cache';
import { requireAdmin } from '@/lib/admin-session';
import { db } from '@/lib/db';
import { jobsLog } from '@/lib/db/schema';
import { describeError } from '@/lib/log-safe';
import { parseLookup, type SubscriberDetail, subscriberDetail } from '@/lib/subscribers/admin';
import { deleteSubscriber, suppressSubscriberIds } from '@/lib/subscribers/service';

export type LookupState = { ok: boolean; message: string; sub: SubscriberDetail | null } | null;

const ID = /^sub_[0-9a-hjkmnp-tv-z]{16}$/;
const NOT_FOUND: LookupState = { ok: false, message: 'Not found: deleted already? · 找不到（可能已删除）', sub: null };
/**
 * Our suppressed status is one block; Resend keeps its own account-level list after a bounce or
 * complaint, which deleting our row doesn't touch. Left there, a new sign-up's confirmation is
 * withheld and its email.suppressed webhook suppresses the new row again. Removing it is a manual
 * step in Resend for now.
 */
const RESEND_EN =
  'Resend keeps its own suppression list after a bounce or complaint: remove the address there too (Resend Dashboard → Suppressions), or a new sign-up is suppressed again';
const RESEND_ZH = '退信或投诉后 Resend 也会把它记在自己的抑制名单上，请到 Resend 后台 → Suppressions 一并删除，否则重新订阅会再次被抑制';

export async function subscriberAction(_prev: LookupState, fd: FormData): Promise<LookupState> {
  await requireAdmin();
  const op = String(fd.get('_op') ?? 'find');
  try {
    switch (op) {
      case 'find':
        return await find(fd.get('q'));
      case 'suppress':
        return await suppress(String(fd.get('id') ?? ''));
      case 'delete':
        return await remove(String(fd.get('id') ?? ''), fd.get('ack') === 'suppressed');
      default:
        return { ok: false, message: 'Unknown action · 未知操作', sub: null };
    }
  } catch (e) {
    console.error(`[subscribers] admin action ${op} failed: ${describeError(e)}`);
    return { ok: false, message: `Something went wrong · 出错了（${describeError(e).slice(0, 120)}）`, sub: null };
  }
}

/** Exact match only: a whole address, a sub_… id, a link token or a pasted link. No partial search, no list. */
async function find(q: FormDataEntryValue | null): Promise<LookupState> {
  const query = parseLookup(q);
  if (!query) {
    return { ok: false, message: 'Enter a whole email address, a sub_… id or a link from one of our emails · 请输入完整邮箱、sub_… 编号或邮件里的链接', sub: null };
  }
  const sub = await subscriberDetail(query);
  if (!sub) return { ok: false, message: 'No subscriber matches exactly · 没有完全匹配的订阅者', sub: null };
  // Not empty: the status line is a live region, so a match is announced, not only shown.
  return { ok: true, message: 'Found · 已找到', sub };
}

/**
 * Permanent (suppressed is terminal: confirm, prefs and one-click all refuse it). Idempotent: a
 * second press changes nothing and writes no second audit row. A claim in flight is handled by the
 * send itself, which re-checks eligibility (claim.ts marks it ineligible).
 */
async function suppress(id: string): Promise<LookupState> {
  if (!ID.test(id)) return NOT_FOUND;
  const changed = await suppressSubscriberIds([id]);
  if (changed) {
    const now = new Date();
    await db.insert(jobsLog).values({ job: 'admin_suppress', startedAt: now, finishedAt: now, ok: true, detail: { id } });
    refresh();
  }
  const sub = await subscriberDetail({ id });
  if (!sub) return NOT_FOUND;
  return {
    ok: true,
    message: changed ? 'Suppressed: never mailed again · 已永久抑制，不会再收到邮件' : 'Already suppressed · 已经是抑制状态',
    sub,
  };
}

/** DESIGN D2: the row and its send history, one statement with its audit row (service.ts). */
async function remove(id: string, ack: boolean): Promise<LookupState> {
  if (!ID.test(id)) return NOT_FOUND;
  const r = await deleteSubscriber(id, { allowSuppressed: ack });
  if (r.result === 'deleted') {
    refresh();
    // `ack` is only sent for a row the lookup showed as suppressed.
    const message = ack
      ? `Deleted, with ${r.sends} send record(s). ${RESEND_EN} · 已删除（含 ${r.sends} 条发送记录）。${RESEND_ZH}`
      : `Deleted, with ${r.sends} send record(s) · 已删除（含 ${r.sends} 条发送记录）`;
    return { ok: true, message, sub: null };
  }
  if (r.result === 'not_found') return NOT_FOUND;
  const sub = await subscriberDetail({ id });
  if (r.result === 'suppressed') {
    return {
      ok: false,
      message: `On the do-not-send list now: confirm again to delete it with our block. ${RESEND_EN} · 此邮箱已在禁止发送名单上，请再次确认连同我们的封锁一起删除。${RESEND_ZH}`,
      sub,
    };
  }
  return { ok: false, message: 'An email is being sent to them: try again after this send finishes · 正在给这个订阅者发邮件，发完再删', sub };
}
