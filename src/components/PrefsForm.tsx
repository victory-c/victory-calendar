'use client';
import { type Ref, type RefObject, useActionState, useEffect, useId, useRef, useState } from 'react';
import type { PrefsKey, PrefsState } from '@/app/[locale]/prefs/actions';
import type { Category, Locale } from '@/lib/taxonomy';
import { CategoryCheckboxes } from './CategoryCheckboxes';

type Action = (prev: PrefsState, form: FormData) => Promise<PrefsState>;
type Status = 'pending' | 'active' | 'paused' | 'unsubscribed';

export type PrefsText = {
  language: string;
  en: string;
  zh: string;
  categories: string;
  save: string;
  saving: string;
  pauseTitle: string;
  pause: string;
  resume: string;
  leaveTitle: string;
  unsubscribeAll: string;
  resubscribe: string;
};

type Messages = Record<PrefsKey, string>;
/** One section's form wiring: its last answer, the dispatcher, and whether a post is in flight. */
type Slot = { state: PrefsState; action: (form: FormData) => void; pending: boolean; onSubmit?: () => void };
/** The section's button and message, for the parent to put focus back on (see useRefocus). */
type FocusRefs = { buttonRef: Ref<HTMLButtonElement>; messageRef: Ref<HTMLParagraphElement> };

const primary = 'inline-flex h-11 items-center justify-center rounded-full bg-ink px-6 text-sm text-paper disabled:opacity-50';
const secondary = 'inline-flex h-11 items-center rounded-full border border-rule px-5 text-sm disabled:opacity-50';

/**
 * A pressed button is disabled while its post is in flight, which drops focus to <body>. Once the
 * post settles, put focus back on the first of `targets` still in the page: the button, or a
 * message when refresh() removed the button's section. Focus the visitor moved elsewhere stays put.
 */
export function useRefocus(pending: boolean, ...targets: RefObject<HTMLElement | null>[]) {
  const was = useRef(pending);
  // No deps: compare with the pending value of the previous commit on every commit.
  useEffect(() => {
    const settled = was.current && !pending;
    was.current = pending;
    if (!settled || document.activeElement !== document.body) return;
    targets.find((t) => t.current?.isConnected)?.current?.focus();
  });
}

/**
 * Preference center controls (guide「偏好中心」): language and categories, pause, unsubscribe or
 * resubscribe. Each section is its own form and Server Action (already bound to the link token);
 * the action's refresh() re-renders the page, which swaps the buttons. Suppressed rows get no
 * controls at all; the page shows only their status.
 */
export function PrefsForm({
  locale,
  status,
  emailLocale,
  categories,
  actions,
  text,
  messages,
}: {
  /** Page language, for the category labels. */
  locale: Locale;
  /** Row status, with an expired pause already shown as active. */
  status: Status;
  emailLocale: Locale;
  categories: readonly Category[];
  actions: { save: Action; pause: Action; leave: Action };
  text: PrefsText;
  messages: Messages;
}) {
  // Saving with nothing ticked unsubscribes, and the refresh removes the preferences form along with
  // its answer. So both states live here, and whichever section posted last owns the message: the
  // save's "Done." then shows under "Subscribe again", and focus follows it there.
  const [saved, save, saving] = useActionState(actions.save, null);
  const [left, leave, leaving] = useActionState(actions.leave, null);
  const [last, setLast] = useState<'save' | 'leave' | null>(null);
  const saveButton = useRef<HTMLButtonElement>(null);
  const saveMessage = useRef<HTMLParagraphElement>(null);
  const leaveButton = useRef<HTMLButtonElement>(null);
  const leaveMessage = useRef<HTMLParagraphElement>(null);
  useRefocus(saving, saveButton, saveMessage, leaveMessage);
  useRefocus(leaving, leaveButton, leaveMessage);
  return (
    <div className="mt-8 space-y-8">
      {status !== 'unsubscribed' && (
        <Preferences
          key="prefs"
          locale={locale}
          emailLocale={emailLocale}
          categories={categories}
          slot={{ state: last === 'leave' ? null : saved, action: save, pending: saving, onSubmit: () => setLast('save') }}
          buttonRef={saveButton}
          messageRef={saveMessage}
          text={text}
          messages={messages}
        />
      )}
      {(status === 'active' || status === 'paused') && (
        <Pause key="pause" paused={status === 'paused'} action={actions.pause} text={text} messages={messages} />
      )}
      <Leave
        key="leave"
        unsubscribed={status === 'unsubscribed'}
        slot={{ state: last === 'save' ? (status === 'unsubscribed' ? saved : null) : left, action: leave, pending: leaving, onSubmit: () => setLast('leave') }}
        buttonRef={leaveButton}
        messageRef={leaveMessage}
        text={text}
        messages={messages}
      />
    </div>
  );
}

