import type { Category, Locale } from '@/lib/taxonomy';
import { categoryLight, dark, light, type Oklch, toHex } from '@/lib/tokens';

// Email tokens are hex, derived from the site's OKLCH tokens (src/lib/tokens.ts) so the two never
// drift: Outlook, QQ and 163 understand no colour functions and no CSS variables. Everything the
// layout needs is inlined; the <style> block below is progressive enhancement for dark mode only.

const mix = (a: Oklch, b: Oklch, t: number): Oklch => [a[0] * t + b[0] * (1 - t), a[1] * t + b[1] * (1 - t), b[2]];

export const C = {
  paper: toHex(light.paper),
  ink: toHex(light.ink),
  muted: toHex(light.muted),
  rule: toHex(light.rule),
  seal: toHex(light.seal),
  sealText: toHex(light.sealText),
  /** Price / access chips: 12% ink over paper (precomputed, no color-mix in mail). */
  chip: toHex(mix(light.ink, light.paper, 0.12)),
} as const;

export const D = {
  paper: toHex(dark.paper),
  ink: toHex(dark.ink),
  muted: toHex(dark.muted),
  rule: toHex(dark.rule),
  seal: toHex(dark.seal),
  chip: toHex(mix(dark.ink, dark.paper, 0.12)),
} as const;

/** Solid category colour for the section rule (readable on both light and dark paper). */
export const categoryHex = (c: Category) => toHex(categoryLight[c]);

// Font stacks (guide「邮件」/ PRD §9b): no web fonts. Multi-word family names are left unquoted
// (valid CSS) so React does not escape quotes into &quot; on every element, which matters at
// 90 KB. zh body 16 px / 1.7 with 12 px paragraph spacing, en 16 px / 1.5; only titles are serif.
const SANS = '-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif';
export const FONT: Record<Locale, { body: string; title: string; lineHeight: number; gap: string }> = {
  zh: { body: 'PingFang SC,Microsoft YaHei,Noto Sans CJK SC,sans-serif', title: 'Songti SC,SimSun,serif', lineHeight: 1.7, gap: '12px' },
  en: { body: SANS, title: 'Georgia,serif', lineHeight: 1.5, gap: '12px' },
};

// Dark mode. Two blocks so that a client which rejects one (Gmail drops a whole <style> when it
// meets a selector it doesn't parse) still keeps the other. Gmail ignores prefers-color-scheme
// anyway; Apple Mail / iOS / Outlook for Mac use the media query; Outlook.com marks the elements
// it recolours with data-ogsc (text) / data-ogsb (background). Well under Gmail's 16 KB cap.
export const DARK_CSS = `@media (prefers-color-scheme:dark){.bg{background-color:${D.paper}!important}.fg{color:${D.ink}!important}.mut{color:${D.muted}!important}.btn{background-color:${D.ink}!important;color:${D.paper}!important}.chip{background-color:${D.chip}!important;color:${D.ink}!important}.note{border-left-color:${D.seal}!important}.rule{border-color:${D.rule}!important}}`;
export const OUTLOOK_DARK_CSS = `:root{color-scheme:light dark;supported-color-schemes:light dark}[data-ogsb] .bg{background-color:${D.paper}!important}[data-ogsc] .fg{color:${D.ink}!important}[data-ogsc] .mut{color:${D.muted}!important}[data-ogsb] .btn{background-color:${D.ink}!important}[data-ogsc] .btn{color:${D.paper}!important}`;
