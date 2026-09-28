import { describe, expect, it } from 'vitest';
import { preferredLocale, safeReturnPath, switchHref, topLanguage } from '@/lib/locale-detect';

describe('preferredLocale', () => {
  it('cookie wins over the header', () => {
    expect(preferredLocale('zh-CN,zh;q=0.9', 'en')).toBe('en');
    expect(preferredLocale('en-US', 'zh')).toBe('zh');
  });
  it('any zh* first choice means Chinese, including Traditional with an English fallback', () => {
    for (const h of ['zh-CN,zh;q=0.9,en;q=0.8', 'zh-TW,en-US;q=0.9,en;q=0.8', 'zh-HK,en;q=0.5', 'zh-Hant-TW,en;q=0.9', 'zh', 'zh-Hans'])
      expect(preferredLocale(h, undefined), h).toBe('zh');
  });
  it('everything else is English', () => {
    for (const h of ['en-US,en;q=0.9,zh;q=0.8', 'fr-FR,zh;q=0.5', '*', '', null, 'zhx-foo', 'en;q=0.1,zh;q=0'])
      expect(preferredLocale(h, undefined), String(h)).toBe('en');
  });
  it('respects q ordering, not header order', () => {
    expect(topLanguage('en;q=0.5,zh-TW;q=0.9')).toBe('zh-tw');
    expect(preferredLocale('en;q=0.5,zh-TW;q=0.9', undefined)).toBe('zh');
  });
  it('ignores garbage cookies', () => {
    expect(preferredLocale('zh-CN', 'fr')).toBe('zh');
  });
});

describe('language switch links', () => {
  it('keep path and query', () => {
    expect(switchHref('zh', '/events/x', 'c=ai')).toBe('/_locale?l=zh&to=%2Fzh%2Fevents%2Fx%3Fc%3Dai');
    expect(switchHref('en', '/', '')).toBe('/_locale?l=en&to=%2F');
    expect(switchHref('zh', '/')).toBe('/_locale?l=zh&to=%2Fzh');
    expect(switchHref('en', '/', 'c=ai')).toBe('/_locale?l=en&to=%2F%3Fc%3Dai');
    expect(switchHref('zh', '/', 'c=ai')).toBe('/_locale?l=zh&to=%2Fzh%3Fc%3Dai');
  });
  it('only redirect to same-origin paths', () => {
    const o = 'https://picks.example.com';
    expect(safeReturnPath('/zh/events/x?c=ai', o)).toBe('/zh/events/x?c=ai');
    for (const bad of ['//evil.com', 'https://evil.com', '/\\evil.com', 'javascript:alert(1)', null, ''])
      expect(safeReturnPath(bad, o), String(bad)).toBe('/');
  });
});
