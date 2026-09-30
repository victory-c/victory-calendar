'use client';
import Link from 'next/link';
import { type ReactNode, useActionState, useState } from 'react';
import { type ActionState, editorAction } from '@/app/admin/actions';
import { CATEGORIES, CATEGORY_SLUGS } from '@/lib/taxonomy';
import { btn, field } from './ui';

export type EditorValues = {
  titleEn: string; titleZh: string; summaryEn: string; summaryZh: string; noteEn: string; noteZh: string;
  category: string; eventLanguage: string; tz: string; start: string; end: string; allDay: boolean; format: string;
  venueName: string; city: string; neighborhood: string; region: string; address: string; addressPublic: boolean;
  privateVenue: boolean; priceText: string; access: string; hostName: string; hostUrl: string; sourceUrl: string;
  tags: string; featured: boolean; coverPolicy: string;
};

type Tab = 'en' | 'zh' | 'details' | 'cover';
const TABS: { id: Tab; label: string }[] = [
  { id: 'en', label: 'EN' },
  { id: 'zh', label: '中文' },
  { id: 'details', label: 'Details · 详情' },
  { id: 'cover', label: 'Cover · 封面' },
];

// auto_fields name for each form field, to show the AI chip.
const AUTO: Partial<Record<keyof EditorValues, string>> = {
  titleEn: 'title_en', titleZh: 'title_zh', summaryEn: 'summary_en', summaryZh: 'summary_zh', noteEn: 'note_en',
  noteZh: 'note_zh', category: 'category', eventLanguage: 'event_language', start: 'start_at', end: 'end_at', tz: 'tz',
  venueName: 'venue_name', city: 'city', format: 'format', priceText: 'price_text', access: 'access', privateVenue: 'private_venue',
};

const ZONES = ['America/Los_Angeles', 'America/Denver', 'America/Chicago', 'America/New_York', 'Asia/Shanghai', 'Asia/Hong_Kong', 'Asia/Taipei', 'Asia/Tokyo', 'Europe/London', 'UTC'];

/**
 * Guide「/admin/e/[id]」: phone = EN, 中文, Details, Cover tabs; desktop = EN and 中文 side by side
 * with details and cover below. One form (id="editor"); the sticky bar's buttons submit it with
 * an `_op`, so any action saves pending edits first. The form is keyed by the row's updatedAt,
 * so values refreshed on the server (e.g. a re-translation) replace what's on screen.
 */
