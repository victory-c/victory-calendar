import 'server-only';

// Fonts for next/og (Satori needs ttf/otf, not woff2). Guide「存储与尺寸」: glyphs are subset
// per text through the Google Fonts `text=` parameter (8 CJK glyphs ≈ 2.5 KB), which keeps the
// function well under Satori's 500 KB bundle limit. Only fixed Google hosts are contacted.

type Weight = 400 | 500 | 600 | 700;
export type OgFont = { name: string; data: ArrayBuffer; weight: Weight; style: 'normal' | 'italic' };

const cache = new Map<string, Promise<ArrayBuffer | null>>();

async function load(family: string, axis: string, text: string): Promise<ArrayBuffer | null> {
  const chars = [...new Set(text)].sort().join('');
  if (!chars.trim()) return null;
  const url = `https://fonts.googleapis.com/css2?family=${family.replace(/ /g, '+')}:${axis}&text=${encodeURIComponent(chars)}`;
  let p = cache.get(url);
  if (!p) {
    p = (async () => {
      const css = await (await fetch(url, { signal: AbortSignal.timeout(5000) })).text();
      const src = css.match(/src: url\((https:\/\/fonts\.gstatic\.com\/[^)]+)\) format\('(?:opentype|truetype)'\)/)?.[1];
      if (!src) return null;
      const res = await fetch(src, { signal: AbortSignal.timeout(5000) });
      return res.ok ? res.arrayBuffer() : null;
    })().catch(() => null);
    cache.set(url, p);
    if (cache.size > 500) cache.delete(cache.keys().next().value!);
  }
  return p;
}

const CJK = /[⺀-鿿豈-﫿　-〿＀-￯]/g;

/**
 * Everything a card needs: Fraunces (Latin display), Noto Serif SC (CJK display),
 * Geist Mono (dates, host line). Missing fonts are skipped; Satori then falls back.
 */
export async function ogFonts(parts: { display?: string; mono?: string }): Promise<OgFont[]> {
  const display = parts.display ?? '';
  const mono = parts.mono ?? '';
  const latinDisplay = display.replace(CJK, '');
  const cjk = (display + mono).match(CJK)?.join('') ?? '';
  const [fraunces, noto, geistMono] = await Promise.all([
    load('Fraunces', 'opsz,wght@144,600', latinDisplay),
    load('Noto Serif SC', 'wght@600', cjk),
    load('Geist Mono', 'wght@500', mono.replace(CJK, '') + '0123456789:–·- '),
  ]);
  const fonts: OgFont[] = [];
  if (fraunces) fonts.push({ name: 'Fraunces', data: fraunces, weight: 600, style: 'normal' });
  if (noto) fonts.push({ name: 'Noto Serif SC', data: noto, weight: 600, style: 'normal' });
  if (geistMono) fonts.push({ name: 'Geist Mono', data: geistMono, weight: 500, style: 'normal' });
  return fonts;
}

// ---- long text (F17: WeChat long image, Xiaohongshu pages) ----------------------------------------
//
// A week's images print hundreds of distinct characters. Google Fonts silently answers a `text=`
// past about 800 characters with the whole font (10.5 MB for Noto Sans SC 400), so each family is
// requested in chunks of at most TEXT_CHUNK characters, each chunk registered as its own font
// ("Noto Sans SC 1", "Noto Sans SC 2", …) and listed in order in the font-family; any file over
// FONT_MAX_BYTES is refused rather than parsed. Satori picks, per character, the first listed font
// that has it. Unlike ogFonts(), a missing chunk is not skipped: `complete` is false and the caller
// answers with an error instead of an image with blank Chinese. Separate cache, capped in bytes.

export const TEXT_CHUNK = 400;
export const FONT_MAX_BYTES = 2_000_000;
const TEXT_CACHE_BYTES = 32_000_000;
const TEXT_TIMEOUT_MS = 8000;

type Spec = { family: string; axis: string; weight: Weight };
const SERIF: Spec = { family: 'Noto Serif SC', axis: 'wght@600', weight: 600 };
const SANS: Spec = { family: 'Noto Sans SC', axis: 'wght@400', weight: 400 };
const MONO: Spec = { family: 'Geist Mono', axis: 'wght@500', weight: 500 };

/** Distinct characters of `text` (no line breaks or tabs), sorted, in chunks of at most `size`. */
export function chunkChars(text: string, size = TEXT_CHUNK): string[] {
  const chars = [...new Set(text)].filter((c) => !/[\r\n\t\f\v]/.test(c)).sort();
  const out: string[] = [];
  for (let i = 0; i < chars.length; i += size) out.push(chars.slice(i, i + size).join(''));
  return out;
}

