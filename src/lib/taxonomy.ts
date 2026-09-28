// Fixed vocabulary (PRD §7). Labels here are the single source for UI chips,
// ICS CATEGORIES, digest section titles and template-cover glyphs.

export const CATEGORY_SLUGS = ['ai', 'hackathon', 'vc', 'campus', 'conference', 'cycling', 'social'] as const;
export type Category = (typeof CATEGORY_SLUGS)[number];

export type Locale = 'en' | 'zh';

type CategoryMeta = {
  en: string;
  zh: string;
  /** OKLCH hue; must stay ≥30° away from the seal hue (32°). */
  hue: number;
  /** Template-cover glyph (PRD §5b step 3). */
  glyph: string;
};

export const CATEGORIES: Record<Category, CategoryMeta> = {
  ai: { en: 'AI & Tech', zh: 'AI 与技术', hue: 275, glyph: 'AI' },
  hackathon: { en: 'Hackathons', zh: '黑客松', hue: 95, glyph: '黑' },
  vc: { en: 'VC & Founders', zh: '创投与创业者', hue: 145, glyph: '投' },
  campus: { en: 'Campus & Student Startup', zh: '校园创业', hue: 65, glyph: '校' },
  conference: { en: 'Conferences & Tech Weeks', zh: '大会与主题周', hue: 235, glyph: '会' },
  cycling: { en: 'Cycling', zh: '骑行活动', hue: 190, glyph: '骑' },
  social: { en: 'Social & Fun', zh: '社交与玩乐', hue: 330, glyph: '聚' },
};

export const SEAL_HUE = 32;

export function isCategory(v: unknown): v is Category {
  return typeof v === 'string' && (CATEGORY_SLUGS as readonly string[]).includes(v);
}

/** Parse `?c=ai,hackathon` — unknown slugs are dropped, order normalised. */
export function parseCategories(raw: string | null | undefined): Category[] {
  if (!raw) return [];
  const set = new Set(raw.split(',').map((s) => s.trim()).filter(isCategory));
  return CATEGORY_SLUGS.filter((c) => set.has(c));
}

export const GOING_LABELS = {
  interested: { en: 'Interested', zh: '想去' },
  going: { en: 'GOING', zh: '会去' },
  hosting: { en: 'HOST', zh: '主办' },
  speaking: { en: 'TALK', zh: '分享' },
  went: { en: 'WENT', zh: '去过' },
} as const;
