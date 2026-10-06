import { adminSessionFrom } from '@/lib/admin-session';
import { loadExport } from '@/lib/digest/export-source';
import { exportHash, imageName, longPlan, parseImageName, xhsPlan } from '@/lib/digest/social';
import { describeError } from '@/lib/log-safe';
import { renderSocial } from '@/lib/og/social';

// GET /admin/digest/image/2026-W42/wechat-1 (…/xhs-0 … xhs-8): one image of the issue's WeChat long
// image or Xiaohongshu pages (F17, decision L6), drawn on demand and never stored (no Blob, no CDN).
// The admin session cookie only, never principalFrom: a Bearer token can't fetch it. No dot in the
// path, so proxy.ts still sends a signed-out browser to sign-in; this handler re-checks the session.
// Works for any issue state, drafts included; never creates an issue. Caching is private: a year
// when ?v= is the current export fingerprint and nothing fell back (a cover that failed to load),
// otherwise not at all. Every image says which fingerprint it was drawn from (x-export-v), so a page
// left open since an edit (other numbers in its text) can tell and ask for a reload instead of
// saving images that don't match. A missing font chunk is a 503, never an image with blank Chinese.

export const maxDuration = 60;

const WEEK = /^\d{4}-W\d{2}$/;
const NO_STORE = 'private, no-store';

const deny = (status: number) => new Response(null, { status, headers: { 'cache-control': 'no-store' } });

export async function GET(req: Request, { params }: { params: Promise<{ week: string; name: string }> }) {
  // A link or image tag on another site can't make the admin's browser draw these.
  if (req.headers.get('sec-fetch-site') === 'cross-site') return deny(403);
  let session = null;
  try {
    session = await adminSessionFrom(req);
  } catch (err) {
    console.warn('[digest/image] session check failed', err instanceof Error ? err.message : err);
  }
  if (!session) return deny(401);

  const { week, name } = await params;
  const target = parseImageName(name);
  if (!WEEK.test(week) || !target) return deny(404);

  try {
    const src = await loadExport(week, new Date());
    if (!src?.model) return deny(404);
    const m = src.model;
    const part = target.kind === 'wechat' ? longPlan(m).find((p) => p.index === target.index) : undefined;
    const page = target.kind === 'xhs' ? xhsPlan(m).find((p) => p.index === target.index) : undefined;
    if (!part && !page) return deny(404);

    const image = await renderSocial(m, part ? { kind: 'wechat', part } : { kind: 'xhs', page: page! }, { allToTemplate: src.allToTemplate });
    if (!image.ok) return new Response('fonts unavailable', { status: 503, headers: { 'cache-control': 'no-store', 'retry-after': '5' } });

    const v = exportHash(m, target.kind, src.allToTemplate);
    const current = new URL(req.url).searchParams.get('v') === v;
    const ext = image.type === 'image/jpeg' ? 'jpg' : 'png';
    return new Response(new Uint8Array(image.body), {
      headers: {
        'content-type': image.type,
        'content-length': String(image.body.byteLength),
        'content-disposition': `inline; filename="victor-picks-${week}-${imageName(target)}.${ext}"`,
        'cache-control': current && !image.degraded ? 'private, max-age=31536000, immutable' : NO_STORE,
        'x-export-v': v,
        'x-robots-tag': 'noindex',
        'x-content-type-options': 'nosniff',
      },
    });
  } catch (e) {
    console.error(`[digest/image] ${week} ${name} failed: ${describeError(e)}`);
    return deny(500);
  }
}
