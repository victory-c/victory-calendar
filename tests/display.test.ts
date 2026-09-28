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
});

describe('note', () => {
  it('falls back to the other language and tags it', () => {
    expect(note({ noteEn: null, noteZh: '值得去' }, 'en')).toEqual({ text: '值得去', lang: 'zh-Hans' });
    expect(note({ noteEn: null, noteZh: null }, 'en')).toBeNull();
  });
});
