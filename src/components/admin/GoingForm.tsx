'use client';
import { useActionState, useState } from 'react';
import { type ActionState, saveGoing } from '@/app/admin/actions';
import { ALERT_HINT, ALERT_SEALS, ALERTS_PAUSED_HINT, alertSwitchDefault, alertTooSoon, DRAFT_NOTE, DRAFT_NOTE_PAUSED, TOO_SOON } from '@/lib/admin/going-message';
import type { DigestMode } from '@/lib/newsletter/status';
import { btn, field } from './ui';

type Props = {
  id: string;
  going: string;
  visibility: string;
  /** The event's status; without it the form assumes published. */
  status?: string;
  /** The stored going mark's switch (going_marks.alert); no mark yet reads as on, the default. */
  alertOn?: boolean;
  /** alertsMode() on the server: 'off' means sending is paused (marks are kept for 7 days). */
  mode: DigestMode;
  /** The event's start (null for a draft without one) and the server's clock, for "too soon". */
  startAt: Date | string | null;
  now: number;
};

/** GoingFields' key: every stored value it starts from, the alert switch included. */
export const goingFieldsKey = (going: string, visibility: string, alertOn: boolean) => `${going}|${visibility}|${alertOn ? 'alert' : 'no-alert'}`;

/**
 * Going status + visibility. The server applies the safety rules and says when it downgraded, and
 * whether a going alert was queued (F20). The "Alert subscribers" switch (default on) is shown only
 * while the choice is a public going / hosting / speaking on a published event, the only marks
 * that can alert anyone, and starts from the stored mark. A draft gets a note instead: publishing
 * it is what queues the alert. The notes never promise an email that can't follow: sending paused,
 * or an event too soon for the next morning's run.
 */
export function GoingForm({ id, going, visibility, status = 'published', alertOn = true, mode, startAt, now }: Props) {
  const [state, action, pending] = useActionState<ActionState, FormData>(saveGoing.bind(null, id), null);
  const storedOn = alertSwitchDefault(going, visibility, alertOn);
  const note = alertTooSoon(startAt, now) ? 'soon' : mode === 'off' ? 'paused' : 'next';
  return (
    <form action={action}>
      <h2 className="mb-3 font-mono text-xs uppercase text-muted">Going · 我去不去</h2>
      {/* Keyed by the stored values: after a save (or a downgrade) the fields start over from them,
          the switch included (a form action resets it to defaultChecked), while the status line
          above the key keeps the server's message. */}
      <GoingFields key={goingFieldsKey(going, visibility, storedOn)} going={going} visibility={visibility} status={status} alertOn={storedOn} note={note} pending={pending} />
      <p role="status" aria-live="polite" className="mt-2 min-h-5 text-sm text-muted">{pending ? '…' : state?.message}</p>
    </form>
  );
}

type Note = 'next' | 'paused' | 'soon';
const HINT: Record<Note, string> = { next: ALERT_HINT, paused: ALERTS_PAUSED_HINT, soon: TOO_SOON };
const DRAFT: Record<Note, string> = { next: DRAFT_NOTE, paused: DRAFT_NOTE_PAUSED, soon: TOO_SOON };

function GoingFields({ going, visibility, status, alertOn, note, pending }: { going: string; visibility: string; status: string; alertOn: boolean; note: Note; pending: boolean }) {
  // Uncontrolled selects (React resets them to these defaults after the action); the copy here
  // only decides whether the alert switch shows.
  const [g, setG] = useState(going);
  const [v, setV] = useState(visibility);
  const canAlert = ALERT_SEALS.includes(g) && v === 'public';
  return (
    <>
      <div className="grid gap-4 md:grid-cols-3">
        <div>
          <label htmlFor="going" className={field.label}>Status · 状态</label>
          <select id="going" name="going" defaultValue={going} onChange={(e) => setG(e.target.value)} className={field.input}>
            <option value="none">Not going · 不去</option>
            <option value="interested">Interested · 想去（只显示灰字）</option>
            <option value="going">Going · 会去</option>
            <option value="hosting">Hosting · 主办</option>
            <option value="speaking">Speaking · 分享</option>
          </select>
        </div>
        <div>
          <label htmlFor="visibility" className={field.label}>Visibility · 可见性</label>
          <select id="visibility" name="visibility" defaultValue={visibility} onChange={(e) => setV(e.target.value)} className={field.input}>
            <option value="public">Public now · 现在公开</option>
            <option value="after_event">After the event · 活动后公开</option>
            <option value="hidden">Hidden · 不公开</option>
          </select>
        </div>
        <div className="flex items-end">
          <button className={btn.secondary} disabled={pending}>Save going · 保存</button>
        </div>
      </div>
      {canAlert && status === 'draft' && <p className="mt-3 text-xs text-muted">{DRAFT[note]}</p>}
      {canAlert && status === 'published' && (
        <div className="mt-3">
          {/* Posted with the box: an unticked box then reads as off rather than "no switch" (default on). */}
          <input type="hidden" name="alert" value="off" />
          <label className="flex min-h-11 items-center gap-3">
            <input type="checkbox" name="alert" value="on" defaultChecked={alertOn} aria-describedby="going-alert-hint" className="size-5 accent-ink" />
            <span>Alert subscribers · 提醒订阅者</span>
          </label>
          <p id="going-alert-hint" className="text-xs text-muted">
            {HINT[note]}
          </p>
        </div>
      )}
    </>
  );
}
