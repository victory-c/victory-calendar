'use client';
import Link from 'next/link';
import { useActionState, useRef } from 'react';
import { addLink, type ActionState } from '@/app/admin/actions';
import { btn, field } from './ui';

/** Guide「后台屏幕 /admin/add」: link, optional name, note (keyboard dictation), Draft or Publish now. */
export function AddForm({ initialUrl, client }: { initialUrl: string; client: string | null }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(addLink, null);
  const urlRef = useRef<HTMLInputElement>(null);

  async function paste() {
    try {
      const text = await navigator.clipboard.readText();
      const url = text.match(/https?:\/\/\S+/)?.[0] ?? text.trim();
      if (urlRef.current && url) urlRef.current.value = url;
    } catch {
      urlRef.current?.focus();
    }
  }

  return (
    <form action={action} className="flex min-h-dvh flex-col">
      <header className="flex items-center justify-between px-4 pt-4">
        <Link href="/admin/drafts" className={btn.small} aria-label="Close · 关闭">
          ✕
        </Link>
        <h1 className="font-display text-h3 font-semibold">Add · 添加活动</h1>
        <span className="w-9" />
      </header>

      <div className="mx-auto w-full max-w-2xl flex-1 space-y-5 px-4 pt-6">
        {client && <input type="hidden" name="client" value={client} />}
        <div>
          <label htmlFor="url" className={field.label}>
            Link · 活动链接
          </label>
          <div className="mt-1 flex gap-2">
            <input
              ref={urlRef}
              id="url"
              name="url"
              type="url"
              inputMode="url"
              required
              autoFocus={!initialUrl}
              defaultValue={initialUrl}
              placeholder="https://luma.com/…"
              className={`${field.input} mt-0`}
            />
            <button type="button" onClick={paste} className={`${btn.small} h-11 shrink-0`}>
              Paste · 粘贴
            </button>
          </div>
        </div>
        <div>
          <label htmlFor="comment" className={field.label}>
            Note · 点评 <span className="text-xs">(dictation works · 可用键盘听写)</span>
          </label>
          <textarea id="comment" name="comment" rows={4} className={field.area} placeholder="为什么值得去…" />
        </div>
        <div>
          <label htmlFor="name" className={field.label}>
            Name override · 名字（可留空）
          </label>
          <input id="name" name="name" className={field.input} />
        </div>
        <p role="status" aria-live="polite" className={`text-sm ${state && !state.ok ? 'text-seal-text' : 'text-muted'}`}>
          {pending ? 'Reading the page… · 正在读取页面…' : state?.message}
        </p>
      </div>

      <div
        className="sticky bottom-0 border-t border-rule bg-paper/95 px-4 pt-3 backdrop-blur"
        style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
      >
        <div className="mx-auto flex max-w-2xl gap-3">
          <button type="submit" name="mode" value="draft" disabled={pending} className={`${btn.secondary} flex-1`}>
            Save draft · 存草稿
          </button>
          <button type="submit" name="mode" value="publish" disabled={pending} className={`${btn.primary} flex-1`}>
            Publish now · 直接发布
          </button>
        </div>
      </div>
    </form>
  );
}
