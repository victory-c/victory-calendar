import { handleUpload, type HandleUploadBody } from '@vercel/blob/client';
import { adminSessionFrom } from '@/lib/admin-session';
import { blobConfigured } from '@/lib/covers/blob';

// Client-side photo upload for the cover selector (guide: Blob handleUpload bypasses the 4.5 MB
// function body limit). This route only issues upload tokens, for Victor's session only; the
// editor then hands the uploaded URL to coverFromUpload(), which processes it and deletes it.
export async function POST(req: Request) {
  if (!blobConfigured()) return Response.json({ error: 'no_blob' }, { status: 503 });
  let body: HandleUploadBody;
  try {
    body = (await req.json()) as HandleUploadBody;
  } catch {
    return Response.json({ error: 'bad_request' }, { status: 400 });
  }
  try {
    const result = await handleUpload({
      request: req,
      body,
      onBeforeGenerateToken: async (pathname) => {
        const session = await adminSessionFrom(req).catch(() => null);
        if (!session) throw new Error('unauthorized');
        if (!/^uploads\/[\w.-]+$/.test(pathname)) throw new Error('bad pathname');
        return {
          allowedContentTypes: ['image/*'],
          maximumSizeInBytes: 15_000_000,
          addRandomSuffix: true,
          validUntil: Date.now() + 10 * 60_000,
        };
      },
    });
    return Response.json(result, { headers: { 'cache-control': 'no-store' } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'error';
    return Response.json({ error: msg }, { status: msg === 'unauthorized' ? 401 : 400 });
  }
}
