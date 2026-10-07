'use client';
import { useRef, useState } from 'react';
import { btn, field } from './ui';

// /admin/digest: the issue as Chinese plain text for WeChat groups (src/lib/digest/wechat.ts builds
// it in the page). The copy button is the first control, so Digest → copy is one tap from the page;
// the text is also selectable by hand (focus selects it all). Nothing is ever cut: past WARN_AT the
// panel suggests trimming or posting it as two messages.

export type WeChatExportProps = {
  /** The text to paste, or null when the week has no picks. */
  text: string | null;
  /** Set instead of `text` when it could not be built (the preview shows the same problem). */
  error?: string | null;
  /** The Chinese intro in the text is still an unapproved AI draft. */
  introDrafted: boolean;
};

/** Above this, a group message gets long: suggest trimming or splitting (aim for about 1,200). */
export const WARN_AT = 2000;

type Copied = { text: string; ok: boolean } | null;

export function WeChatExport({ text, error, introDrafted }: WeChatExportProps) {
  const area = useRef<HTMLTextAreaElement>(null);
  // Remembers which text was copied, so a stale "copied" never shows after the issue changes.
  const [copied, setCopied] = useState<Copied>(null);
  const chars = text ? [...text].length : 0;
  const result = copied && copied.text === text ? copied : null;

  async function copy() {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied({ text, ok: true });
    } catch {
      // No async clipboard (an installed iOS web app, a non-secure origin): select the text and use
      // the legacy command; if that fails too, the text stays selected for a long-press copy.
      const el = area.current;
      let ok = false;
      if (el) {
        el.focus();
        el.setSelectionRange(0, el.value.length);
        try {
          ok = document.execCommand('copy');
        } catch {
          ok = false;
        }
      }
      setCopied({ text, ok });
    }
  }

  return (
    <section aria-labelledby="wechat-heading" className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <h2 id="wechat-heading" className="font-mono text-xs uppercase text-muted">WeChat text · 微信文字</h2>
        {text && (
          <button type="button" onClick={copy} className={btn.secondary}>
            {result?.ok ? 'Copied · 已复制' : '复制微信文字 · Copy'}
          </button>
        )}
      </div>
      {error ? (
        <p role="alert" className="text-sm text-seal-text">Could not build the text · 生成失败（{error}）</p>
      ) : !text ? (
        <p className="text-sm text-muted">No picks this week: nothing to post · 本周没有精选，无需导出</p>
      ) : (
        <>
          <p className="text-sm text-muted">
            Chinese, every category, one link to the week page; no personal links · 中文、全部类别、只带本周页面链接，不含个人链接
          </p>
          {introDrafted && (
            <p role="note" className="text-sm text-seal-text">
              The Chinese intro is still an unapproved AI draft · 中文开场白还是没确认的 AI 草稿
            </p>
          )}
          <label htmlFor="wechat-text" className="sr-only">
            WeChat text · 微信文字
          </label>
          <textarea
            ref={area}
            id="wechat-text"
            readOnly
            rows={12}
            value={text}
            lang="zh-Hans"
            onFocus={(e) => e.currentTarget.select()}
            className={`${field.area} text-sm`}
          />
          <p className="text-sm">
            <span className={chars > WARN_AT ? 'text-seal-text' : 'text-muted'}>
              {chars} 字 · characters
              {chars > WARN_AT ? `：超过 ${WARN_AT} 字，建议删减或分两条发 · over ${WARN_AT}, trim or post as two messages` : ''}
            </span>
            <span role="status">
              {result?.ok && <span className="sr-only">Copied · 已复制</span>}
              {result && !result.ok && <span className="text-seal-text"> · 已选中，长按复制 · Selected: long-press to copy</span>}
            </span>
          </p>
        </>
      )}
    </section>
  );
}
