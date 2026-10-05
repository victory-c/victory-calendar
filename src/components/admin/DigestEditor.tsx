'use client';
import { useActionState, useEffect, useRef } from 'react';
import type { ActionState } from '@/app/admin/actions';
import { digestAction } from '@/app/admin/digest-actions';
import { btn, Chip, field } from './ui';

export type DigestEditorEvent = { id: string; title: string; when: string };

export type DigestEditorProps = {
  issueId: string;
  /** Changes whenever the stored issue changes, so server-side edits (an AI draft) replace the form. */
  version: string;
  status: 'draft' | 'scheduled' | 'sending' | 'sent';
  previewWeek: string;
  introEn: string;
  introZh: string;
  autoFields: string[];
  /** Published events of the following week (`tag`: the category); checked = in this issue's 下周预告. */
  featured: (DigestEditorEvent & { tag: string; onSite: boolean; checked: boolean })[];
  /** Featured ids that are no longer published events of that week (dropped on the next save). */
  staleFeatured: number;
  /** Events of the covered week whose official Luma cover falls back to the template unless kept. */
  luma: (DigestEditorEvent & { kept: boolean })[];
  allToTemplate: boolean;
  canSendNow: boolean;
  modeOff: boolean;
  aiReady: boolean;
  /** The variant on preview; Send test sends exactly that. */
  test: { locale: 'en' | 'zh'; categories: string; label: string };
  adminEmail: string | null;
};

const FORM_ID = 'digest-editor';
const REPLACE: Record<'en' | 'zh', string> = {
  en: 'Replace the English intro with an AI draft? · 用 AI 草稿替换现在的英文开场白？',
  zh: 'Replace the Chinese intro with an AI draft? · 用 AI 草稿替换现在的中文开场白？',
};
const AI_CHIP = 'ml-1.5 rounded-full border border-cat-ai px-1.5 font-mono text-[0.625rem] text-cat-ai';
// Small text, phone-sized hit area (the admin is a phone PWA).
const LINK_BTN = 'inline-flex min-h-11 items-center px-2 text-xs underline underline-offset-2 disabled:opacity-50 md:min-h-8';

/**
 * /admin/digest editor: one form (like the event editor), each button posts an `_op`, and the
 * server saves the draft before running it. Once scheduled the content is read-only; unschedule
 * to edit. Send now asks for confirmation, since it mails every eligible subscriber, and so does an
 * AI draft that would replace text already in the field.
 *
 * Like EditorShell, only the fields are keyed by `version`: the status line and the action buttons
 * sit outside the form (`form=`), so they stay mounted and the result of each action is announced.
 */
