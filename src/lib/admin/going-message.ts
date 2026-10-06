import type { GoingAlertVerdict } from '../alerts/marks';
import { addDaysKey, startOfKey, todayKeyPT } from '../format/calendar';
import type { DigestMode } from '../newsletter/status';

// The status line after Victor saves going (editor GoingForm, Live list, inbox stamp), DESIGN-F20
// G5/G15: whether a going alert was queued, and why not when it wasn't. Admin copy, "English · 中文".
// A plain module: 'use server' files may only export async functions.

/** Seals a going alert can announce (the digest's going list: never `went` or `interested`). */
export const ALERT_SEALS: readonly string[] = ['going', 'hosting', 'speaking'];

/** Why a public going was stored as after_event (admin/events.ts goingDowngradeReason). */
export const DOWNGRADE_REASONS: Record<string, string> = {
  cycling: '骑行活动不公开行踪',
  not_on_listed_platform: '不在 Luma、Partiful、Eventbrite、Meetup 上',
  private_venue: '私人场地',
  recurring: '同一主办方与场地 4 周内重复',
};

export type GoingSaved = {
  going: string;
  /** As stored: a downgraded public going comes back as after_event. */
  visibility: string;
  reason: string | null;
  /**
   * setGoing's verdict on a going alert (undefined from a caller that never asked): 'digest' when
   * tomorrow's Sunday digest carries the event, so no separate alert follows (DESIGN-F20 G3).
   */
  alert?: GoingAlertVerdict;
  /** The event's start, so a save can say "too soon" instead of promising an alert. */
  startAt?: Date | null;
};

export const SAVED = 'Saved · 已保存';
export const PUBLISHED = 'Published · 已发布';
// Only said when the next run will mail it: a Saturday mark of an event the Sunday digest lists
// gets IN_DIGEST instead (Sunday's run skips, Monday's only alerts events from Tuesday on).
export const ALERT_QUEUED = 'Alert goes out next morning ~8 AM PT (Monday if Sunday has a digest) · 明早约 8 点发提醒（周日发周报的话改到周一）';
export const IN_DIGEST = "In Sunday's digest, no separate alert · 周日周报里会有，不另发提醒";
export const NO_ALERT_AFTER_EVENT = 'No alert (shown after the event) · 不发提醒（活动后公开）';
export const NO_ALERT = 'No alert · 不发提醒';
// Sending off keeps the marks: alertPool mails the last 7 days' marks once sending resumes (G1).
export const ALERTS_OFF = 'Alerts are paused: this mark is kept and goes out if alerts resume within 7 days · 会去提醒暂停中：标记已保存，7 天内恢复会发出';
export const TOO_SOON = 'Too soon for an alert · 活动太近，不发提醒';
// GoingForm's notes before a save (the lines above are what the save says).
export const ALERT_HINT = 'One email the next morning to readers who turned on going alerts, day only, no time · 次日早上给开了会去提醒的读者发一封，只写日期不写时间';
export const DRAFT_NOTE = 'Publishing it alerts subscribers; to skip that, untick Alert subscribers here after publishing · 发布后会提醒订阅者；不想发的话，发布后在这里取消「提醒订阅者」';
export const ALERTS_PAUSED_HINT = 'Alerts are paused: a mark is kept and goes out if alerts resume within 7 days · 会去提醒暂停中：标记会保存，7 天内恢复会发出';
export const DRAFT_NOTE_PAUSED =
  'Alerts are paused: publishing keeps the mark, and it goes out if alerts resume within 7 days; to skip that, untick Alert subscribers here after publishing · 会去提醒暂停中：发布后标记会保存，7 天内恢复会发出；不想发的话，发布后在这里取消「提醒订阅者」';

/**
 * Where GoingForm's "Alert subscribers" switch starts: the stored mark's switch (going_marks.alert)
 * while the stored choice is a public going, since a re-save keeps that mark; otherwise on, because
 * choosing going from anything else records a fresh mark (default on, G5).
 */
export function alertSwitchDefault(going: string, visibility: string, alertOn: boolean): boolean {
  return ALERT_SEALS.includes(going) && visibility === 'public' ? alertOn : true;
}

/**
 * Too soon for any alert: the event starts before the day after tomorrow 00:00 PT (tomorrow's
 * run only alerts events from the day after it, alerts/marks.ts), which includes one that has
 * started or ended. Unknown start (a draft): not too soon, the save decides.
 */
export function alertTooSoon(startAt: Date | string | number | null | undefined, now: Date | number): boolean {
  if (startAt === null || startAt === undefined) return false;
  const start = new Date(startAt).getTime();
  if (Number.isNaN(start)) return false;
  return start < startOfKey(addDaysKey(todayKeyPT(new Date(now)), 2)).getTime();
}

/**
 * `wanted`: the alert switch was on. `mode`: alertsMode() now. Only a 'queued' verdict promises an
 * email; 'none' on a public going can also mean an alert from an earlier save is still pending (a
 * re-save records nothing new), so without the switch off or sending off the line says only Saved.
 */
export function goingSavedMessage(r: GoingSaved, opts: { wanted: boolean; mode: DigestMode; now?: Date | number }): string {
  // Downgraded: the reason in the 中文 half, as the editor has always shown it.
  if (r.reason) return `No alert (shown after the event) · 不发提醒（活动后公开：${DOWNGRADE_REASONS[r.reason] ?? r.reason}）`;
  if (!ALERT_SEALS.includes(r.going)) return SAVED;
  if (r.visibility === 'after_event') return `${SAVED} · ${NO_ALERT_AFTER_EVENT}`;
  if (r.visibility !== 'public') return SAVED;
  // An unticked switch or a start too close wins over the paused note: those marks never go out.
  if (!opts.wanted) return `${SAVED} · ${NO_ALERT}`;
  if (r.alert !== 'queued' && r.alert !== 'digest' && alertTooSoon(r.startAt, opts.now ?? Date.now())) return `${SAVED} · ${TOO_SOON}`;
  if (opts.mode === 'off') return `${SAVED} · ${ALERTS_OFF}`;
  if (r.alert === 'queued') return `${SAVED} · ${ALERT_QUEUED}`;
  if (r.alert === 'digest') return `${SAVED} · ${IN_DIGEST}`;
  return SAVED;
}

/** The editor's line after Publish: whether publishing an event already marked publicly going queued its alert. */
export function publishedMessage(alert: GoingAlertVerdict | undefined): string {
  if (alert === 'queued') return `${PUBLISHED} · ${ALERT_QUEUED}`;
  if (alert === 'digest') return `${PUBLISHED} · ${IN_DIGEST}`;
  return PUBLISHED;
}

/**
 * The editor's alert switch. GoingForm posts a hidden `alert=off` with the checkbox (`alert=on`
 * when ticked), so an unticked box reads as off; a form without the field (the switch not shown,
 * or a caller with no switch) gets the default, on (G5).
 */
export function alertWanted(fd: FormData): boolean {
  return fd.has('alert') ? fd.getAll('alert').includes('on') : true;
}
