'use client';
import { type ReactNode, type Ref, type RefObject, useEffect, useRef, useState, useTransition } from 'react';
import {
  type ActionState, type AiPreviewState, applyAiCover, type CoverSearchState, generateAiCover, pickBraveCover, pickOpenverseCover,
  searchBraveCovers, searchOpenverseCovers,
} from '@/app/admin/actions';
import type { AiTier } from '@/lib/covers/ai';
import type { BraveHit } from '@/lib/covers/brave';
import type { OpenverseHit } from '@/lib/covers/openverse';
import { btn, field } from './ui';

// Cover selector steps 4–6 (M4 F11): Openverse, AI abstract, Brave web search. Manual only: every
// source shows a preview or a confirm step before anything replaces the cover. Thumbnails load
// straight from Openverse / Brave in Victor's browser (no referrer); picks are copied into Blob on
// the server. Each section says plainly when it isn't set up.
//
// Focus (as in DigestEditor): the confirm step takes focus on "Use this"; a control disabled while
// its work runs, or removed by the result, hands focus back once it settles (useFocusReturn).

export type CoverSourcesProps = {
  id: string;
  hasCategory: boolean;
  blobReady: boolean;
  aiReady: boolean;
  braveReady: boolean;
  openverseQuery: string;
  braveQuery: string;
  /** Today's searches / generations left (null when unknown). */
  remaining: { openverse: number | null; brave: number | null; ai: number | null };
};

const NO_BLOB = 'Picking needs Blob storage (checklist 2) · 选图需要先在 Vercel 建 Blob（checklist 2）';

export function CoverSources(p: CoverSourcesProps) {
  return (
    <div className="mt-6 space-y-2">
      <h3 className="font-mono text-xs uppercase text-muted">More sources · 更多来源</h3>
      <OpenverseSection {...p} />
      <AiSection {...p} />
      <BraveSection {...p} />
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <details className="group rounded-lg border border-rule">
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 px-3 text-sm [&::-webkit-details-marker]:hidden">
        {title}
        <span aria-hidden className="text-muted transition-transform group-open:rotate-90">›</span>
      </summary>
      <div className="space-y-3 border-t border-rule p-3">{children}</div>
    </details>
  );
}

/** The first element still on the page and not disabled. */
export function nextFocus(candidates: (HTMLElement | null | undefined)[]): HTMLElement | null {
  return candidates.find((el): el is HTMLElement => Boolean(el?.isConnected) && !(el as HTMLButtonElement).disabled) ?? null;
}

const thumbOf = (grid: HTMLElement | null, id: string) =>
  [...(grid?.querySelectorAll<HTMLElement>('button[data-hit]') ?? [])].find((b) => b.dataset.hit === id) ?? null;

/**
 * DigestEditor's focus rule for one section. The pressed control is disabled while its work runs
 * (or the result removes it: "Use this", "Cancel", the last "More results"), which drops focus to
 * <body>. Once the work settles, focus goes back to that control, else to the thumbnail the
 * confirm step was for, else to the status line. Cancel has nothing to wait for: the next commit.
 */
function useFocusReturn(pending: boolean, status: RefObject<HTMLElement | null>, grid?: RefObject<HTMLElement | null>) {
  const back = useRef<{ el: HTMLElement | null; thumb: string | null } | null>(null);
  const now = useRef(false);
  const wasPending = useRef(pending);
  // No deps: compare with the previous commit.
  useEffect(() => {
    const settled = (wasPending.current && !pending) || now.current;
    wasPending.current = pending;
    if (!settled) return;
    now.current = false;
    const to = back.current;
    back.current = null;
    if (!to || (document.activeElement && document.activeElement !== document.body)) return;
    nextFocus([to.el, to.thumb ? thumbOf(grid?.current ?? null, to.thumb) : null, status.current])?.focus();
  });
  return {
    /** Call before starting work: the control that started it, and the thumbnail being confirmed. */
    from: (el: HTMLElement | null, thumb: string | null = null) => {
      back.current = { el, thumb };
    },
    cancelled: (thumb: string) => {
      back.current = { el: null, thumb };
      now.current = true;
    },
  };
}

/** Result line and today's count, read out when they change; takes focus when the pressed control is gone. */
function Status({ state, pending, remaining, busyText = 'Working… · 处理中…', ref }: {
  state: { ok: boolean; message: string } | null; pending: boolean; remaining: number | null; busyText?: string; ref?: Ref<HTMLParagraphElement>;
}) {
  return (
    <p ref={ref} role="status" aria-live="polite" tabIndex={-1} className={`min-h-5 text-sm ${state?.ok === false && !pending ? 'text-seal-text' : 'text-muted'}`}>
      {pending ? busyText : state?.message}
      {remaining !== null && (
        <span className="block text-xs text-muted">
          {remaining} left today · 今天还剩 {remaining} 次
        </span>
      )}
    </p>
  );
}

