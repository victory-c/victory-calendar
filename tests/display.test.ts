import { describe, expect, it } from 'vitest';
import { note, normTitle, titles } from '@/lib/events/display';

describe('titles', () => {
  it('hides the second line when both languages normalise to the same name', () => {
    expect(titles({ titleEn: 'AI Tinkerers SF', titleZh: 'AI Tinkerers · SF' }, 'zh').secondary).toBeNull();
    expect(normTitle('Founders Coffee Rave!')).toBe(normTitle('founders coffee rave'));
  });
  it('shows the other language in grey when it differs', () => {
    const t = titles({ titleEn: 'Weekend Agent Hackathon', titleZh: '周末 Agent 黑客松' }, 'en');
    expect(t).toMatchObject({ primary: 'Weekend Agent Hackathon', secondary: '周末 Agent 黑客松', secondaryLang: 'zh-Hans' });
  });

  it('primaryLang: the field the title came from when the two differ', () => {
    const both = { titleEn: 'Weekend Agent Hackathon', titleZh: '周末 Agent 黑客松' };
    expect(titles(both, 'en').primaryLang).toBe('en');
    expect(titles(both, 'zh').primaryLang).toBe('zh-Hans');
    // One language left empty: the other one shows, tagged with its own language.
    expect(titles({ titleEn: '', titleZh: '只有中文' }, 'en')).toMatchObject({ primary: '只有中文', primaryLang: 'zh-Hans' });
    expect(titles({ titleEn: 'Only English', titleZh: '' }, 'zh')).toMatchObject({ primary: 'Only English', primaryLang: 'en' });
  });

  it('primaryLang: identical titles (public-rows fills a missing one with the other) are read from the text', () => {
    // The production shape of a Chinese-only event in an English page or email, and the reverse.
    expect(titles({ titleEn: '只有中文的活动', titleZh: '只有中文的活动' }, 'en')).toMatchObject({ primary: '只有中文的活动', primaryLang: 'zh-Hans', secondary: null });
    expect(titles({ titleEn: 'Evals in Practice', titleZh: 'Evals in Practice' }, 'zh')).toMatchObject({ primary: 'Evals in Practice', primaryLang: 'en', secondary: null });
    expect(titles({ titleEn: 'Evals in Practice', titleZh: 'Evals in Practice' }, 'en').primaryLang).toBe('en');
    expect(titles({ titleEn: 'AI 黑客松', titleZh: 'AI 黑客松' }, 'zh').primaryLang).toBe('zh-Hans');
    expect(titles({ titleEn: '', titleZh: '' }, 'zh').primaryLang).toBe('en');
  });
});

describe('note', () => {
  it('falls back to the other language and tags it', () => {
    expect(note({ noteEn: null, noteZh: '值得去' }, 'en')).toEqual({ text: '值得去', lang: 'zh-Hans' });
    expect(note({ noteEn: null, noteZh: null }, 'en')).toBeNull();
  });
});
