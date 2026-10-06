'use client';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { btn, field } from './ui';

// /admin/digest, under the WeChat text: the issue as a 1080 px WeChat long image and as Xiaohongshu
// pages (F17, decision L7). Editing is desktop-first but posting happens on the iPhone, so saving
// takes three taps there: Build (fetches the images as files; for Xiaohongshu it also copies the
// caption, before anything is awaited), Save (navigator.share with the files, called directly in
// the tap so Safari still counts it as one), then 「存储图像」 in the share sheet. Without file
// sharing (desktop) the download links do it, and every thumbnail can be long-pressed. Images are
// drawn on demand by /admin/digest/image/[week]/[name]; ?v= is the export's fingerprint, so a
// browser keeps them only while the content is unchanged. Each image says which fingerprint it was
// drawn from (x-export-v): a page left open since an edit gets "reload" instead of images numbered
// differently from its text, and a sign-in page (the session ran out) is never saved as a picture.

export type SocialExportProps = {
  week: string;
  /** The issue is still a draft: its content can change. */
  draft: boolean;
  /** The Chinese intro is still an unapproved AI draft. */
  introDrafted: boolean;
  /** Set when the export could not be built (the preview shows the same problem). */
  error: string | null;
  /** null when the week has no picks. */
  wechat: { parts: number; v: string } | null;
  xhs: { pages: number; v: string; caption: { title: string; body: string } } | null;
  warnings: string[];
};

type Kind = 'wechat' | 'xhs';
type Built = { v: string; files: File[]; urls: string[] };
type State = 'building' | 'ready' | 'shared' | 'retry' | 'noshare' | 'stale' | 'error';
export type Status = { v: string; state: State; message?: string };

/** The parts of a fetch Response that imageProblem() reads. */
type ImageResponse = Pick<Response, 'ok' | 'status' | 'redirected' | 'type' | 'headers'>;

/**
 * Why a fetched image can't be used, or null. 'signed-out': proxy.ts sent the request to sign-in
 * (no session cookie), the route's 401, or anything that is not an image; 'fonts': the route's 503;
 * 'stale': the page's ?v= is no longer what the route draws (it says which in x-export-v), or the
 * part is gone (fewer parts now).
 */
export function imageProblem(res: ImageResponse, v: string): string | null {
  if (res.type === 'opaqueredirect' || res.redirected || res.status === 401) return 'signed-out';
  if (res.status === 503) return 'fonts';
  if (res.status === 404) return 'stale';
  if (!res.ok) return `HTTP ${res.status}`;
  if (!(res.headers.get('content-type') ?? '').startsWith('image/')) return 'signed-out';
  if (res.headers.get('x-export-v') !== v) return 'stale';
  return null;
}

/** The status line: what the last Build or Save did (empty before either). */
export function statusLine(st: Status | undefined, n: number): { text: string; alert: boolean } | null {
  switch (st?.state) {
    case 'building':
      return { text: `Building ${n} ${n === 1 ? 'image' : 'images'}… · 正在生成 ${n} 张…`, alert: false };
    case 'ready':
      return { text: 'Ready: tap Save · 已生成，点「保存」', alert: false };
    case 'shared':
      return { text: 'Shared · 已分享', alert: false };
    case 'retry':
      return { text: 'Tap Save again · 再点一次「保存」', alert: true };
    case 'noshare':
      return { text: 'No share sheet here: use the download links · 这里不能直接分享，请用下面的下载链接', alert: false };
    case 'stale':
      return { text: 'Page is out of date; reload so text and images match · 内容已更新，请刷新页面', alert: true };
    case 'error':
      return { text: st.message ?? 'Could not build the images · 生成失败', alert: true };
    default:
      return null;
  }
}

/** Focus `el` only if focus fell to the page (the pressed Build button was disabled while building). */
export function focusIfDropped(el: Pick<HTMLElement, 'focus'> | null | undefined, doc: Pick<Document, 'activeElement' | 'body'>) {
  if (el && (!doc.activeElement || doc.activeElement === doc.body)) el.focus();
}

const names = (kind: Kind, n: number) => Array.from({ length: n }, (_, i) => (kind === 'wechat' ? `wechat-${i + 1}` : `xhs-${i}`));
const label = (kind: Kind, i: number, n: number) => (kind === 'wechat' ? `长图 ${i + 1}/${n}` : i === 0 ? `封面 1/${n}` : `${i + 1}/${n}`);