export function EditorShell(props: {
  id: string; version: number; status: string; values: EditorValues; autoFields: string[]; heading: string;
  when: string | null; publicHref: string | null; cover: ReactNode; going: ReactNode;
}) {
  const { id, version, status, values: v, autoFields } = props;
  const [tab, setTab] = useState<Tab>('en');
  const [state, action, pending] = useActionState<ActionState, FormData>(editorAction.bind(null, id), null);
  const ai = (k: keyof EditorValues) => (AUTO[k] && autoFields.includes(AUTO[k]!) ? <span className="ml-1.5 rounded-full border border-cat-ai px-1.5 font-mono text-[0.625rem] text-cat-ai">AI</span> : null);
  const panel = (t: Tab) => (tab === t ? 'block' : 'hidden md:block');

  const fieldLabel = (k: keyof EditorValues, children: ReactNode) => (
    <label htmlFor={k} className={field.label}>
      {children}
      {ai(k)}
    </label>
  );
  const rt = (f: 'title' | 'summary' | 'note', to: 'en' | 'zh') => (
    <button type="submit" name="_op" value={`rt:${f}:${to}`} disabled={pending} className="text-xs text-muted underline underline-offset-2">
      {to === 'zh' ? '↻ 从英文重译' : '↻ from 中文'}
    </button>
  );
  const lang = (l: 'En' | 'Zh') => (
    <div className="space-y-4">
      <div>
        <div className="flex items-baseline justify-between">
          {fieldLabel(`title${l}`, l === 'En' ? 'Title' : '标题')}
          {rt('title', l === 'En' ? 'en' : 'zh')}
        </div>
        <input id={`title${l}`} name={`title${l}`} defaultValue={v[`title${l}`]} lang={l === 'Zh' ? 'zh-Hans' : 'en'} className={field.input} />
      </div>
      <div>
        <div className="flex items-baseline justify-between">
          {fieldLabel(`note${l}`, l === 'En' ? "Victor's note" : '点评')}
          {rt('note', l === 'En' ? 'en' : 'zh')}
        </div>
        <textarea id={`note${l}`} name={`note${l}`} rows={4} defaultValue={v[`note${l}`]} lang={l === 'Zh' ? 'zh-Hans' : 'en'} className={field.area} />
      </div>
      <div>
        <div className="flex items-baseline justify-between">
          {fieldLabel(`summary${l}`, l === 'En' ? 'Summary (≤240)' : '摘要（≤120 字）')}
          {rt('summary', l === 'En' ? 'en' : 'zh')}
        </div>
        <textarea id={`summary${l}`} name={`summary${l}`} rows={3} maxLength={l === 'En' ? 240 : 120} defaultValue={v[`summary${l}`]} lang={l === 'Zh' ? 'zh-Hans' : 'en'} className={field.area} />
      </div>
    </div>
  );

  const sel = (k: keyof EditorValues, label: ReactNode, opts: [string, string][]) => (
    <div>
      {fieldLabel(k, label)}
      <select id={k} name={k} defaultValue={String(v[k])} className={field.input}>
        {opts.map(([val, text]) => (
          <option key={val} value={val}>{text}</option>
        ))}
      </select>
    </div>
  );
  const txt = (k: keyof EditorValues, label: ReactNode, extra: Record<string, unknown> = {}) => (
    <div>
      {fieldLabel(k, label)}
      <input id={k} name={k} defaultValue={String(v[k])} className={field.input} {...extra} />
    </div>
  );
  const box = (k: keyof EditorValues, label: ReactNode) => (
    <label className="flex min-h-11 items-center gap-3">
      <input type="checkbox" name={k} defaultChecked={Boolean(v[k])} className="size-5 accent-ink" />
      <span>{label}</span>
      {ai(k)}
    </label>
  );

  return (
    <div className="mx-auto max-w-5xl">
      <header className="flex items-center gap-3 px-4 pt-4">
        <Link href={status === 'draft' ? '/admin/drafts' : '/admin/live'} className={btn.small} aria-label="Back · 返回">
          ←
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="truncate font-display text-h3 font-semibold">{props.heading}</h1>
          <p className="truncate text-sm text-muted">
            {status === 'draft' ? '草稿' : status === 'published' ? '已发布' : status === 'cancelled' ? '已取消' : '已下架'}
            {props.when ? ` · ${props.when}` : ''}
            {props.publicHref && (
              <>
                {' · '}
                <a href={props.publicHref} target="_blank" rel="noreferrer" className="underline">View · 查看</a>
              </>
            )}
          </p>
        </div>
      </header>

      <div role="tablist" aria-label="Sections" className="sticky top-0 z-10 mt-3 flex gap-1 border-b border-rule bg-paper px-4 md:hidden">
        {TABS.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)} className="h-11 flex-1 border-b-2 border-transparent text-sm text-muted aria-selected:border-ink aria-selected:text-ink">
            {t.label}
          </button>
        ))}
      </div>

      <form id="editor" key={version} action={action} className="px-4 pt-4 md:grid md:grid-cols-2 md:gap-x-8">
        <section className={panel('en')} lang="en">
          <h2 className="mb-3 hidden font-mono text-xs uppercase text-muted md:block">English</h2>
          {lang('En')}
        </section>
        <section className={panel('zh')}>
          <h2 className="mb-3 hidden font-mono text-xs uppercase text-muted md:block">中文</h2>
          {lang('Zh')}
        </section>
        <section className={`${panel('details')} md:col-span-2 md:mt-8`}>
          <h2 className="mb-3 hidden font-mono text-xs uppercase text-muted md:block">Details · 详情</h2>
          <div className="grid gap-4 md:grid-cols-3">
            {sel('category', 'Category · 类别', [['', '— 选择 —'], ...CATEGORY_SLUGS.map((c): [string, string] => [c, `${CATEGORIES[c].zh} · ${CATEGORIES[c].en}`])])}
            {txt('start', 'Starts · 开始', { type: 'datetime-local' })}
            {txt('end', 'Ends · 结束', { type: 'datetime-local' })}
            <div>
              {fieldLabel('tz', 'Time zone · 时区')}
              <input id="tz" name="tz" list="zones" defaultValue={v.tz} className={field.input} />
              <datalist id="zones">{ZONES.map((z) => <option key={z} value={z} />)}</datalist>
            </div>
            {sel('format', 'Format · 形式', [['in_person', '线下'], ['online', '线上'], ['hybrid', '线上线下']])}
            {sel('eventLanguage', 'Event language · 活动语言', [['en', 'English'], ['zh', '中文'], ['bilingual', '双语']])}
            {txt('venueName', 'Venue · 场地')}
            {txt('city', 'City · 城市')}
            {txt('neighborhood', 'Neighborhood · 街区')}
            {sel('region', 'Region · 区域', [['', '—'], ['sf', 'San Francisco'], ['east_bay', 'East Bay'], ['peninsula', 'Peninsula'], ['south_bay', 'South Bay'], ['north_bay', 'North Bay'], ['online', 'Online']])}
            {txt('priceText', 'Price · 价格')}
            {sel('access', 'Access · 报名方式', [['open', '直接报名'], ['apply', '需审核'], ['waitlist', '候补'], ['sold_out', '已满'], ['unknown', '未知']])}
            {txt('hostName', 'Host · 主办方')}
            {txt('hostUrl', 'Host link · 主办方链接', { type: 'url' })}
            {txt('sourceUrl', 'RSVP link · 报名链接', { type: 'url', required: true })}
            <div className="md:col-span-2">
              {fieldLabel('address', 'Address (private unless ticked) · 地址（默认不公开）')}
              <input id="address" name="address" defaultValue={v.address} className={field.input} />
            </div>
            {txt('tags', 'Tags · 标签（逗号分隔）')}
            {sel('coverPolicy', 'Cover policy · 封面策略', [['official', '官方封面优先'], ['template', '只用模板']])}
          </div>
          <div className="mt-4 grid gap-1 md:grid-cols-2">
            {box('privateVenue', 'Private venue · 私人场地（会去印章活动后才公开）')}
            {box('addressPublic', 'Show the full address · 公开完整地址')}
            {box('allDay', 'All day · 全天')}
            {box('featured', 'Featured · 精选')}
          </div>
        </section>
      </form>

      <section className={`${panel('details')} mt-8 px-4`}>{props.going}</section>
      <section className={`${panel('cover')} mt-8 px-4`}>{props.cover}</section>

      <div className="sticky bottom-0 z-10 mt-8 border-t border-rule bg-paper/95 px-4 pt-3 backdrop-blur" style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}>
        <p role="status" aria-live="polite" className={`mb-2 min-h-5 text-sm ${state && !state.ok ? 'text-seal-text' : 'text-muted'}`}>
          {pending ? 'Saving… · 保存中…' : state?.message}
        </p>
        <div className="flex flex-wrap gap-2">
          <button type="submit" form="editor" name="_op" value="save" disabled={pending} className={`${btn.secondary} flex-1`}>
            Save · 保存
          </button>
          {status === 'draft' && (
            <button type="submit" form="editor" name="_op" value="publish" disabled={pending} className={`${btn.primary} flex-1`}>
              Publish · 发布
            </button>
          )}
          {status === 'cancelled' && (
            <button type="submit" form="editor" name="_op" value="publish" disabled={pending} className={`${btn.primary} flex-1`}>
              Restore · 恢复
            </button>
          )}
          {status === 'archived' && (
            <button type="submit" form="editor" name="_op" value="publish" disabled={pending} className={`${btn.primary} flex-1`}>
              Republish · 重新发布
            </button>
          )}
        </div>
        <details className="mt-2 text-sm">
          <summary className="cursor-pointer py-1 text-muted">More · 更多操作</summary>
          <div className="flex flex-wrap gap-2 py-2">
            {autoFields.length > 0 && (
              <button type="submit" form="editor" name="_op" value="confirm" disabled={pending} className={btn.small}>
                Confirm all AI fields · 确认全部 AI 字段
              </button>
            )}
            {status === 'published' && (
              <>
                <button type="submit" form="editor" name="_op" value="cancel" disabled={pending} className={btn.small}>
                  Event cancelled · 活动取消了
                </button>
                <button type="submit" form="editor" name="_op" value="unpublish" disabled={pending} className={btn.small}>
                  Take down · 下架
                </button>
              </>
            )}
            {status === 'draft' && (
              <button type="submit" form="editor" name="_op" value="dismiss" disabled={pending} className={btn.small}>
                Discard draft · 不要这条
              </button>
            )}
          </div>
        </details>
      </div>
    </div>
  );
}
