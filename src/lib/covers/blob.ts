import 'server-only';
import { del, put } from '@vercel/blob';

// Thin seam over Vercel Blob so the cover chain can run (and be tested) without a store.
// Without BLOB_READ_WRITE_TOKEN nothing is uploaded: covers stay on the typographic template.

export const blobConfigured = () => Boolean(process.env.BLOB_READ_WRITE_TOKEN);

export type Store = {
  put(path: string, body: Buffer, contentType: string): Promise<string>;
  del(urls: string[]): Promise<void>;
};

export const blobStore: Store = {
  async put(path, body, contentType) {
    const r = await put(path, body, { access: 'public', contentType, addRandomSuffix: true, cacheControlMaxAge: 31_536_000 });
    return r.url;
  },
  async del(urls) {
    if (urls.length) await del(urls);
  },
};

/** Only Blob-hosted files are ours to delete (template rows point at /og routes, seeds at template:). */
export const isBlobUrl = (u: string) => /^https:\/\/[a-z0-9-]+\.public\.blob\.vercel-storage\.com\//.test(u);
