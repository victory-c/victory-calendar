import { COPY, sealAlt } from '@/emails/copy';
import { note, titles } from '../events/display';
import { publicGoing } from '../events/going';
import type { PublicEvent } from '../events/types';
import { dayKey, fmtBeijing, fmtDayHeader, fmtTime, PT, zoneLabel } from '../format/date';
import { CATEGORY_SLUGS } from '../taxonomy';
import { ALT_TITLE_MAX, chips, clip, dayLabel, introLines, NOTE_MAX, when, where } from './fields';
import { byStart, isDigestSeal, selectForVariant } from './select';
import type { DigestEvent, DigestSnapshot } from './types';

// The issue as plain Chinese text for WeChat groups (F17 "微信文字", M3 week 15; the long image and
// the Xiaohongshu export come in M4). One text for everyone: Chinese, all seven categories, numbered
// 1..n in start order so a group can say "3 号有人去吗", grouped by Pacific day. Rules:
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

export type WeChatOptions = {
  /** publicOrigin() when the text is generated, not snap.origin: a domain added after the freeze shows up. */
  origin: string;
  /** newsletterStatus() === 'open': add the subscribe link. */
  subscribe: boolean;
  /** Events cancelled since the freeze (liveState()): kept in place as an unnumbered [已取消] line, not counted. */
  cancelled?: ReadonlySet<string>;
};

export type WeChatText = { text: string; chars: number; picks: number; going: number };

/** What liveState() reads from an event's current row; publicEvents() rows fit. */
export type LiveRow = Pick<
  PublicEvent,
  'id' | 'status' | 'going' | 'goingVisibility' | 'category' | 'format' | 'privateVenue' | 'sourceUrl' | 'startAt' | 'endAt'
>;

const CANCELLED = '[已取消]';

const oneLine = (s: string) => s.trim().replace(/\s+/g, ' ');

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

/** Clock times under a day header: 18:30–21:00, or 9:00 – 10月18日周日 17:00 across days; all-day as when(). */
function clock(e: DigestEvent) {
  if (e.allDay) return when(e, 'zh');
  const start = new Date(e.startAt);
  const end = e.endAt ? new Date(e.endAt) : null;
  if (!end || end <= start) return fmtTime(start, 'zh');
  if (dayKey(end, PT) !== dayKey(start, PT)) return `${fmtTime(start, 'zh')} – ${dayLabel(end, 'zh')} ${fmtTime(end, 'zh')}`;
  return `${fmtTime(start, 'zh')}–${fmtTime(end, 'zh')}`;
}

/**
 * Numbered title (with the seal's text label), the official title if different, when · where ·
 * price · platform, the note. A cancelled event (n = null): [已取消] instead of a number, no seal, no note.
 */
function item(e: DigestEvent, n: number | null, showSeal: boolean): string[] {
  const t = titles(e, 'zh');
  const seal = n !== null && showSeal && isDigestSeal(e.seal) ? `${sealAlt(e.seal, 'zh')} ` : '';
  const lines = [`${n === null ? CANCELLED : `${n}.`} ${seal}${oneLine(t.primary)}`];
  if (t.secondary) lines.push(clip(t.secondary, ALT_TITLE_MAX[t.secondaryLang]));
  const meta = [clock(e), ...where(e, 'zh')];
  // Online and hybrid events can be joined from China: the start in Beijing time, as on the zh
  // event page. Not for all-day events, whose start is just Pacific midnight.
  if (e.format !== 'in_person' && !e.allDay) meta.push(fmtBeijing(new Date(e.startAt)));
  meta.push(...chips(e, 'zh').map((c) => c.text));
  if (e.platform) meta.push(e.platform);
  lines.push(oneLine(meta.join(' · ')));
  const v = n === null ? null : note(e, 'zh');
  if (v) lines.push(clip(v.text, NOTE_MAX[v.lang]));
  return lines;
}

/** The text to paste, or null when the week has no picks (nothing to post). */
export function wechatText(snap: DigestSnapshot, o: WeChatOptions): WeChatText | null {
  if (snap?.version !== 1) throw new Error(`digest snapshot version ${String(snap?.version)} is not supported`);
  const sel = selectForVariant(snap, CATEGORY_SLUGS);
  const cancelled = o.cancelled ?? new Set<string>();
  const events = sel.sections.flatMap((s) => s.days.flatMap((d) => d.events)).sort(byStart);
  const picks = events.filter((e) => !cancelled.has(e.id)).length;
  if (picks === 0) return null;
  const c = COPY.zh;
  const going = snap.showAttendance ? sel.going.filter((e) => !cancelled.has(e.id)).length : 0;
  const origin = o.origin.replace(/\/+$/, '');
  // The covered week's Monday at noon PT, always the right calendar day (as the email masthead).
  const monday = fmtDayHeader(new Date(Date.parse(snap.from) + 12 * 3600_000), 'zh', PT).date;

  // Blocks are separated by a blank line; a day header opens the block of that day's first item.
  const blocks: string[][] = [[`${c.site} · ${c.weekOf(monday)}`, c.subject(picks, going)]];
  const intro = introLines(snap, 'zh');
  if (intro.length) blocks.push(intro);
  blocks.push([`时间均为${zoneLabel('zh')}`]);

  let day = '';
  let n = 0;
  for (const e of events) {
    const start = new Date(e.startAt);
    const lines = item(e, cancelled.has(e.id) ? null : ++n, snap.showAttendance);
    if (dayKey(start, PT) !== day) {
      day = dayKey(start, PT);
      lines.unshift(`【${dayLabel(start, 'zh')}】`);
    }
    blocks.push(lines);
  }

  if (sel.preview.length) {
    const line = (e: DigestEvent) =>
      `· ${cancelled.has(e.id) ? `${CANCELLED} ` : ''}${oneLine(titles(e, 'zh').primary)} · ${dayLabel(new Date(e.startAt), 'zh')}`;
    blocks.push([`【${c.preview}】`, ...sel.preview.map(line)]);
  }
  blocks.push(['完整列表、报名和加入日历：', `${origin}/zh/week/${snap.isoWeek}`]);
  if (o.subscribe) blocks.push(['每周日收邮件版（可只选关心的类别）：', `${origin}/zh/subscribe`]);
  blocks.push([c.noPaid]);

  const text = blocks.map((b) => b.join('\n')).join('\n\n');
  return { text, chars: [...text].length, picks, going };
}
