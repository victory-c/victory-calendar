'use client';
import { useActionState } from 'react';
import { type ActionState, saveGoing } from '@/app/admin/actions';
import { btn, field } from './ui';

/** Going status + visibility. The server applies the safety rules and says when it downgraded. */
export function GoingForm({ id, going, visibility }: { id: string; going: string; visibility: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(saveGoing.bind(null, id), null);
  return (
    <form action={action}>
      <h2 className="mb-3 font-mono text-xs uppercase text-muted">Going · 我去不去</h2>
      <div className="grid gap-4 md:grid-cols-3">
        <div>
          <label htmlFor="going" className={field.label}>Status · 状态</label>
          <select id="going" name="going" defaultValue={going} className={field.input}>
            <option value="none">Not going · 不去</option>
            <option value="interested">Interested · 想去（只显示灰字）</option>
            <option value="going">Going · 会去</option>
            <option value="hosting">Hosting · 主办</option>
            <option value="speaking">Speaking · 分享</option>
          </select>
        </div>
        <div>
          <label htmlFor="visibility" className={field.label}>Visibility · 可见性</label>
          <select id="visibility" name="visibility" defaultValue={visibility} className={field.input}>
            <option value="public">Public now · 现在公开</option>
            <option value="after_event">After the event · 活动后公开</option>
            <option value="hidden">Hidden · 不公开</option>
          </select>
        </div>
        <div className="flex items-end">
          <button className={btn.secondary} disabled={pending}>Save going · 保存</button>
        </div>
      </div>
      <p role="status" aria-live="polite" className="mt-2 min-h-5 text-sm text-muted">{pending ? '…' : state?.message}</p>
    </form>
  );
}
