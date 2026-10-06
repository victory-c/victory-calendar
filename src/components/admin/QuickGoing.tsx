'use client';
import { useActionState } from 'react';
import { type ActionState, markGoing } from '@/app/admin/actions';
import { btn } from './ui';

/**
 * The Live list's going toggle (标为会去 ↔ 会去 ✓) with a status line: marking a published event
 * publicly going queues a going alert by default (F20 G5), and the line says so, or why not.
 */
export function QuickGoing({ id, going }: { id: string; going: string }) {
  const next = going === 'going' ? 'interested' : 'going';
  const [state, action, pending] = useActionState<ActionState, FormData>(markGoing.bind(null, id, next), null);
  return (
    // A narrow column at the row's end (EventRow): the line wraps under the button, never widens it.
    <form action={action} className="flex flex-col items-end gap-1">
      <button className={btn.small} aria-pressed={going === 'going'} disabled={pending} aria-describedby={`going-line-${id}`}>
        {going === 'going' ? '会去 ✓' : '标为会去'}
      </button>
      <span id={`going-line-${id}`} role="status" aria-live="polite" className="max-w-40 text-right text-xs text-muted empty:hidden">
        {pending ? '…' : state?.message}
      </span>
    </form>
  );
}
