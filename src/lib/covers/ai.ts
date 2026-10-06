import 'server-only';
import { eq } from 'drizzle-orm';
import { APICallError, generateImage, type ImageModel, NoImageGeneratedError, RetryError } from 'ai';
import sharp from 'sharp';
import { db as defaultDb, type DB } from '../db';
import { events } from '../db/schema';
import { aiConfigured } from '../ingest/extract';
import { LIMITS, limit } from '../ratelimit';
import { isCategory, type Category } from '../taxonomy';
import { blobConfigured, blobStore, isBlobUrl, type Store } from './blob';
import { capReached, CoverSourceError, noBlob } from './errors';

// Cover selector source 5 (guide「封面图获取」): an abstract cover from AI Gateway. The prompt is
// built from the category alone (never the title, host or any page text: no prompt injection,
// no brand names or lettering leaking into the picture). A tap makes a preview stored at
// uploads/ai-<eventId>-<ts>.png; "Use this" turns it into the cover (chain.ts
// coverFromAiCandidate). Earlier previews are deleted on the next generate and on apply.

export const COVER_AI_MODELS = { fast: 'recraft/recraft-v4.1-flash', fine: 'bfl/flux-pro-1.1' } as const;
export type AiTier = keyof typeof COVER_AI_MODELS;
export const AI_TIERS = Object.keys(COVER_AI_MODELS) as AiTier[];
/** Own keys only: `in` would also accept 'constructor', 'toString', '__proto__' from Object.prototype. */
export const isAiTier = (v: unknown): v is AiTier => typeof v === 'string' && Object.hasOwn(COVER_AI_MODELS, v);
/** Readable model names for the stored credit. */
export const AI_MODEL_LABEL: Record<AiTier, string> = { fast: 'Recraft V4.1 Flash', fine: 'FLUX1.1 [pro]' };
export const aiCredit = (tier: AiTier) => `AI-generated cover (${AI_MODEL_LABEL[tier]})`;

const TIMEOUT_MS = 45_000;

// Category motifs and colours. Hues follow the category tokens (taxonomy.ts); red stays out because
// the seal's 32° red belongs to the going system.
const MOTIF: Record<Category, string> = {
  ai: 'a lattice of connected network nodes',
  hackathon: 'stacked building blocks at playful angles',
  vc: 'rising layered curves',
  campus: 'repeating arches',
  conference: 'concentric rings',
  cycling: 'flowing road contours and two wheels as plain circles',
  social: 'overlapping translucent discs',
};
const HUE: Record<Category, string> = {
  ai: 'indigo and violet',
  hackathon: 'mustard and olive',
  vc: 'leaf green',
  campus: 'amber and ochre',
  conference: 'cobalt blue',
  cycling: 'teal',
  social: 'magenta and rose',
};
// One style variant per tap, so "Try again" gives a visibly different take.
const STYLE = [
  'flat geometric shapes with soft paper grain',
  'cut-paper collage layers with gentle shadows',
  'risograph print texture with slight misregistration',
  'smooth gradients and crisp vector edges',
];

/** The full prompt. Takes only the category (and a style index): nothing typed by anyone reaches it. */
export function coverPrompt(category: Category, variant = 0): string {
  const style = STYLE[((variant % STYLE.length) + STYLE.length) % STYLE.length];
  return (
    `Abstract editorial cover art, ${style}, ${MOTIF[category]}. ` +
    `Palette: ${HUE[category]} tones on warm off-white, one accent. ` +
    'Square, centred focal form, generous negative space. ' +
    'No text, letters, numbers, logos, brand marks, people, faces, hands, UI screenshots, or red seal stamps.'
  );
}

/** Map anything generateImage throws to the editor's bilingual message. */
export function aiError(e: unknown): CoverSourceError {
  if (e instanceof CoverSourceError) return e;
  const err: unknown = RetryError.isInstance(e) ? e.lastError : e;
  if (NoImageGeneratedError.isInstance(err)) return new CoverSourceError('no_image', 'No image came back; try again · 没有生成图片，再试一次');
  const o = (err ?? {}) as { name?: string; statusCode?: number; message?: string; type?: string };
  if (o.name === 'TimeoutError' || o.name === 'AbortError') {
    return new CoverSourceError('timeout', 'AI took too long; try again · 生成超时，再试一次');
  }
  const status = APICallError.isInstance(err) ? err.statusCode : typeof o.statusCode === 'number' ? o.statusCode : undefined;
  const text = `${o.message ?? ''} ${o.type ?? ''}`;
  if (status === 401 || status === 402 || status === 403 || /credit|insufficient|free.?tier|billing|payment|top.?up/i.test(text)) {
    return new CoverSourceError('credits', 'AI Gateway needs credits (checklist 8) · AI Gateway 需要先充值（checklist 8）', status);
  }
  if (status === 429) return new CoverSourceError('busy', 'AI is busy; try again in a minute · AI 繁忙，过一会再试', status);
  return new CoverSourceError('failed', 'AI generation failed; try again · 生成失败，再试一次', status);
}