function SearchBox({ name, initial, disabled, onSearch }: {
  name: string; initial: string; disabled: boolean; onSearch: (q: string, from: HTMLElement | null) => void;
}) {
  const [q, setQ] = useState(initial);
  return (
    <form
      role="search"
      className="flex gap-2"
      onSubmit={(ev) => {
        ev.preventDefault();
        // Enter in the field: back to the field; a tap on Search (Safari doesn't focus buttons): the button.
        const active = document.activeElement;
        const from = active instanceof HTMLElement && ev.currentTarget.contains(active) ? active : (ev.nativeEvent as SubmitEvent).submitter;
        if (q.trim()) onSearch(q, from);
      }}
    >
      <label htmlFor={name} className="sr-only">Search words · 搜索词</label>
      <input
        id={name}
        type="search"
        enterKeyHint="search"
        value={q}
        onChange={(ev) => setQ(ev.target.value)}
        maxLength={200}
        className={`${field.input} mt-0 min-w-0`}
        disabled={disabled}
      />
      <button className={`${btn.secondary} shrink-0`} disabled={disabled || !q.trim()}>Search · 搜索</button>
    </form>
  );
}

/**
 * Results as square buttons. Unusable ones are faded and disabled; `faded` is the visible line that
 * says why (a title tooltip never shows on a phone), and those tiles point at it.
 */
export function ThumbGrid<H extends { id: string; thumbUrl: string; title: string }>({ hits, selected, onSelect, usable, faded, ref }: {
  hits: H[]; selected: string | null; onSelect: (h: H) => void; usable?: (h: H) => boolean;
  faded?: { id: string; text: string }; ref?: Ref<HTMLUListElement>;
}) {
  const note = faded && usable && hits.some((h) => !usable(h)) ? faded : null;
  return (
    <>
      {note && (
        <p id={note.id} className="text-xs text-muted">
          {note.text}
        </p>
      )}
      <ul ref={ref} className="grid grid-cols-3 gap-2">
        {hits.map((h) => {
          const ok = usable ? usable(h) : true;
          return (
            <li key={h.id}>
              <button
                type="button"
                data-hit={h.id}
                onClick={() => onSelect(h)}
                disabled={!ok}
                aria-pressed={selected === h.id}
                aria-describedby={!ok && note ? note.id : undefined}
                title={ok ? h.title : 'Too small or unsupported · 太小或格式不支持'}
                className="block aspect-square w-full overflow-hidden rounded-lg border border-rule bg-rule/30 disabled:opacity-40 aria-pressed:ring-2 aria-pressed:ring-ink aria-pressed:ring-offset-2"
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- third-party thumbnails, shown to the admin only */}
                <img src={h.thumbUrl} alt={h.title || 'Untitled · 无标题'} referrerPolicy="no-referrer" loading="lazy" decoding="async" className="size-full object-cover" />
              </button>
            </li>
          );
        })}
      </ul>
    </>
  );
}

/**
 * The step between a tapped thumbnail and the cover changing. It sits above the grid, so it takes
 * focus ("Use this", or Cancel while that is disabled) and scrolls itself into view (the grid is
 * long on a phone). Keyed by the hit, so each tap mounts it afresh.
 */
export function Confirm({ children, onUse, onCancel, disabled }: {
  children: ReactNode; onUse: (from: HTMLElement) => void; onCancel: () => void; disabled: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => ref.current?.scrollIntoView({ block: 'nearest' }), []);
  return (
    <div ref={ref} className="space-y-2 rounded-lg border border-ink p-3 text-sm">
      {children}
      <div className="flex flex-wrap gap-2">
        <button type="button" className={btn.primary} onClick={(ev) => onUse(ev.currentTarget)} disabled={disabled} autoFocus={!disabled}>
          Use this · 用这张
        </button>
        <button type="button" className={btn.secondary} onClick={onCancel} autoFocus={disabled}>Cancel · 取消</button>
      </div>
    </div>
  );
}

const ext = (href: string, label: string) => (
  <a href={href} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center underline underline-offset-2">
    {label} ↗
  </a>
);

// ---- Openverse ---------------------------------------------------------------------------------

/** Why some tiles are faded (openverse.ts `usable`: SVG, over the 15 MB download cap, under 400 px). */
const FADED = { id: 'ov-faded', text: 'Faded: too small, SVG or over 15 MB · 变淡的图太小、是 SVG 或超过 15 MB' };

