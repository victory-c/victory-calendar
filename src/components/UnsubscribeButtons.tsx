'use client';
import { useActionState, useRef } from 'react';
import type { UnsubscribeKey, UnsubscribeState } from '@/app/[locale]/prefs/actions';
import type { Category } from '@/lib/taxonomy';
import { useRefocus } from './PrefsForm';

type Action = (prev: UnsubscribeState, form: FormData) => Promise<UnsubscribeState>;

/**
 * The manual unsubscribe page's buttons (guide「退订」): one per subscribed category, plus everything.
 * Each button is a tiny form posting `c`, all sharing one action state, so the message stays put
 * while refresh() removes the button that was pressed; focus goes to that message (tabIndex -1).
 * Nothing happens until a press.
 */
export function UnsubscribeButtons({
  action,
  done,
  categories,
  text,
  messages,
}: {
  /** Bound to the link token. */
  action: Action;
  /** The row is unsubscribed: show only the confirmation. */
  done: boolean;
  /** Subscribed categories with their "Stop …" labels; empty hides the per-category buttons. */
  categories: readonly { slug: Category; label: string }[];
  text: { all: string; done: string; stopped: Record<Category, string> };
  /** Everything else the action can answer; "stopped" comes from `text.stopped` with its category. */
  messages: Record<Exclude<UnsubscribeKey, 'unsubscribe.stopped'>, string>;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  const status = useRef<HTMLParagraphElement>(null);
  useRefocus(pending, status);
  const message = done
    ? text.done
    : !state
      ? ''
      : state.key === 'unsubscribe.stopped'
        ? state.category ? text.stopped[state.category] : ''
        : messages[state.key];
  const tone = done ? 'text-ink' : state && !state.ok ? 'mt-4 text-sm text-seal-text' : 'mt-4 text-sm text-muted';
  const button = (c: string, label: string, primary = false) => (
    <form action={formAction}>
      <input type="hidden" name="c" value={c} />
      <button
        disabled={pending}
        className={
          primary
            ? 'inline-flex h-11 items-center justify-center rounded-full bg-ink px-6 text-sm text-paper disabled:opacity-50'
            : 'inline-flex min-h-11 items-center rounded-full border border-rule px-5 py-2 text-left text-sm disabled:opacity-50'
        }
      >
        {label}
      </button>
    </form>
  );
  return (
    <div className="mt-6">
      {!done && (
        <ul className="flex flex-wrap gap-3">
          {categories.map(({ slug, label }) => (
            <li key={slug}>{button(slug, label)}</li>
          ))}
          <li>{button('all', text.all, true)}</li>
        </ul>
      )}
      <p ref={status} role="status" aria-live="polite" tabIndex={-1} className={`min-h-5 ${tone}`}>
        {message}
      </p>
    </div>
  );
}
