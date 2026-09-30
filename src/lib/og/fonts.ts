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