function OpenverseSection({ id, blobReady, openverseQuery, remaining }: CoverSourcesProps) {
  const [hits, setHits] = useState<OpenverseHit[]>([]);
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [more, setMore] = useState(false);
  const [sel, setSel] = useState<OpenverseHit | null>(null);
  const [state, setState] = useState<CoverSearchState<OpenverseHit> | ActionState>(null);
  const [left, setLeft] = useState(remaining.openverse);
  const [pending, start] = useTransition();
  const status = useRef<HTMLParagraphElement>(null);
  const grid = useRef<HTMLUListElement>(null);
  const focus = useFocusReturn(pending, status, grid);

  const search = (q: string, nextPage: number, from: HTMLElement | null) => {
    focus.from(from);
    start(async () => {
      const r = await searchOpenverseCovers(q, nextPage);
      setState(r);
      if (typeof r.remaining === 'number') setLeft(r.remaining);
      if (!r.ok) return;
      const got = r.hits ?? [];
      setQuery(q);
      setPage(nextPage);
      setMore(got.length >= 20 && nextPage < 5);
      setHits((prev) => (nextPage === 1 ? got : [...prev, ...got.filter((h) => !prev.some((x) => x.id === h.id))]));
      if (nextPage === 1) setSel(null);
    });
  };

  const use = (h: OpenverseHit, from: HTMLElement) => {
    focus.from(from, h.id);
    start(async () => {
      const r = await pickOpenverseCover(id, h.id);
      setState(r);
      if (r?.ok) setSel(null);
    });
  };
  const cancel = (h: OpenverseHit) => {
    focus.cancelled(h.id);
    setSel(null);
  };

  return (
    <Section title="Openverse · 开放许可图库">
      <p className="text-sm text-muted">CC0, CC BY and CC BY-SA only; the credit is saved and shown under the cover · 只有 CC0 / BY / BY-SA，署名自动保存并显示在封面下</p>
      <SearchBox name="ov-q" initial={openverseQuery} disabled={pending} onSearch={(q, from) => search(q, 1, from)} />
      <Status ref={status} state={state} pending={pending} remaining={left} />
      {sel && (
        <Confirm key={sel.id} onUse={(from) => use(sel, from)} onCancel={() => cancel(sel)} disabled={pending || !blobReady}>
          <p className="break-words">{sel.credit}</p>
          {sel.width && sel.height && <p className="tnum font-mono text-xs text-muted">{sel.width}×{sel.height}</p>}
          {sel.pageUrl && ext(sel.pageUrl, 'Source page · 来源页')}
          {!blobReady && <p className="text-seal-text">{NO_BLOB}</p>}
        </Confirm>
      )}
      {hits.length > 0 && (
        <ThumbGrid hits={hits} selected={sel?.id ?? null} onSelect={setSel} usable={(h) => h.usable} faded={FADED} ref={grid} />
      )}
      {more && (
        <button type="button" className={btn.secondary} onClick={(ev) => search(query, page + 1, ev.currentTarget)} disabled={pending}>
          More results · 更多结果
        </button>
      )}
    </Section>
  );
}

// ---- AI ----------------------------------------------------------------------------------------

const AI_COST: Record<AiTier, string> = { fast: '$0.007', fine: '$0.04' };

