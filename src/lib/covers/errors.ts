import { SafeFetchError } from '../ingest/safe-fetch';
import { CoverError } from './process';

// Errors from the cover selector's search and generate sources (Openverse, Brave, AI), each with
// the bilingual line the editor shows. Logs carry only the code and HTTP status.

export type CoverSourceCode =
  | 'not_configured' | 'no_blob' | 'no_category' | 'cap' | 'busy' | 'rejected' | 'credits' | 'unavailable'
  | 'license' | 'gone' | 'bad_input' | 'no_image' | 'timeout' | 'failed';

export class CoverSourceError extends Error {
  constructor(public code: CoverSourceCode, message: string, public status?: number) {
    super(message);
    this.name = 'CoverSourceError';
  }
}

export const noBlob = () => new CoverSourceError('no_blob', 'Needs Blob storage (checklist 2) · 需要先在 Vercel 建 Blob（checklist 2）');
export const capReached = (max: number) => new CoverSourceError('cap', `Daily limit reached (${max} a day) · 今天的次数用完了（每天 ${max} 次）`);

/** A failed call to a search API, in words. */
export function apiError(name: string, e: unknown): CoverSourceError {
  if (e instanceof CoverSourceError) return e;
  const status = e instanceof SafeFetchError ? e.status : undefined;
  if (status === 429) return new CoverSourceError('busy', `${name} is busy; try again in a minute · ${name} 繁忙，过一会再试`, status);
  if (status === 401 || status === 403 || status === 422) {
    return new CoverSourceError('rejected', `${name} refused the request (HTTP ${status}) · ${name} 拒绝了请求（HTTP ${status}）`, status);
  }
  if (status === 402) return new CoverSourceError('credits', `${name} needs a paid plan or credit · ${name} 需要付费额度`, status);
  if (status === 404) return new CoverSourceError('gone', 'That image is no longer available · 这张图已经不在了', status);
  if (e instanceof SafeFetchError && e.code === 'timeout') return new CoverSourceError('timeout', `${name} took too long · ${name} 超时了`);
  return new CoverSourceError('unavailable', `Couldn't reach ${name} · 连不上 ${name}`, status);
}

/** Editor message for anything a manual cover pick can throw. */
export function coverErrorText(e: unknown): string {
  if (e instanceof CoverSourceError) return e.message;
  if (e instanceof CoverError) {
    if (e.code === 'too_small') return `Image too small (${e.message}) · 图片太小（${e.message}）`;
    return "That file isn't a usable image · 这个文件不是能用的图片";
  }
  if (e instanceof SafeFetchError) {
    if (e.code === 'scheme' || e.code === 'credentials') return 'Only plain https image links · 只接受普通 https 图片链接';
    if (e.code === 'blocked_host' || e.code === 'blocked_ip' || e.code === 'port') return "That address isn't allowed · 这个地址不允许访问";
    if (e.code === 'too_large') return 'Image too large (15 MB max) · 图片太大（最多 15 MB）';
    if (e.code === 'content_type') return "That link isn't an image · 这个链接不是图片";
    return `Couldn't download the image (${e.code}${e.status ? ` ${e.status}` : ''}) · 下载图片失败`;
  }
  return e instanceof Error ? e.message : 'error';
}
