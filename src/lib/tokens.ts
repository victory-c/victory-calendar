// Design tokens (PRD §9b, guide「设计系统 · Token」). globals.css mirrors these values;
// tests/tokens.test.ts checks contrast and that the CSS stays in sync.
import { CATEGORIES, type Category } from './taxonomy';

export type Oklch = readonly [l: number, c: number, h: number];
export const css = ([l, c, h]: Oklch) => `oklch(${l} ${c} ${h})`;

export const light = {
  paper: [0.985, 0.004, 250],
  ink: [0.21, 0.02, 260],
  muted: [0.55, 0.01, 260],
  rule: [0.9, 0.01, 250],
  seal: [0.63, 0.19, 32],
  sealText: [0.48, 0.19, 32],
} as const satisfies Record<string, Oklch>;

export const dark = {
  paper: [0.16, 0.01, 260],
  ink: [0.92, 0.008, 90],
  muted: [0.68, 0.01, 260],
  rule: [0.28, 0.01, 260],
  seal: [0.72, 0.17, 32],
  sealText: [0.8, 0.14, 32],
} as const satisfies Record<string, Oklch>;

/** Solid category colours: L 0.55–0.62, C 0.12–0.15 (light); same hue lifted for dark. */
export const categoryLight: Record<Category, Oklch> = {
  ai: [0.55, 0.15, CATEGORIES.ai.hue],
  hackathon: [0.62, 0.13, CATEGORIES.hackathon.hue],
  vc: [0.58, 0.13, CATEGORIES.vc.hue],
  campus: [0.62, 0.14, CATEGORIES.campus.hue],
  conference: [0.55, 0.12, CATEGORIES.conference.hue],
  cycling: [0.58, 0.12, CATEGORIES.cycling.hue],
  social: [0.58, 0.14, CATEGORIES.social.hue],
};

export const categoryDark: Record<Category, Oklch> = {
  ai: [0.72, 0.13, CATEGORIES.ai.hue],
  hackathon: [0.78, 0.12, CATEGORIES.hackathon.hue],
  vc: [0.74, 0.12, CATEGORIES.vc.hue],
  campus: [0.76, 0.12, CATEGORIES.campus.hue],
  conference: [0.72, 0.1, CATEGORIES.conference.hue],
  cycling: [0.74, 0.1, CATEGORIES.cycling.hue],
  social: [0.74, 0.12, CATEGORIES.social.hue],
};

// --- colour math (OKLCH → linear sRGB → WCAG relative luminance) ---
export function oklchToLinearSrgb([l, c, h]: Oklch): [number, number, number] {
  const a = c * Math.cos((h * Math.PI) / 180);
  const b = c * Math.sin((h * Math.PI) / 180);
  const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const clamp = (x: number) => Math.min(1, Math.max(0, x));
  return [
    clamp(4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_),
    clamp(-1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_),
    clamp(-0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_),
  ];
}

export function luminance(c: Oklch) {
  const [r, g, b] = oklchToLinearSrgb(c);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a: Oklch, b: Oklch) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** sRGB hex, used where CSS colour functions aren't available (emails, next/og). */
export function toHex(c: Oklch) {
  const enc = (x: number) => (x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055);
  return `#${oklchToLinearSrgb(c)
    .map((x) => Math.round(enc(x) * 255).toString(16).padStart(2, '0'))
    .join('')}`;
}
