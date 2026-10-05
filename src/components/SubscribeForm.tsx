'use client';
import { startTransition, useActionState, useEffect, useRef, useSyncExternalStore } from 'react';
import { subscribe } from '@/app/[locale]/subscribe/actions';
import { CategoryCheckboxes } from '@/components/CategoryCheckboxes';
import { initialSubscribeState, type SubscribeErrorCode, type SubscribeState, sourceFor } from '@/lib/newsletter/subscribe-state';
import { type Category, isCategory, type Locale } from '@/lib/taxonomy';

export type SubscribeCopy = {
  email: string;
  emailPlaceholder: string;
  categories: string;
  categoriesHint: string;
  language: string;
  submit: string;
  submitting: string;
  privacy: string;
  /** Link text to /privacy, after the privacy line: read before consenting. */
  privacyLink: string;
  honeypot: string;
  pending: string;
  pendingHint: string;
  again: string;
  errors: Record<SubscribeErrorCode | 'rate_limited' | 'closed' | 'busy', string>;
};

/** What was submitted, kept in the browser so a failed submit can refill the form. */
type Draft = { email: string; locale: Locale; categories: Category[] };
type FormState = SubscribeState & { draft?: Draft };

function readDraft(fd: FormData): Draft {
  const email = fd.get('email');
  return {
    email: typeof email === 'string' ? email.trim() : '',
    locale: fd.get('locale') === 'zh' ? 'zh' : 'en',
    categories: fd.getAll('c').filter(isCategory),
  };
}

// React resets the form after every submit, so on an error the fields fall back to their defaults;
// the draft makes those defaults what the person typed. A thrown call (network, or an action id
// from an older deploy) becomes the generic retry message instead of an error page. `null`
// brings the form back after success ("submit again"). The action ignores its prev argument.
async function submit(prev: FormState, fd: FormData | null): Promise<FormState> {
  if (!fd) return { status: 'idle', draft: prev.draft };
  const draft = readDraft(fd);
  fd.set('n', String(Date.now()));
  try {
    return { ...(await subscribe(initialSubscribeState, fd)), draft };
  } catch {
    return { status: 'error', code: 'server', draft };
  }
}

const noop = () => () => {};

/** Answers with no field to point at. They go in the status line under the button. */
function statusMessage(state: FormState, copy: SubscribeCopy) {
  if (state.status === 'error') return state.field ? '' : copy.errors[state.code];
  if (state.status === 'rate_limited' || state.status === 'closed' || state.status === 'busy') return copy.errors[state.status];
  return '';
}

/**
 * The newsletter sign-up (guide SubscribeForm: idle, submitting, pending-confirm, error,
 * rate-limited, plus busy). Lives only on /subscribe and /zh/subscribe: a Server Action posts to
 * the page it is on, and BotID and the WAF rule protect exactly those two paths.
 */