export function DigestEditor(p: DigestEditorProps) {
  const [state, action, pending] = useActionState<ActionState, FormData>(digestAction.bind(null, p.issueId), null);
  const draft = p.status === 'draft';
  const status = useRef<HTMLParagraphElement>(null);
  const pressed = useRef<HTMLElement | null>(null);
  const wasPending = useRef(pending);
  // Disabled while pending, the pressed button drops focus to <body>. Once the action settles, put it
  // back on that button, or on the status line when the button is gone (Schedule and Unschedule swap
  // buttons; Approve and Draft remount with the fields). No deps: compare with the previous commit.
  useEffect(() => {
    const settled = wasPending.current && !pending;
    wasPending.current = pending;
    if (!settled || (document.activeElement && document.activeElement !== document.body)) return;
    const b = pressed.current;
    (b?.isConnected && !(b as HTMLButtonElement).disabled ? b : status.current)?.focus();
  });

  const intro = (lang: 'en' | 'zh') => {
    const name = lang === 'en' ? 'introEn' : 'introZh';
    const ai = p.autoFields.includes(`intro_${lang}`);
    return (
      <div>
        <div className="flex flex-wrap items-baseline justify-between gap-x-3">
          <label htmlFor={name} className={field.label}>
            {lang === 'en' ? 'English intro · 英文开场白' : '中文开场白 · Chinese intro'}
            {ai && <span className={AI_CHIP}>AI</span>}
          </label>
          {draft && (
            <span className="-mr-2 flex gap-4">
              {ai && (
                <button type="submit" name="_op" value={`approve:${lang}`} disabled={pending} className={`${LINK_BTN} text-ink`}>
                  Approve · 确认
                </button>
              )}
              <button
                type="submit"
                name="_op"
                value={`draft:${lang}`}
                disabled={pending}
                className={`${LINK_BTN} text-muted`}
                onClick={(e) => {
                  // The draft overwrites this field (after saving it): ask before replacing real text.
                  const target = e.currentTarget.form?.elements.namedItem(name);
                  const filled = target instanceof HTMLTextAreaElement && target.value.trim() !== '';
                  if (filled && !window.confirm(REPLACE[lang])) e.preventDefault();
                }}
              >
                {lang === 'zh' ? '↻ 从英文起草' : '↻ Draft from 中文'}
              </button>
            </span>
          )}
        </div>
        <textarea
          id={name}
          name={name}
          rows={4}
          maxLength={600}
          readOnly={!draft}
          defaultValue={lang === 'en' ? p.introEn : p.introZh}
          lang={lang === 'zh' ? 'zh-Hans' : 'en'}
          placeholder={lang === 'zh' ? '2–4 行，这周想说的话' : '2–4 lines in your voice'}
          className={`${field.area} read-only:text-muted`}
        />
      </div>
    );
  };

  return (
    <div className="space-y-8">
      <form
        id={FORM_ID}
        key={p.version}
        action={action}
        onSubmit={(e) => {
          pressed.current = (e.nativeEvent as SubmitEvent).submitter;
        }}
        className="space-y-8"
      >
        {/* Enter in a field submits the first button in the form: make that a plain save (or nothing). */}
        <button type="submit" name="_op" value="save" disabled={!draft} hidden tabIndex={-1} aria-hidden />
        <input type="hidden" name="test_locale" value={p.test.locale} />
        <input type="hidden" name="test_cats" value={p.test.categories} />

        <section className="space-y-4">
          <h2 className="font-mono text-xs uppercase text-muted">Intro · 开场白</h2>
          {!draft && (
            <p className="text-sm text-muted">
              {p.status === 'scheduled'
                ? 'Read-only while scheduled: unschedule to edit · 已排期，撤回排期后才能修改'
                : 'Read-only: this issue has started sending · 这一期已经开始发送，不能再改'}
            </p>
          )}
          {draft && !p.aiReady && <p className="text-sm text-muted">AI is not set up: write both languages · AI 还没配置，请手写两种语言</p>}
          <div className="grid gap-4 md:grid-cols-2">
            {intro('en')}
            {intro('zh')}
          </div>
        </section>

        <fieldset className="space-y-2">
          <legend className="font-mono text-xs uppercase text-muted">Next week preview · 下周预告（{p.previewWeek}）</legend>
          {draft && <input type="hidden" name="featured_present" value="1" />}
          {p.featured.length === 0 ? (
            <p className="text-sm text-muted">No published events next week yet · 下周还没有已发布的活动</p>
          ) : (
            <ul className="divide-y divide-rule border-y border-rule">
              {p.featured.map((e) => (
                <li key={e.id}>
                  <label className="flex min-h-11 items-start gap-3 py-2">
                    <input type="checkbox" name="featured" value={e.id} defaultChecked={e.checked} disabled={!draft} className="mt-1 size-5 shrink-0 accent-ink" />
                    <span className="min-w-0">
                      <span className="mr-2">{e.title}</span>
                      {e.onSite && <Chip>★ 精选</Chip>}
                      <span className="block text-sm text-muted">{e.when} · {e.tag}</span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}
          {p.staleFeatured > 0 && (
            <p className="text-sm text-seal-text">
              {p.staleFeatured} featured event(s) are no longer published next week and will be dropped · {p.staleFeatured} 条精选已不在下周的已发布活动里，保存时会去掉
            </p>
          )}
        </fieldset>

        <fieldset className="space-y-2">
          <legend className="font-mono text-xs uppercase text-muted">Luma covers · Luma 官方封面</legend>
          <p className="text-sm text-muted">
            Email uses the template for Luma covers unless you keep them · 邮件里 Luma 活动默认用模板封面，勾选则这期保留官方封面
          </p>
          {p.allToTemplate ? (
            <p className="text-sm">「All official covers → template」is on in Settings, so every email cover is a template · 设置里「官方封面全部换模板」已打开</p>
          ) : p.luma.length === 0 ? (
            <p className="text-sm text-muted">None this week · 本周没有</p>
          ) : (
            <>
              {draft && <input type="hidden" name="keep_present" value="1" />}
              <ul className="divide-y divide-rule border-y border-rule">
                {p.luma.map((e) => (
                  <li key={e.id}>
                    <label className="flex min-h-11 items-start gap-3 py-2">
                      <input type="checkbox" name="keep" value={e.id} defaultChecked={e.kept} disabled={!draft} className="mt-1 size-5 shrink-0 accent-ink" />
                      <span className="min-w-0">
                        <span>{e.title}</span>
                        <span className="block text-sm text-muted">Keep official cover in this email · 这期保留官方封面 · {e.when}</span>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            </>
          )}
        </fieldset>
      </form>

      <section className="border-t border-rule pt-4">
        <p ref={status} role="status" aria-live="polite" tabIndex={-1} className={`mb-3 min-h-5 text-sm ${state && !state.ok ? 'text-seal-text' : 'text-muted'}`}>
          {pending ? 'Working… · 处理中…' : state?.message}
        </p>
        <div className="flex flex-wrap gap-2">
          {draft && (
            <>
              <button type="submit" form={FORM_ID} name="_op" value="save" disabled={pending} className={btn.secondary}>
                Save · 保存
              </button>
              <button type="submit" form={FORM_ID} name="_op" value="schedule" disabled={pending} className={btn.primary}>
                Schedule · 排期
              </button>
            </>
          )}
          {p.status === 'scheduled' && (
            <button type="submit" form={FORM_ID} name="_op" value="unschedule" disabled={pending} className={btn.secondary}>
              Unschedule · 撤回排期
            </button>
          )}
          {p.canSendNow && (
            <button
              type="submit"
              form={FORM_ID}
              name="_op"
              value="send_now"
              disabled={pending || p.modeOff}
              title={p.modeOff ? 'No verified sender · 发信域名未验证' : undefined}
              className={btn.danger}
              onClick={(e) => {
                if (!window.confirm('Send this issue to every eligible subscriber now? · 现在发给所有符合条件的订阅者？')) e.preventDefault();
              }}
            >
              Send now · 立即发送
            </button>
          )}
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
          <button type="submit" form={FORM_ID} name="_op" value="test" disabled={pending || !p.adminEmail} className={`${btn.small} h-11`}>
            Send test · 发测试邮件
          </button>
          <span className="text-muted">
            {p.test.label} → {p.adminEmail ?? 'ADMIN_EMAIL is not set · 没有配置 ADMIN_EMAIL'}（≤10/天）
          </span>
        </div>
      </section>
    </div>
  );
}
