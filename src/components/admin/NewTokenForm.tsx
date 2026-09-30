'use client';
import { useActionState, useState } from 'react';
import { type ActionState, newToken } from '@/app/admin/actions';
import { btn, field } from './ui';

/** Create a vp_ token; the plaintext is shown once, here, and never again. */
export function NewTokenForm() {
  const [state, action, pending] = useActionState<ActionState, FormData>(newToken, null);
  const [copied, setCopied] = useState(false);
  return (
    <form action={action} className="space-y-3">
      <div>
        <label htmlFor="tokenName" className={field.label}>Name · 名字</label>
        <input id="tokenName" name="name" placeholder="iPhone Add to Picks" className={field.input} required />
      </div>
      <fieldset className="flex flex-wrap gap-4">
        <legend className={field.label}>Scopes · 权限</legend>
        <label className="flex min-h-11 items-center gap-2"><input type="checkbox" name="scope_ingest" defaultChecked className="size-5 accent-ink" /> ingest（加草稿）</label>
        <label className="flex min-h-11 items-center gap-2"><input type="checkbox" name="scope_publish" className="size-5 accent-ink" /> publish（直接发布）</label>
        <label className="flex min-h-11 items-center gap-2"><input type="checkbox" name="scope_candidates" className="size-5 accent-ink" /> candidates（skill 推送）</label>
      </fieldset>
      <button className={btn.secondary} disabled={pending}>Create token · 生成令牌</button>
      {state && (
        <div role="status" className="rounded-lg border border-rule p-3 text-sm">
          <p className={state.ok ? 'text-muted' : 'text-seal-text'}>{state.message}</p>
          {state.token && (
            <div className="mt-2 flex gap-2">
              <code className="min-w-0 flex-1 break-all rounded bg-rule/40 px-2 py-1 font-mono text-xs">{state.token}</code>
              <button
                type="button"
                className={btn.small}
                onClick={async () => {
                  await navigator.clipboard.writeText(state.token!);
                  setCopied(true);
                }}
              >
                {copied ? 'Copied · 已复制' : 'Copy · 复制'}
              </button>
            </div>
          )}
        </div>
      )}
    </form>
  );
}
