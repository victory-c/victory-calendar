'use client';
import { upload } from '@vercel/blob/client';
import { type ReactNode, useActionState, useState, useTransition } from 'react';
import { type ActionState, coverFromBlobUpload, coverFromLink, switchToTemplate } from '@/app/admin/actions';
import { btn, field } from './ui';

const KIND: Record<string, string> = {
  official: 'Official · 官方封面', host_composite: 'Host photos · 主办方组合图', template: 'Template · 排版模板',
  upload: 'Upload · 相册上传', url: 'Image link · 图片链接', openverse: 'Openverse', ai: 'AI', brave: 'Search · 搜索',
};

/** Cover tab: current cover, back to template, paste an image link, upload from the photo library. */
export function CoverPanel(props: {
  id: string; preview: ReactNode; kind: string | null; letterboxed: boolean; attribution: string | null; blobReady: boolean; hasCategory: boolean;
}) {
  const { id, blobReady } = props;
  const [linkState, linkAction, linkPending] = useActionState<ActionState, FormData>(coverFromLink.bind(null, id), null);
  const [msg, setMsg] = useState<ActionState>(null);
  const [busy, start] = useTransition();

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    start(async () => {
      try {
        const ext = (file.name.split('.').pop() ?? 'jpg').replace(/[^a-z0-9]/gi, '').slice(0, 5) || 'jpg';
        const blob = await upload(`uploads/${id}-${Date.now()}.${ext}`, file, { access: 'public', handleUploadUrl: '/api/covers/upload', contentType: file.type });
        setMsg(await coverFromBlobUpload(id, blob.url));
      } catch (err) {
        setMsg({ ok: false, message: err instanceof Error ? err.message : 'upload failed' });
      }
    });
  }

  const status = linkPending || busy ? 'Working… · 处理中…' : (msg ?? linkState)?.message;
  const failed = (msg ?? linkState)?.ok === false;

  return (
    <div>
      <h2 className="mb-3 font-mono text-xs uppercase text-muted">Cover · 封面</h2>
      <div className="flex flex-wrap items-start gap-4">
        {props.preview}
        <div className="min-w-0 flex-1 space-y-1 text-sm">
          <p>{props.kind ? KIND[props.kind] ?? props.kind : props.hasCategory ? 'Preparing the cover; refresh in a moment · 正在准备封面，稍后刷新' : 'Pick a category first · 先选类别'}</p>
          {props.attribution && <p className="text-muted">{props.attribution}</p>}
          {props.letterboxed && <p className="text-seal-text">Banner-shaped image, letterboxed. A template may look better · 这是横幅图，建议换模板</p>}
        </div>
      </div>

      <div className="mt-4 space-y-4">
        <form action={async () => setMsg(await switchToTemplate(id))}>
          <button className={btn.small} disabled={!props.hasCategory}>Use template · 换成模板</button>
        </form>

        <form action={linkAction} className="flex gap-2">
          <label htmlFor="imageUrl" className="sr-only">Image link · 图片链接</label>
          <input id="imageUrl" name="imageUrl" type="url" inputMode="url" placeholder="https://…/poster.jpg" className={`${field.input} mt-0`} disabled={!blobReady} />
          <button className={`${btn.small} h-11 shrink-0`} disabled={!blobReady || linkPending}>Use link · 用这张</button>
        </form>

        <div>
          <label className={`${btn.small} cursor-pointer ${!blobReady || busy ? 'pointer-events-none opacity-50' : ''}`}>
            Upload from photos · 从相册上传
            <input type="file" accept="image/*" className="sr-only" onChange={onFile} disabled={!blobReady || busy} />
          </label>
        </div>
        {!blobReady && <p className="text-sm text-muted">Links and uploads need Blob storage (checklist 2) · 链接和上传需要先在 Vercel 建 Blob（checklist 2）</p>}
        <p role="status" aria-live="polite" className={`min-h-5 text-sm ${failed ? 'text-seal-text' : 'text-muted'}`}>{status}</p>
      </div>
    </div>
  );
}