export function SocialExport({ week, draft, introDrafted, error, wechat, xhs, warnings }: SocialExportProps) {
  const [built, setBuilt] = useState<Partial<Record<Kind, Built>>>({});
  const [status, setStatus] = useState<Partial<Record<Kind, Status>>>({});
  const [copied, setCopied] = useState<{ v: string; ok: boolean } | null>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  // Object URLs of the thumbnails, freed when replaced and when the panel goes away.
  const objectUrls = useRef<string[]>([]);
  useEffect(() => {
    const list = objectUrls.current;
    return () => list.forEach((u) => URL.revokeObjectURL(u));
  }, []);
  // Save takes focus once the images are ready, if Build's disabling dropped it (screen readers,
  // keyboards; and the next tap on the phone is Save anyway).
  const saveButtons = useRef<Partial<Record<Kind, HTMLButtonElement | null>>>({});
  const focusOnReady = useRef<Kind | null>(null);
  useEffect(() => {
    const kind = focusOnReady.current;
    if (!kind || status[kind]?.state !== 'ready') return;
    focusOnReady.current = null;
    focusIfDropped(saveButtons.current[kind], document);
  }, [status]);

  const src = (name: string, v: string) => `/admin/digest/image/${week}/${name}?v=${v}`;
  const spec = (kind: Kind) => (kind === 'wechat' ? (wechat ? { n: wechat.parts, v: wechat.v } : null) : xhs ? { n: xhs.pages, v: xhs.v } : null);
  const set = (kind: Kind, s: Status) => setStatus((all) => ({ ...all, [kind]: s }));
  const captionText = xhs ? `${xhs.caption.title}\n\n${xhs.caption.body}` : '';

  function copyCaption() {
    if (!xhs) return;
    const v = xhs.v;
    // No async clipboard (an installed iOS web app, a non-secure origin): select the text and use
    // the legacy command; if that fails too, the caption stays selected for a long-press copy.
    const fallback = () => {
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
      setCopied({ v, ok });
    };
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(captionText).then(() => setCopied({ v, ok: true }), fallback);
    else fallback();
  }

  /** Swap the built images of `kind` (null drops them), freeing the old thumbnails' object URLs. */
  function replaceBuilt(kind: Kind, next: Built | null) {
    const old = built[kind]?.urls ?? [];
    old.forEach((u) => URL.revokeObjectURL(u));
    objectUrls.current.splice(0, objectUrls.current.length, ...objectUrls.current.filter((u) => !old.includes(u)), ...(next?.urls ?? []));
    setBuilt((all) => {
      const rest = { ...all };
      delete rest[kind];
      return next ? { ...rest, [kind]: next } : rest;
    });
  }

  async function build(kind: Kind) {
    const s = spec(kind);
    if (!s) return;
    if (kind === 'xhs') copyCaption(); // inside the tap, before anything is awaited
    set(kind, { v: s.v, state: 'building' });
    try {
      const files = await Promise.all(
        names(kind, s.n).map(async (name) => {
          // A redirect is proxy.ts sending a signed-out browser to sign-in: never follow it.
          const res = await fetch(src(name, s.v), { credentials: 'same-origin', redirect: 'manual', cache: 'no-cache' });
          const problem = imageProblem(res, s.v);
          if (problem) throw new Error(problem);
          const blob = await res.blob();
          const type = blob.type || 'image/png';
          return new File([blob], `victor-picks-${week}-${name}.${type === 'image/jpeg' ? 'jpg' : 'png'}`, { type });
        }),
      );
      replaceBuilt(kind, { v: s.v, files, urls: files.map((f) => URL.createObjectURL(f)) });
      focusOnReady.current = kind;
      set(kind, { v: s.v, state: 'ready' });
    } catch (e) {
      const why = e instanceof Error ? e.message : String(e);
      if (why === 'stale') {
        // Images built earlier from this page no longer match what the issue shows (a takedown,
        // a cancellation, an edit): don't offer them.
        replaceBuilt(kind, null);
        set(kind, { v: s.v, state: 'stale' });
        return;
      }
      set(kind, {
        v: s.v,
        state: 'error',
        message:
          why === 'fonts'
            ? 'Fonts could not load; try again · 字体加载失败，请再试一次'
            : why === 'signed-out'
              ? 'Signed out; reload and sign in · 登录已过期，请刷新后登录'
              : `Could not build the images · 生成失败（${why}）`,
      });
    }
  }

  // Synchronous up to navigator.share(): Safari only opens the share sheet inside the tap.
  function save(kind: Kind) {
    const b = built[kind];
    if (!b) return;
    const data = { files: b.files };
    if (typeof navigator.share !== 'function' || !navigator.canShare?.(data)) {
      set(kind, { v: b.v, state: 'noshare' });
      return;
    }
    navigator.share(data).then(
      () => set(kind, { v: b.v, state: 'shared' }),
      (e: unknown) => {
        const name = e instanceof Error ? e.name : '';
        if (name === 'AbortError') return; // closed the share sheet
        set(kind, name === 'NotAllowedError' ? { v: b.v, state: 'retry' } : { v: b.v, state: 'error', message: `Could not share · 分享失败（${name || 'error'}）` });
      },
    );
  }

  const panel = (kind: Kind, title: string, buildLabel: string, saveLabel: string, hint: string, extra?: ReactNode) => {
    const s = spec(kind)!;
    const st = status[kind]?.v === s.v ? status[kind] : undefined;
    const ready = built[kind]?.v === s.v ? built[kind] : undefined;
    const building = st?.state === 'building';
    const stale = st?.state === 'stale';
    const line = statusLine(st, s.n);
    return (
      <div className="space-y-2 border-t border-rule pt-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">{title}</h3>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => build(kind)} disabled={building} className={btn.secondary}>
              {building ? '生成中… · Building' : ready ? `重新生成 · Rebuild` : buildLabel}
            </button>
            {ready && (
              <button
                type="button"
                ref={(el) => {
                  saveButtons.current[kind] = el;
                }}
                onClick={() => save(kind)}
                className={btn.primary}
              >
                {saveLabel}
              </button>
            )}
          </div>
        </div>
        {extra}
        <p role="status" aria-live="polite" className={`min-h-5 text-sm ${line?.alert ? 'text-seal-text' : 'text-muted'}`}>
          {line?.text}
        </p>
        {ready && (
          <ul className="grid grid-cols-3 gap-2">
            {ready.urls.map((u, i) => (
              <li key={u}>
                {/* eslint-disable-next-line @next/next/no-img-element -- a local object URL; long-press saves it on iPhone */}
                <img
                  src={u}
                  alt={label(kind, i, s.n)}
                  className={`w-full rounded border border-rule object-cover object-top ${kind === 'wechat' ? 'h-64' : 'aspect-[3/4]'}`}
                />
              </li>
            ))}
          </ul>
        )}
        {!stale && (
          <p className="flex flex-wrap items-center gap-x-3 text-sm">
            <span className="text-muted">Download · 下载：</span>
            {names(kind, s.n).map((name, i) => (
              <a key={name} href={src(name, s.v)} download className="inline-flex min-h-11 items-center underline underline-offset-2">
                {label(kind, i, s.n)}
              </a>
            ))}
          </p>
        )}
        <p className="text-sm text-muted">{hint}</p>
      </div>
    );
  };

  const notes = [
    ...(draft ? ['Draft: the issue can still change, build again after edits · 草稿：内容还可能改，改完重新生成'] : []),
    ...(introDrafted ? ['The Chinese intro is still an unapproved AI draft · 中文开场白还是没确认的 AI 草稿'] : []),
    ...warnings,
  ];
  const caption = copied && xhs && copied.v === xhs.v ? copied : null;

  return (
    <section aria-labelledby="social-heading" className="space-y-3">
      <h2 id="social-heading" className="font-mono text-xs uppercase text-muted">
        Long image &amp; Xiaohongshu · 长图与小红书
      </h2>
      {error ? (
        <p role="alert" className="text-sm text-seal-text">Could not build the images · 生成失败（{error}）</p>
      ) : !wechat || !xhs ? (
        <p className="text-sm text-muted">No picks this week: nothing to post · 本周没有精选，无需导出</p>
      ) : (
        <>
          <p className="text-sm text-muted">
            Same numbers as the text; nothing is stored, images are drawn when you build · 编号和文字版一致；图片现生成，不存储
          </p>
          {notes.length > 0 && (
            <ul role="note" className="space-y-1 text-sm text-seal-text">
              {notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          )}
          {panel(
            'wechat',
            'WeChat long image · 微信长图',
            '生成长图 · Build image',
            '保存/分享 · Save',
            'Tick 原图 when sending in WeChat, or it gets compressed; prints the week page as plain text · 发微信时勾选「原图」，否则会被压缩；图上只印本周页面地址',
          )}
          {panel(
            'xhs',
            'Xiaohongshu · 小红书',
            '小红书 · Build',
            `保存 ${xhs.pages} 张 · Save`,
            'Template covers only, no link, host or QR code; Build also copies the caption · 只用模板封面，不含链接和二维码；生成时会同时复制文案',
            <>
              <label htmlFor="xhs-caption" className="sr-only">
                Xiaohongshu caption · 小红书文案
              </label>
              <textarea
                ref={area}
                id="xhs-caption"
                readOnly
                rows={6}
                value={captionText}
                lang="zh-Hans"
                onFocus={(e) => e.currentTarget.select()}
                className={`${field.area} text-sm`}
              />
              <p className="text-sm">
                <span className="text-muted">{`Title ${[...xhs.caption.title].length}/20 · body ${[...xhs.caption.body].length}/1000 · 标题和正文`}</span>
                {caption?.ok && <span className="text-muted"> · Caption copied · 文案已复制</span>}
                {caption && !caption.ok && <span className="text-seal-text"> · 已选中，长按复制 · Selected: long-press to copy</span>}
              </p>
            </>,
          )}
        </>
      )}
    </section>
  );
}