export function SubscribeForm({ locale, categories, copy }: { locale: Locale; categories: Category[]; copy: SubscribeCopy }) {
  const [state, formAction, pending] = useActionState<FormState, FormData | null>(submit, initialSubscribeState);
  // BotID can't vouch for a native (pre-hydration) post, so the button waits for hydration.
  const hydrated = useSyncExternalStore(noop, () => true, () => false);
  const formRef = useRef<HTMLFormElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const startRef = useRef<HTMLInputElement>(null);
  const statusRef = useRef<HTMLParagraphElement>(null);
  const doneRef = useRef<HTMLDivElement>(null);
  const focusedFor = useRef<FormState>(state);
  const stamp = useRef<string>(null);

  // Fill-time stamp: when this page load began (performance.timeOrigin, the same browser clock as
  // `n`), so time spent filling in the server-rendered form while scripts load counts. One stamp
  // per component life, written after mount (never during render: the server-rendered shell is
  // static). No deps, so it lands in whichever `t` input is mounted: the form shown again after
  // "Subscribe again" reuses it. The input has no value props, so React never writes over it.
  useEffect(() => {
    // Never later than now: a wall clock stepped back since the tab opened can't push it ahead.
    stamp.current ??= String(Math.min(Math.round(performance.timeOrigin), Date.now()));
    if (startRef.current) startRef.current.value = stamp.current;
  });

  // Move focus to whatever the result asks for, once per result. For answers with no field, the
  // pressed button was disabled while posting, which drops focus to <body>: put it on the status
  // line, unless the visitor has already moved on.
  useEffect(() => {
    if (focusedFor.current === state) return;
    focusedFor.current = state;
    if (state.status === 'pending') doneRef.current?.focus();
    else if (state.status === 'idle') emailRef.current?.focus();
    else if (state.status === 'error' && state.field === 'email') emailRef.current?.focus();
    else if (state.status === 'error' && state.field === 'categories') formRef.current?.querySelector<HTMLInputElement>('input[name="c"]')?.focus();
    else if (document.activeElement === document.body) statusRef.current?.focus();
  }, [state]);

  if (state.status === 'pending') {
    return (
      <div ref={doneRef} tabIndex={-1} role="status" className="mt-8 max-w-xl rounded-card border border-rule p-5">
        <p>{copy.pending}</p>
        <p className="mt-2 text-sm text-muted">{copy.pendingHint}</p>
        <button
          type="button"
          onClick={() => startTransition(() => formAction(null))}
          className="mt-4 inline-flex h-11 items-center rounded-full border border-rule px-5 text-sm"
        >
          {copy.again}
        </button>
      </div>
    );
  }

  const draft = state.draft;
  const lang = draft?.locale ?? locale;
  // Field errors sit under their field (and take focus), so the status line never repeats them.
  const message = statusMessage(state, copy);
  const emailError = state.status === 'error' && state.field === 'email' ? copy.errors[state.code] : '';
  const catsError = state.status === 'error' && state.field === 'categories' ? copy.errors[state.code] : '';

  return (
    <form ref={formRef} action={formAction} className="relative mt-8 max-w-xl space-y-6">
      <div>
        <label htmlFor="subscribe-email" className="block text-sm text-muted">
          {copy.email}
        </label>
        <input
          ref={emailRef}
          id="subscribe-email"
          name="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          spellCheck={false}
          required
          maxLength={254}
          placeholder={copy.emailPlaceholder}
          defaultValue={draft?.email ?? ''}
          aria-invalid={emailError ? true : undefined}
          aria-describedby={emailError ? 'subscribe-email-error' : undefined}
          className="mt-1 h-11 w-full rounded-lg border border-rule bg-paper px-3 text-base text-ink aria-[invalid=true]:border-seal-text"
        />
        {emailError && (
          <p id="subscribe-email-error" className="mt-1 text-sm text-seal-text">
            {emailError}
          </p>
        )}
      </div>

      {/* When nothing is picked, the error takes the hint's place in the error colour. */}
      <CategoryCheckboxes
        locale={locale}
        legend={copy.categories}
        hint={copy.categoriesHint}
        error={catsError || undefined}
        selected={draft?.categories ?? categories}
      />

      <fieldset>
        <legend className="text-sm text-muted">{copy.language}</legend>
        <div className="mt-2 flex flex-wrap gap-2">
          {(['en', 'zh'] as const).map((l) => (
            <label
              key={l}
              className="inline-flex h-11 cursor-pointer items-center gap-2 rounded-full border border-rule px-4 text-sm text-ink has-[:checked]:border-ink md:h-8 md:px-3"
            >
              <input type="radio" name="locale" value={l} defaultChecked={lang === l} className="size-4 accent-ink" />
              <span lang={l === 'zh' ? 'zh-Hans' : 'en'}>{l === 'zh' ? '中文' : 'English'}</span>
            </label>
          ))}
        </div>
      </fieldset>

      {/* Honeypot: off screen, out of the tab order and hidden from assistive tech. */}
      <div aria-hidden className="absolute -left-[10000px] top-0 h-px w-px overflow-hidden">
        <label htmlFor="subscribe-website">{copy.honeypot}</label>
        <input id="subscribe-website" type="text" name="website" tabIndex={-1} autoComplete="off" />
      </div>
      <input ref={startRef} type="hidden" name="t" />
      <input type="hidden" name="source" value={sourceFor(locale)} />

      <div>
        <button
          type="submit"
          disabled={!hydrated || pending}
          className="inline-flex h-11 w-full items-center justify-center rounded-full bg-ink px-6 text-sm text-paper disabled:opacity-50 sm:w-auto"
        >
          {pending ? copy.submitting : copy.submit}
        </button>
        <p
          ref={statusRef}
          id="subscribe-status"
          role="status"
          aria-live="polite"
          tabIndex={-1}
          className={`mt-3 min-h-5 text-sm ${message ? 'text-seal-text' : 'text-muted'}`}
        >
          {message}
        </p>
        <p className="mt-1 text-xs text-muted">
          {copy.privacy}
          {locale === 'zh' ? '' : ' '}
          {/* Plain <a>: a full load is fine for this one link, and the form stays free of the intl router. */}
          <a href={locale === 'zh' ? '/zh/privacy' : '/privacy'} className="underline underline-offset-2">
            {copy.privacyLink}
          </a>
        </p>
      </div>
    </form>
  );
}
