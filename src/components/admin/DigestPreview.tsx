import Form from 'next/form';
import Link from 'next/link';
import { CATEGORIES, CATEGORY_SLUGS } from '@/lib/taxonomy';
import { btn } from './ui';

// /admin/digest preview: pick a language, categories and the F19 facets (a GET form, so the choice
// lives in the URL: l, c, ev, o), see the rendered email in a sandboxed iframe, the subject and size against the limit,
// every audience variant with its recipient count, and what to fix before scheduling. Rendering
// happens in the page; this component only lays the results out.

export type PreviewRender =
  | { ok: true; empty: boolean; subject: string; preheader: string; html: string; text: string; bytes: number; picks: number; going: number }
  | { ok: false; error: string };

export type AudienceRow = {
  key: string;
  label: string;
  count: number;
  href: string;
  /** null when not rendered (past the page's cap on distinct emails). */
  subject: string | null;
  bytes: number | null;
  empty: boolean;
  error: string | null;
};

export type DigestWarning = { text: string; events?: { id: string; title: string }[] };

const kb = (n: number) => `${(n / 1000).toFixed(1)} KB`;

export function DigestPreview(p: {
  /** ?w= of the issue on screen, kept when the preview form is submitted. */
  week: string | null;
  locale: 'en' | 'zh';
  categories: readonly string[];
  /** F19 facets of the previewed variant (Send test and Send to seeds carry them too). */
  evLang: 'en' | 'zh' | 'bilingual' | null;
  onlineOnly: boolean;
  result: PreviewRender;
  maxBytes: number;
  audience: AudienceRow[];
  eligible: number;
  dailyCap: number;
  warnings: DigestWarning[];
  frozen: boolean;
}) {
  const chosen = new Set(p.categories);
  const r = p.result;
  return (
    <div className="space-y-8">
      {p.warnings.length > 0 && (
        <section aria-labelledby="digest-warnings">
          <h2 id="digest-warnings" className="mb-2 font-mono text-xs uppercase text-muted">Before you schedule · 排期前看一下</h2>
          <ul className="space-y-2 text-sm">
            {p.warnings.map((w) => (
              <li key={w.text} className="rounded-lg border border-rule px-3 py-2">
                <p>{w.text}</p>
                {w.events && w.events.length > 0 && (
                  <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
                    {w.events.map((e) => (
                      <li key={e.id}>
                        <Link href={`/admin/e/${e.id}`} className="text-muted underline underline-offset-2">{e.title}</Link>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="digest-preview" className="space-y-3">
        <h2 id="digest-preview" className="font-mono text-xs uppercase text-muted">
          Preview · 预览{p.frozen ? '（frozen content · 已冻结的内容）' : ''}
        </h2>
        <Form action="/admin/digest" className="space-y-3">
          {p.week && <input type="hidden" name="w" value={p.week} />}
          <fieldset className="flex flex-wrap gap-x-4">
            <legend className="sr-only">Language · 语言</legend>
            {(['zh', 'en'] as const).map((l) => (
              <label key={l} className="flex min-h-11 items-center gap-2">
                <input type="radio" name="l" value={l} defaultChecked={p.locale === l} className="size-5 accent-ink" />
                <span>{l === 'zh' ? '中文版' : 'English'}</span>
              </label>
            ))}
          </fieldset>
          <fieldset className="flex flex-wrap gap-x-4">
            <legend className="sr-only">Categories · 类别</legend>
            {CATEGORY_SLUGS.map((c) => (
              <label key={c} className="flex min-h-11 items-center gap-2">
                <input type="checkbox" name="c" value={c} defaultChecked={chosen.has(c)} className="size-5 accent-ink" />
                <span>{CATEGORIES[c].zh}</span>
              </label>
            ))}
          </fieldset>
          <div className="flex flex-wrap items-end gap-x-4 gap-y-2">
            <label className="text-sm">
              <span className="block text-muted">Event language · 活动语言</span>
              <select name="ev" defaultValue={p.evLang ?? ''} className="mt-1 h-11 rounded-lg border border-rule bg-paper px-3">
                <option value="">Any · 不限</option>
                <option value="zh">zh + bilingual · 中文或双语</option>
                <option value="en">en + bilingual · 英文或双语</option>
                <option value="bilingual">Bilingual only · 仅双语</option>
              </select>
            </label>
            <label className="flex min-h-11 items-center gap-2">
              <input type="checkbox" name="o" value="1" defaultChecked={p.onlineOnly} className="size-5 accent-ink" />
              <span>Online only · 只看线上</span>
            </label>
          </div>
          <button type="submit" className={`${btn.small} h-11`}>Preview · 预览</button>
        </Form>

        {r.ok ? (
          <>
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
              <dt className="text-muted">Subject · 标题</dt>
              <dd data-testid="digest-subject">{r.subject}</dd>
              <dt className="text-muted">Preheader · 预览文字</dt>
              <dd className="text-muted">{r.preheader}</dd>
              <dt className="text-muted">Counts · 数量</dt>
              <dd>
                {r.empty ? 'Empty notice (≤1 a month per subscriber) · 本周没有：每人每月最多一封提示' : `${r.picks} picks · ${r.going} going · ${r.picks} 场精选 · 会去 ${r.going} 场`}
              </dd>
              <dt className="text-muted">Size · 大小</dt>
              <dd className={r.bytes > p.maxBytes * 0.85 ? 'text-seal-text' : undefined}>
                {kb(r.bytes)} / {kb(p.maxBytes)}
              </dd>
            </dl>
            <iframe
              title="Email preview · 邮件预览"
              sandbox=""
              srcDoc={r.html}
              className="block h-[75vh] w-full rounded-lg border border-rule bg-white"
            />
            <details className="text-sm">
              <summary className="cursor-pointer py-1 text-muted">Plain-text part · 纯文本版本</summary>
              <pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap rounded-lg border border-rule p-3 font-mono text-xs">{r.text}</pre>
            </details>
          </>
        ) : (
          <p role="alert" className="rounded-lg border border-seal px-3 py-2 text-sm text-seal-text">
            Couldn&apos;t render this variant · 这个版本渲染失败：{r.error}
          </p>
        )}
      </section>

      <section aria-labelledby="digest-audience" className="space-y-2">
        <h2 id="digest-audience" className="font-mono text-xs uppercase text-muted">
          Audience · 收件人（{p.eligible}，daily cap {p.dailyCap} · 每天上限 {p.dailyCap}）
        </h2>
        {p.audience.length === 0 ? (
          <p className="text-sm text-muted">No eligible subscribers yet · 还没有可以收周报的订阅者</p>
        ) : (
          <ul className="divide-y divide-rule border-y border-rule text-sm">
            {p.audience.map((a) => (
              <li key={a.key} className="py-2">
                <div className="flex items-baseline justify-between gap-3">
                  <Link href={a.href} className="min-w-0 underline underline-offset-2">{a.label}</Link>
                  <span className="shrink-0 tabular-nums">{a.count}</span>
                </div>
                <p className={`truncate ${a.error ? 'text-seal-text' : 'text-muted'}`}>
                  {a.error
                    ? `Render failed · 渲染失败：${a.error}`
                    : a.subject === null
                      ? 'Not rendered here · 未在此渲染'
                      : `${a.empty ? '[empty] ' : ''}${a.subject} · ${a.bytes === null ? '' : kb(a.bytes)}`}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