function AiSection({ id, hasCategory, blobReady, aiReady, remaining }: CoverSourcesProps) {
  const [preview, setPreview] = useState<{ url: string; tier: AiTier } | null>(null);
  const [state, setState] = useState<AiPreviewState | ActionState>(null);
  const [left, setLeft] = useState(remaining.ai);
  const [busy, setBusy] = useState<'generate' | 'use' | null>(null);
  const [, start] = useTransition();
  const status = useRef<HTMLParagraphElement>(null);
  const focus = useFocusReturn(busy !== null, status);
  const blocked = !aiReady
    ? "AI Gateway isn't set up yet (checklist 8) · AI 还没配置（checklist 8）"
    : !blobReady
      ? NO_BLOB
      : !hasCategory
        ? 'Pick a category first; the picture comes from it · 先选类别，图按类别生成'
        : null;
  const disabled = Boolean(blocked) || busy !== null || left === 0;

  // One request at a time: every tap may be billed, so buttons stay disabled until it answers.
  const generate = (tier: AiTier, from: HTMLElement) => {
    focus.from(from);
    setBusy('generate');
    start(async () => {
      try {
        const r = await generateAiCover(id, tier);
        setState(r);
        if (typeof r.remaining === 'number') setLeft(r.remaining);
        if (r.ok && r.url && r.tier) setPreview({ url: r.url, tier: r.tier });
      } finally {
        setBusy(null);
      }
    });
  };
  const use = (from: HTMLElement) => {
    if (!preview) return;
    focus.from(from);
    setBusy('use');
    start(async () => {
      try {
        const r = await applyAiCover(id, preview.url, preview.tier);
        setState(r);
        if (r?.ok) setPreview(null);
      } finally {
        setBusy(null);
      }
    });
  };

  return (
    <Section title={`AI abstract · AI 抽象封面 (${AI_COST.fast})`}>
      <p className="text-sm text-muted">
        Abstract art in the category&apos;s colours: no text, people or logos, nothing from the event page. Preview first · 只按类别生成抽象图，无文字、人物、标志，不用活动页内容；先预览再使用
      </p>
      {blocked && <p className="text-sm text-seal-text">{blocked}</p>}
      <div className="flex flex-wrap gap-2">
        <button type="button" className={btn.secondary} onClick={(ev) => generate('fast', ev.currentTarget)} disabled={disabled}>
          Generate · 生成 {AI_COST.fast}
        </button>
        <button type="button" className={btn.secondary} onClick={(ev) => generate('fine', ev.currentTarget)} disabled={disabled}>
          Finer · 精细版 {AI_COST.fine}
        </button>
      </div>
      <Status
        ref={status}
        state={state}
        pending={busy !== null}
        remaining={left}
        busyText={busy === 'generate' ? 'Generating, up to 45 s… · 生成中，最多 45 秒…' : 'Working… · 处理中…'}
      />
      {preview && (
        <figure className="space-y-2">
          {/* eslint-disable-next-line @next/next/no-img-element -- a Blob preview, not yet a cover */}
          <img src={preview.url} alt="AI cover preview · AI 封面预览" className="aspect-square w-full max-w-80 rounded-lg border border-rule object-cover" />
          <figcaption className="flex flex-wrap gap-2">
            <button type="button" className={btn.primary} onClick={(ev) => use(ev.currentTarget)} disabled={busy !== null}>Use this · 用这张</button>
            <button type="button" className={btn.secondary} onClick={(ev) => generate(preview.tier, ev.currentTarget)} disabled={disabled}>
              Try again · 再来一张
            </button>
          </figcaption>
        </figure>
      )}
    </Section>
  );
}

// ---- Brave -------------------------------------------------------------------------------------

function BraveSection({ id, blobReady, braveReady, braveQuery, remaining }: CoverSourcesProps) {
  const [hits, setHits] = useState<BraveHit[]>([]);
  const [sel, setSel] = useState<BraveHit | null>(null);
  const [state, setState] = useState<CoverSearchState<BraveHit> | ActionState>(null);
  const [left, setLeft] = useState(remaining.brave);
  const [pending, start] = useTransition();
  const status = useRef<HTMLParagraphElement>(null);
  const grid = useRef<HTMLUListElement>(null);
  const focus = useFocusReturn(pending, status, grid);

  const search = (q: string, from: HTMLElement | null) => {
    focus.from(from);
    start(async () => {
      const r = await searchBraveCovers(q);
      setState(r);
      if (typeof r.remaining === 'number') setLeft(r.remaining);
      if (r.ok) {
        setHits(r.hits ?? []);
        setSel(null);
      }
    });
  };
  const use = (h: BraveHit, from: HTMLElement) => {
    focus.from(from, h.id);
    start(async () => {
      const r = await pickBraveCover(id, { imageUrl: h.imageUrl, pageUrl: h.pageUrl, thumbUrl: h.thumbUrl });
      setState(r);
      if (r?.ok) setSel(null);
    });
  };
  const cancel = (h: BraveHit) => {
    focus.cancelled(h.id);
    setSel(null);
  };

  return (
    <Section title="Web search · 网络搜索 (Brave)">
      {!braveReady ? (
        <p className="text-sm text-seal-text">Needs a Brave Search API key · 需要 Brave 搜索 API 密钥（BRAVE_SEARCH_API_KEY）</p>
      ) : (
        <>
          <p className="text-sm text-muted">
            Suggestions only, licence unknown: use the host&apos;s own images. Not used in emails or share cards · 只是建议，许可不明，请选主办方自己的图；邮件和分享卡片里会换成模板
          </p>
          <SearchBox name="brave-q" initial={braveQuery} disabled={pending} onSearch={search} />
          <Status ref={status} state={state} pending={pending} remaining={left} />
          {sel && (
            <Confirm key={sel.id} onUse={(from) => use(sel, from)} onCancel={() => cancel(sel)} disabled={pending || !blobReady}>
              {sel.title && <p className="break-words">{sel.title}</p>}
              <p className="text-muted">Image via {sel.host} · 图片来自 {sel.host}</p>
              {ext(sel.pageUrl, 'Open page · 打开来源页')}
              {!blobReady && <p className="text-seal-text">{NO_BLOB}</p>}
            </Confirm>
          )}
          {hits.length > 0 && <ThumbGrid hits={hits} selected={sel?.id ?? null} onSelect={setSel} ref={grid} />}
        </>
      )}
    </Section>
  );
}
