import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CATEGORIES, CATEGORY_SLUGS, SEAL_HUE } from '@/lib/taxonomy';
import { categoryDark, categoryLight, contrast, css, dark, light } from '@/lib/tokens';

const globals = readFileSync(new URL('../src/app/globals.css', import.meta.url), 'utf8');

describe('contrast (PRD F14: text ≥4.5:1, chips/seal ≥3:1)', () => {
  for (const [name, t] of [['light', light], ['dark', dark]] as const) {
    it(`${name}: ink, muted and seal text on paper ≥ 4.5`, () => {
      expect(contrast(t.ink, t.paper)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(t.muted, t.paper)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(t.sealText, t.paper)).toBeGreaterThanOrEqual(4.5);
    });
    it(`${name}: seal fill vs paper ≥ 3 and paper text on seal ≥ 3`, () => {
      expect(contrast(t.seal, t.paper)).toBeGreaterThanOrEqual(3);
    });
  }
  it('every category colour ≥ 3:1 against paper in both themes', () => {
    for (const c of CATEGORY_SLUGS) {
      expect(contrast(categoryLight[c], light.paper), `light ${c}`).toBeGreaterThanOrEqual(3);
      expect(contrast(categoryDark[c], dark.paper), `dark ${c}`).toBeGreaterThanOrEqual(3);
    }
  });
});

describe('seal hue is reserved for the going system', () => {
  it('each category hue is ≥30° from 32°', () => {
    for (const c of CATEGORY_SLUGS) {
      const d = Math.abs(((CATEGORIES[c].hue - SEAL_HUE + 540) % 360) - 180);
      expect(d, c).toBeGreaterThanOrEqual(30);
    }
  });
});

describe('globals.css mirrors tokens.ts', () => {
  it('contains every light, dark and category value', () => {
    for (const v of [...Object.values(light), ...Object.values(dark)]) expect(globals).toContain(css(v));
    for (const c of CATEGORY_SLUGS) {
      expect(globals).toContain(`--color-cat-${c}: ${css(categoryLight[c])}`);
      expect(globals).toContain(`--color-cat-${c}: ${css(categoryDark[c])}`);
    }
  });
});