export type AiDeps = {
  db?: DB;
  store?: Store | null;
  /** Replaces the Gateway model (tests). */
  model?: ImageModel;
  /** Lists Blob URLs under a path prefix (tests replace it). */
  listBlobs?: (prefix: string) => Promise<string[]>;
  now?: () => number;
};

const listDefault = async (prefix: string) => {
  const { list } = await import('@vercel/blob');
  const urls: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await list({ prefix, cursor, limit: 100 });
    urls.push(...page.blobs.map((b) => b.url));
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor && urls.length < 500);
  return urls;
};

export const aiCandidatePrefix = (eventId: string) => `uploads/ai-${eventId}-`;

/** True for a preview made for this event (a Blob file under its uploads/ai- prefix). */
export function isAiCandidate(eventId: string, url: string) {
  if (!isBlobUrl(url)) return false;
  try {
    return new URL(url).pathname.startsWith(`/${aiCandidatePrefix(eventId)}`);
  } catch {
    return false;
  }
}

/** Delete this event's AI previews (all of them, or all but `keep`). Never throws. */
export async function sweepAiCandidates(eventId: string, store: Store, deps: Pick<AiDeps, 'listBlobs'> = {}, keep?: string) {
  try {
    const urls = (await (deps.listBlobs ?? listDefault)(aiCandidatePrefix(eventId))).filter((u) => u !== keep && isAiCandidate(eventId, u));
    if (urls.length) await store.del(urls);
  } catch (e) {
    console.warn('[covers] ai preview cleanup failed', e instanceof Error ? e.name : 'error');
  }
}

/**
 * One AI preview for the event's category. Spends one of today's 20 before calling the model (a
 * failed call may still be billed). Returns the preview's Blob URL and today's remaining count.
 */
export async function generateAiCandidate(eventId: string, tier: AiTier, deps: AiDeps = {}) {
  if (!isAiTier(tier)) throw new CoverSourceError('bad_input', 'Unknown model · 未知模型');
  if (!deps.model && !aiConfigured()) {
    throw new CoverSourceError('not_configured', "AI Gateway isn't set up yet (checklist 8) · AI 还没配置（checklist 8）");
  }
  const store = deps.store === undefined ? (blobConfigured() ? blobStore : null) : deps.store;
  if (!store) throw noBlob();
  const db = deps.db ?? defaultDb;
  const [ev] = await db.select({ category: events.category }).from(events).where(eq(events.id, eventId));
  if (!ev) throw new CoverSourceError('bad_input', 'Event not found · 找不到这个活动');
  if (!isCategory(ev.category)) throw new CoverSourceError('no_category', 'Pick a category first · 先选类别');

  const budget = await limit('coverAi', 'global');
  if (!budget.success) throw capReached(LIMITS.coverAi.max);

  const now = (deps.now ?? Date.now)();
  const variant = Math.floor(Math.random() * 1_000_000);
  let png: Buffer;
  try {
    const { image } = await generateImage({
      model: deps.model ?? COVER_AI_MODELS[tier],
      prompt: coverPrompt(ev.category, variant),
      size: '1024x1024',
      seed: variant,
      maxRetries: 1,
      abortSignal: AbortSignal.timeout(TIMEOUT_MS),
    });
    // Re-encode: checks it decodes, strips provider metadata, and makes the .png name true.
    png = await sharp(Buffer.from(image.uint8Array), { animated: false }).png().toBuffer();
  } catch (e) {
    const err = aiError(e);
    console.warn('[covers] ai generate failed', err.code, err.status ?? '');
    throw err;
  }
  await sweepAiCandidates(eventId, store, deps);
  const url = await store.put(`${aiCandidatePrefix(eventId)}${now}.png`, png, 'image/png');
  return { url, tier, remaining: budget.remaining };
}