type Entry = { p: Promise<ArrayBuffer | null>; bytes: number };
const textCache = new Map<string, Entry>();
let textCacheBytes = 0;

/** Body bytes, or null past `max` (stops reading there). */
async function readCapped(res: Response, max: number): Promise<ArrayBuffer | null> {
  const declared = Number(res.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > max) {
    await res.body?.cancel().catch(() => {});
    return null;
  }
  if (!res.body) return null;
  const reader = res.body.getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => {});
      return null;
    }
    parts.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.byteLength;
  }
  return out.buffer;
}

async function fetchChunk(url: string): Promise<ArrayBuffer | null> {
  const res = await fetch(url, { signal: AbortSignal.timeout(TEXT_TIMEOUT_MS) });
  if (!res.ok) return null;
  // One face per request; several (unicode-range slices) would mean Google ignored text=.
  const srcs = [...(await res.text()).matchAll(/src: url\((https:\/\/fonts\.gstatic\.com\/[^)]+)\) format\('(?:opentype|truetype)'\)/g)];
  if (srcs.length !== 1) return null;
  const file = await fetch(srcs[0][1], { signal: AbortSignal.timeout(TEXT_TIMEOUT_MS) });
  if (!file.ok) return null;
  return readCapped(file, FONT_MAX_BYTES);
}

function loadChunk(spec: Spec, chars: string): Promise<ArrayBuffer | null> {
  const url = `https://fonts.googleapis.com/css2?family=${spec.family.replace(/ /g, '+')}:${spec.axis}&text=${encodeURIComponent(chars)}`;
  const hit = textCache.get(url);
  if (hit) {
    textCache.delete(url); // most recently used last
    textCache.set(url, hit);
    return hit.p;
  }
  const entry: Entry = { p: fetchChunk(url).catch(() => null), bytes: 0 };
  textCache.set(url, entry);
  void entry.p.then((data) => {
    if (textCache.get(url) !== entry) return;
    if (!data) {
      textCache.delete(url); // a failure is retried by the next request
      return;
    }
    entry.bytes = data.byteLength;
    textCacheBytes += entry.bytes;
    for (const [key, e] of textCache) {
      if (textCacheBytes <= TEXT_CACHE_BYTES || key === url) break;
      textCache.delete(key);
      textCacheBytes -= e.bytes;
    }
  });
  return entry.p;
}

export type TextFonts = {
  fonts: OgFont[];
  /** False when any chunk could not be loaded: don't render (Chinese would come out blank). */
  complete: boolean;
  /** font-family lists to style with; serif and mono fall back to the sans chunks. */
  family: { serif: string; sans: string; mono: string };
};

/** Characters every long-text image may draw besides its own text: Satori's line-clamp ellipsis. */
const ALWAYS = '…';

/**
 * Fonts for the WeChat long image and Xiaohongshu pages: Noto Serif SC 600 (titles), Noto Sans SC
 * 400 (body), Geist Mono 500 (numbers and the week URL; ASCII only, the rest falls back to sans).
 */
export async function textFonts(parts: { serif: string; sans: string; mono: string }): Promise<TextFonts> {
  const ascii = [...parts.mono].filter((c) => c.codePointAt(0)! < 0x7f).join('');
  const sets = [
    { spec: SERIF, chunks: chunkChars(parts.serif + ALWAYS) },
    { spec: SANS, chunks: chunkChars(parts.sans + ALWAYS) },
    { spec: MONO, chunks: chunkChars(ascii) },
  ];
  const loaded = await Promise.all(sets.map((s) => Promise.all(s.chunks.map((c) => loadChunk(s.spec, c)))));
  const fonts: OgFont[] = [];
  const names = sets.map((s, i) =>
    s.chunks.map((_, j) => {
      const name = `${s.spec.family} ${j + 1}`;
      const data = loaded[i][j];
      if (data) fonts.push({ name, data, weight: s.spec.weight, style: 'normal' });
      return name;
    }),
  );
  const complete = loaded.every((list) => list.every(Boolean));
  if (!complete) console.warn(`[og/fonts] ${loaded.flat().filter((d) => !d).length} of ${loaded.flat().length} font chunks failed`);
  const [serif, sans, mono] = names;
  return {
    fonts,
    complete,
    family: { serif: [...serif, ...sans].join(', '), sans: sans.join(', '), mono: [...mono, ...sans].join(', ') },
  };
}

/** Test hook: forget cached chunks. */
export function _resetTextFonts() {
  textCache.clear();
  textCacheBytes = 0;
}