function Preferences({
  locale,
  emailLocale,
  categories,
  slot,
  buttonRef,
  messageRef,
  text,
  messages,
}: FocusRefs & {
  locale: Locale;
  emailLocale: Locale;
  categories: readonly Category[];
  slot: Slot;
  text: PrefsText;
  messages: Messages;
}) {
  return (
    <form action={slot.action} onSubmit={slot.onSubmit} className="space-y-6">
      <fieldset>
        <legend className="text-sm text-muted">{text.language}</legend>
        <div className="mt-2 flex flex-wrap gap-x-6">
          {(['en', 'zh'] as const).map((l) => (
            <label key={l} className="inline-flex min-h-11 cursor-pointer items-center gap-2 md:min-h-8">
              <input type="radio" name="locale" value={l} defaultChecked={emailLocale === l} className="size-5 accent-ink" />
              <span lang={l === 'zh' ? 'zh-Hans' : 'en'}>{text[l]}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <CategoryCheckboxes locale={locale} legend={text.categories} selected={categories} />
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <button ref={buttonRef} className={primary} disabled={slot.pending}>
          {slot.pending ? text.saving : text.save}
        </button>
        <Message ref={messageRef} state={slot.state} messages={messages} />
      </div>
    </form>
  );
}

function Pause({ paused, action, text, messages }: { paused: boolean; action: Action; text: PrefsText; messages: Messages }) {
  // Local state: the section disappears with an unsubscribe, and comes back without a stale answer.
  const [state, formAction, pending] = useActionState(action, null);
  const id = useId();
  const button = useRef<HTMLButtonElement>(null);
  const message = useRef<HTMLParagraphElement>(null);
  useRefocus(pending, button, message);
  return (
    <section aria-labelledby={id} className="border-t border-rule pt-6">
      <h2 id={id} className="text-h3">{text.pauseTitle}</h2>
      <form action={formAction} className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
        <input type="hidden" name="intent" value={paused ? 'resume' : 'pause'} />
        <button ref={button} className={secondary} disabled={pending}>
          {paused ? text.resume : text.pause}
        </button>
        <Message ref={message} state={state} messages={messages} />
      </form>
    </section>
  );
}

function Leave({
  unsubscribed,
  slot,
  buttonRef,
  messageRef,
  text,
  messages,
}: FocusRefs & { unsubscribed: boolean; slot: Slot; text: PrefsText; messages: Messages }) {
  const id = useId();
  return (
    <section aria-labelledby={unsubscribed ? undefined : id} className="border-t border-rule pt-6">
      {/* An unsubscribed row only sees "Subscribe again"; the status line above already says why. */}
      {!unsubscribed && <h2 id={id} className="text-h3">{text.leaveTitle}</h2>}
      <form action={slot.action} onSubmit={slot.onSubmit} className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
        <input type="hidden" name="intent" value={unsubscribed ? 'resubscribe' : 'unsubscribe'} />
        <button ref={buttonRef} className={unsubscribed ? primary : secondary} disabled={slot.pending}>
          {unsubscribed ? text.resubscribe : text.unsubscribeAll}
        </button>
        <Message ref={messageRef} state={slot.state} messages={messages} />
      </form>
    </section>
  );
}

/** A section's answer. Focusable (tabIndex -1) for when the pressed button is gone. */
function Message({ state, messages, ref }: { state: PrefsState; messages: Messages; ref?: Ref<HTMLParagraphElement> }) {
  return (
    <p ref={ref} role="status" aria-live="polite" tabIndex={-1} className={`min-h-5 text-sm ${state && !state.ok ? 'text-seal-text' : 'text-muted'}`}>
      {state ? messages[state.key] : ''}
    </p>
  );
}
