import 'server-only';
import { inArray } from 'drizzle-orm';
import type { SocialExportProps } from '@/components/admin/SocialExport';
import type { WeChatExportProps } from '@/components/admin/WeChatExport';
import { db } from '../db';
import { eventsPublic } from '../db/schema';
import { publicEvents } from '../events/public-rows';
import { publicOrigin } from '../host';
import { describeError } from '../log-safe';
import { newsletterStatus } from '../newsletter/status';
import { readSetting, showAttendance } from '../settings';
import { buildSnapshot } from './assemble';
import { templateEmailUrl } from './cover';
import { type DigestIssue, getIssueByWeek } from './issues';
import { coverIdOf, type ExportModel, exportHash, exportModel, type ExportOptions, exportWarnings, longPlan, xhsCaption, xhsPlan } from './social';
import type { DigestSnapshot } from './types';
import { type LiveRow, liveState, wechatTextOf } from './wechat';

// Where the WeChat text, the long image and the Xiaohongshu pages get their content (F17). The
// /admin/digest page and the image route (/admin/digest/image/[week]/[name]) both build the export
// model here from the same reads, so the page's ?v= fingerprint matches what the route draws:
// the issue's snapshot (frozen, or assembled live for a draft), and for a frozen one the events'
// live rows and the attendance switch now (liveState(): takedowns, cancellations, kill switch, as
// the /weekly archive does, D8), and each event's cover now. The images also follow
// official_covers_to_template now.

/** `covers`: each event's covers.id now (publicEvents() rows carry the cover but not its id). */
export type Live = { rows: LiveRow[]; show: boolean; covers: ReadonlyMap<string, string | null> };

/** A frozen issue's events as they are now, their cover ids now and the attendance switch now. */
export async function liveFor(snap: DigestSnapshot): Promise<Live> {
  const ids = [...new Set([...snap.events, ...snap.preview].map((e) => e?.id).filter((id): id is string => typeof id === 'string'))];
  const [rows, covers, attendance] = await Promise.all([publicEvents({ ids }), coverIdsOf(ids), showAttendance()]);
  return { rows, covers, show: attendance === true }; // a malformed settings row hides attendance rather than showing it
}

async function coverIdsOf(ids: string[]): Promise<Map<string, string | null>> {
  if (ids.length === 0) return new Map();
  const rows = await db.select({ id: eventsPublic.id, coverId: eventsPublic.coverId }).from(eventsPublic).where(inArray(eventsPublic.id, ids));
  return new Map(rows.map((r) => [r.id, r.coverId]));
}

/**
 * A frozen event whose cover was replaced since the freeze (a takedown back to the template, a new
 * pick: attachCover() always makes a new row and deletes the old one) shows the template, without
 * credit. The model, and so ?v=, changes with it: the browser keeps images for a year under a ?v=,
 * and the old picture was removed for a reason.
 */
function currentCovers(snap: DigestSnapshot, covers: ReadonlyMap<string, string | null>): DigestSnapshot {
  let replaced = false;
  const events = snap.events.map((e) => {
    const id = coverIdOf(e, snap.origin);
    if (id === null || covers.get(e.id) === id) return e;
    replaced = true;
    return { ...e, coverUrl: templateEmailUrl(snap.origin, e.category), coverCredit: null };
  });
  return replaced ? { ...snap, events } : snap;
}

/** Today's public origin (not the snapshot's) and the subscribe link only while sign-ups are open. */
export const exportOptions = (): Omit<ExportOptions, 'cancelled'> => ({ origin: publicOrigin(), subscribe: newsletterStatus() === 'open' });

/** The model of a snapshot as things stand; `live` is set for a frozen snapshot (sending or sent). */
export function exportOf(snap: DigestSnapshot, live: Live | null, now: Date, o = exportOptions()): ExportModel | null {
  const cur = live ? liveState(snap, live.rows, now, live.show) : { snap, cancelled: undefined };
  return exportModel(live ? currentCovers(cur.snap, live.covers) : cur.snap, { ...o, cancelled: cur.cancelled });
}

export type LoadedExport = { issue: DigestIssue; model: ExportModel | null; allToTemplate: boolean };

/** The image route's read: the existing issue of `isoWeek` (null if none; never creates one). */
export async function loadExport(isoWeek: string, now: Date): Promise<LoadedExport | null> {
  const issue = await getIssueByWeek(isoWeek);
  if (!issue) return null;
  const frozen = (issue.snapshot as DigestSnapshot | null) ?? null;
  const [snap, live, toTemplate] = await Promise.all([
    frozen ?? buildSnapshot(issue),
    frozen ? liveFor(frozen) : null,
    readSetting('official_covers_to_template'),
  ]);
  return { issue, model: exportOf(snap, live, now), allToTemplate: Boolean(toTemplate?.on) };
}

/**
 * Props of the two export panels on /admin/digest. `snap` and `live` are the page's own reads
 * (an error string when one failed); independent of the preview's ?l=&c= choice.
 */
export function exportPanels(
  snap: DigestSnapshot | string,
  issue: DigestIssue,
  live: Live | string | null,
  now: Date,
  allToTemplate: boolean,
): { wechat: WeChatExportProps; social: SocialExportProps } {
  const introDrafted = issue.autoFields.includes('intro_zh');
  const base = { week: issue.isoWeek, draft: issue.status === 'draft', introDrafted };
  const failed = (error: string) => ({
    wechat: { text: null, error, introDrafted },
    social: { ...base, error, wechat: null, xhs: null, warnings: [] },
  });
  if (typeof snap === 'string') return failed(`assembly failed: ${snap}`);
  if (typeof live === 'string') return failed(`live events failed: ${live}`);
  try {
    const m = exportOf(snap, live, now);
    if (!m) return { wechat: { text: null, error: null, introDrafted }, social: { ...base, error: null, wechat: null, xhs: null, warnings: [] } };
    const xhs = xhsPlan(m);
    return {
      wechat: { text: wechatTextOf(m).text, error: null, introDrafted },
      social: {
        ...base,
        error: null,
        wechat: { parts: longPlan(m).length, v: exportHash(m, 'wechat', allToTemplate) },
        xhs: { pages: xhs.length, v: exportHash(m, 'xhs'), caption: xhsCaption(m) },
        warnings: exportWarnings(m),
      },
    };
  } catch (e) {
    return failed(describeError(e));
  }
}
