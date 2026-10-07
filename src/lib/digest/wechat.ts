import { COPY, sealAlt } from '@/emails/copy';
import { publicGoing } from '../events/going';
import type { PublicEvent } from '../events/types';
import { type ExportItem, type ExportModel, exportModel, type ExportOptions } from './social';
import { isDigestSeal } from './select';
import type { DigestEvent, DigestSnapshot } from './types';

// The issue as plain Chinese text for WeChat groups (F17 "微信文字", M3 week 15). One text for
// everyone: Chinese, all seven categories, numbered 1..n in start order so a group can say "3 号有人
// 去吗", grouped by Pacific day. It prints the export model (social.ts) that the long image and the
// Xiaohongshu pages (M4) are drawn from too, so the numbers match everywhere. Rules:
// - No per-reader links: never digestLinks()/linksFor(), so no token, preferences or unsubscribe
//   link can leak into a group chat. No per-event URLs either: each item names its platform and
//   keeps the official title, so it can still be found by search if a link is blocked. One link to
//   the public week page, plus the subscribe page while the newsletter takes sign-ups.
// - Every URL sits alone on its line with nothing after it: WeChat's link detection runs to the next
//   whitespace and would swallow trailing Chinese into the URL (render.ts's text part, same lesson).
// - No emoji, Markdown, street address, cover credit or QR code; 【】 headers and numbers carry the
//   structure (copy.ts: no emoji). Never truncated: a long week gets a warning in the editor instead.
// - A frozen issue (sending or sent) goes through liveState() first, as the /weekly archive does
//   (D8): events taken down since are left out, cancelled ones are marked, seals follow the
//   attendance switch and the live rows. The text goes public, so it must not lag behind the site.
// - Pure: the same snapshot and options always give the same text.

/** origin (publicOrigin() now), subscribe (sign-ups open), cancelled (liveState()): see ExportOptions. */
export type WeChatOptions = ExportOptions;

export type WeChatText = { text: string; chars: number; picks: number; going: number };

/** What liveState() reads from an event's current row; publicEvents() rows fit. */
export type LiveRow = Pick<
  PublicEvent,
  'id' | 'status' | 'going' | 'goingVisibility' | 'category' | 'format' | 'privateVenue' | 'sourceUrl' | 'startAt' | 'endAt' | 'allDay'
>;

const CANCELLED = '[已取消]';

/**
 * A frozen snapshot as things stand now (the archive's rules, D8), for an issue that is sending or
 * sent; a draft's snapshot is assembled live and needs none of this. `live` holds the current
 * published and cancelled rows of the snapshot's events (publicEvents({ ids })), `show` the
 * attendance switch now. The snapshot still decides membership, order and wording; then:
 * - an event with no live row (unpublished since) is dropped;
 * - a cancelled one stays, listed in `cancelled`, with no seal;
 * - a seal stays only while attendance is on (in the snapshot and now) and publicGoing() on the
 *   live row still gives one: the live kind (going → hosting), or the snapshot's once the event is
 *   over ("went" is no digest seal). Only ever narrows: an event without a seal never gains one.
 */
export function liveState(
  snap: DigestSnapshot,
  live: readonly LiveRow[],
  now: Date,
  show: boolean,
): { snap: DigestSnapshot; cancelled: Set<string> } {
  const rows = new Map(live.map((e) => [e.id, e]));
  const attendance = snap.showAttendance && show;
  const cancelled = new Set<string>();
  const current = (list: DigestEvent[]) =>
    list.flatMap((e): DigestEvent[] => {
      const row = rows.get(e.id);
      if (!row) return [];
      if (row.status === 'cancelled') cancelled.add(e.id);
      const g = publicGoing(row, now, attendance);
      const seal =
        isDigestSeal(e.seal) && row.status !== 'cancelled' && g.kind === 'seal' ? (isDigestSeal(g.seal) ? g.seal : e.seal) : null;
      return [seal === e.seal ? e : { ...e, seal }];
    });
  return { snap: { ...snap, showAttendance: attendance, events: current(snap.events), preview: current(snap.preview) }, cancelled };
}

/**
 * Numbered title (with the seal's text label), the official title if different, when · where ·
 * price · platform, the note. A cancelled event (n = null): [已取消] instead of a number, no seal, no note.
 */
function itemLines(it: ExportItem): string[] {
  const seal = it.seal ? `${sealAlt(it.seal, 'zh')} ` : '';
  const lines = [`${it.n === null ? CANCELLED : `${it.n}.`} ${seal}${it.title}`];
  if (it.alt) lines.push(it.alt);
  lines.push(it.meta);
  if (it.note) lines.push(it.note);
  return lines;
}

/** The text to paste, or null when the week has no picks (nothing to post). */
export function wechatText(snap: DigestSnapshot, o: WeChatOptions): WeChatText | null {
  const m = exportModel(snap, o);
  return m && wechatTextOf(m);
}

/** The WeChat text of an export model (export-source.ts builds the model once for text and images). */
export function wechatTextOf(m: ExportModel): WeChatText {
  // Blocks are separated by a blank line; a day header opens the block of that day's first item.
  const blocks: string[][] = [[`${m.site} · ${m.weekOf}`, m.subject]];
  if (m.intro.length) blocks.push(m.intro);
  blocks.push([m.zone]);
  for (const day of m.days) {
    day.items.forEach((it, i) => blocks.push(i === 0 ? [`【${day.label}】`, ...itemLines(it)] : itemLines(it)));
  }
  if (m.preview.length) {
    blocks.push([`【${COPY.zh.preview}】`, ...m.preview.map((p) => `· ${p.cancelled ? `${CANCELLED} ` : ''}${p.title} · ${p.day}`)]);
  }
  blocks.push(['完整列表、报名和加入日历：', m.weekUrl]);
  if (m.subscribeUrl) blocks.push(['每周日收邮件版（可只选关心的类别）：', m.subscribeUrl]);
  blocks.push([m.footer]);

  const text = blocks.map((b) => b.join('\n')).join('\n\n');
  return { text, chars: [...text].length, picks: m.picks, going: m.going };
}
