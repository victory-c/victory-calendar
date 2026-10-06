import { load } from 'cheerio';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

// M4 F11 UI, server-rendered: the cover tab's search / generate sources (the three sections, the
// "not set up" states CI sees with no keys or Blob, the live status lines with today's counts), and
// the credit line under a picked cover on the event page, through next-intl's real formatter.

vi.mock('@/app/admin/actions', () => {
  const never = async () => ({ ok: false, message: 'not in tests' });
  return {
    searchOpenverseCovers: never, searchBraveCovers: never, pickOpenverseCover: never, pickBraveCover: never,
    generateAiCover: never, applyAiCover: never,
  };
});
const { Confirm, CoverSources, nextFocus, ThumbGrid } = await import('@/components/admin/CoverSources');
type CoverSourcesProps = import('@/components/admin/CoverSources').CoverSourcesProps;

const base: CoverSourcesProps = {
  id: 'evt_1', hasCategory: true, blobReady: true, aiReady: true, braveReady: true,
  openverseQuery: 'road cycling', braveQuery: 'Agent Night', remaining: { openverse: 100, brave: 30, ai: 20 },
};
const render = (over: Partial<CoverSourcesProps> = {}) => load(renderToStaticMarkup(createElement(CoverSources, { ...base, ...over })));

describe('CoverSources', () => {
  it('three collapsible sections, each with a 44 px summary', () => {
    const $ = render();
    expect($('details > summary').map((_, s) => $(s).text().replace('›', '').trim()).get()).toEqual([
      'Openverse · 开放许可图库', 'AI abstract · AI 抽象封面 ($0.007)', 'Web search · 网络搜索 (Brave)',
    ]);
    expect($('details > summary').get().every((s) => $(s).attr('class')!.includes('min-h-11'))).toBe(true);
  });

  it('prefills the searches and announces what is left today', () => {
    const $ = render();
    expect($('#ov-q').attr('value')).toBe('road cycling');
    expect($('#brave-q').attr('value')).toBe('Agent Night');
    const live = $('[role=status][aria-live=polite]').map((_, s) => $(s).text()).get();
    expect(live).toEqual(['100 left today · 今天还剩 100 次', '20 left today · 今天还剩 20 次', '30 left today · 今天还剩 30 次']);
    const ai = $('details').eq(1).find('button').map((_, b) => [[$(b).text(), $(b).attr('disabled') !== undefined]]).get();
    expect(ai).toEqual([['Generate · 生成 $0.007', false], ['Finer · 精细版 $0.04', false]]);
  });

  it('not set up (as in CI): no Brave key, no AI Gateway, no Blob', () => {
    const $ = render({ braveReady: false, aiReady: false, blobReady: false, remaining: { openverse: null, brave: null, ai: null } });
    const brave = $('details').eq(2);
    expect(brave.text()).toContain('Needs a Brave Search API key · 需要 Brave 搜索 API 密钥');
    expect(brave.find('input, button')).toHaveLength(0);
    const ai = $('details').eq(1);
    expect(ai.text()).toContain("AI Gateway isn't set up yet (checklist 8) · AI 还没配置（checklist 8）");
    expect(ai.find('button').get().every((b) => $(b).attr('disabled') !== undefined)).toBe(true);
    expect($.text()).not.toContain('left today');
  });

  it('AI needs Blob and a category, and stops at zero left', () => {
    expect(render({ blobReady: false })('details').eq(1).text()).toContain('checklist 2');
    const noCat = render({ hasCategory: false })('details').eq(1);
    expect(noCat.text()).toContain('Pick a category first');
    expect(noCat.find('button[disabled]')).toHaveLength(2);
    expect(render({ remaining: { ...base.remaining, ai: 0 } })('details').eq(1).find('button[disabled]')).toHaveLength(2);
  });
});

describe('CoverSources focus and faded tiles', () => {
  const hit = (id: string, usable = true) => ({ id, thumbUrl: `https://cdn.example.org/${id}.jpg`, title: `Photo ${id}`, usable });
  const FADED = { id: 'ov-faded', text: 'Faded: too small, SVG or over 15 MB · 变淡的图太小、是 SVG 或超过 15 MB' };
  const grid = (hits: ReturnType<typeof hit>[], faded: typeof FADED | undefined = FADED) =>
    load(renderToStaticMarkup(createElement(ThumbGrid<ReturnType<typeof hit>>, { hits, selected: null, onSelect: () => {}, usable: (h) => h.usable, faded })));

  it('every status line can take focus (a used or cancelled pick removes the pressed button)', () => {
    const $ = render();
    expect($('[role=status]').map((_, p) => $(p).attr('tabindex')).get()).toEqual(['-1', '-1', '-1']);
  });

  it('the confirm step takes focus on "Use this", or on Cancel while "Use this" is disabled', () => {
    const confirm = (disabled: boolean) =>
      load(renderToStaticMarkup(<Confirm onUse={() => {}} onCancel={() => {}} disabled={disabled}>x</Confirm>))('button')
        .map((_, b) => [[load(b).text(), b.attribs.autofocus !== undefined]]).get();
    expect(confirm(false)).toEqual([['Use this · 用这张', true], ['Cancel · 取消', false]]);
    expect(confirm(true)).toEqual([['Use this · 用这张', false], ['Cancel · 取消', true]]);
  });

  it('faded tiles: a visible line says why, and the disabled tiles point at it; tiles carry their hit id', () => {
    const $ = grid([hit('a'), hit('b', false), hit('c')]);
    const note = $('#ov-faded');
    expect(note.text()).toBe(FADED.text);
    expect(note.is('p')).toBe(true);
    expect($('button').map((_, b) => [[b.attribs['data-hit'], b.attribs.disabled !== undefined, b.attribs['aria-describedby'] ?? null]]).get()).toEqual([
      ['a', false, null], ['b', true, 'ov-faded'], ['c', false, null],
    ]);
    // Nothing faded, nothing to explain.
    expect(grid([hit('a'), hit('c')])('#ov-faded')).toHaveLength(0);
    expect(grid([hit('a')])('button').attr('aria-describedby')).toBeUndefined();
  });

  it('focus goes back to the first candidate still on the page and enabled', () => {
    const el = (isConnected: boolean, disabled?: boolean) => ({ isConnected, disabled }) as unknown as HTMLElement;
    const pressed = el(false);
    const thumb = el(true);
    const status = el(true);
    expect(nextFocus([pressed, thumb, status])).toBe(thumb);
    expect(nextFocus([el(true, true), null, status])).toBe(status);
    expect(nextFocus([null, undefined])).toBeNull();
  });
});

describe('CoverSourceCredit (event page)', async () => {
  const { createTranslator } = await import('next-intl');
  const { CoverSourceCredit } = await import('@/components/CoverSourceCredit');
  const messages = { en: (await import('../messages/en.json')).default, zh: (await import('../messages/zh.json')).default };
  const credit = (locale: 'en' | 'zh', cover: Parameters<typeof CoverSourceCredit>[0]['cover']) => {
    const t = createTranslator({ locale, messages: messages[locale], namespace: 'Event', onError: (e) => { throw e; } });
    return load(renderToStaticMarkup(createElement(CoverSourceCredit, { cover, t: t as never })));
  };
  const ov = {
    kind: 'openverse' as const, attribution: '"Bridge" by A. Person · CC BY-SA 2.0 · cropped', license: 'by-sa/2.0',
    sourcePageUrl: 'https://www.flickr.example/photos/a/1',
  };

  it('Openverse: work linked to its page, licence linked to the deed, and the crop note', () => {
    const $ = credit('en', ov);
    expect($('p').text()).toBe('Cover: "Bridge" by A. Person · CC BY-SA 2.0 · cropped');
    expect($('a').map((_, a) => [[$(a).text(), $(a).attr('href'), $(a).attr('rel')]]).get()).toEqual([
      ['"Bridge" by A. Person', 'https://www.flickr.example/photos/a/1', 'noopener noreferrer'],
      ['CC BY-SA 2.0', 'https://creativecommons.org/licenses/by-sa/2.0/', 'license noopener noreferrer'],
    ]);
    expect(credit('zh', { ...ov, attribution: '"Bridge" by A. Person · CC BY-SA 2.0 · padded to square' })('p').text()).toBe(
      '封面："Bridge" by A. Person · CC BY-SA 2.0 · 已补边成方形',
    );
    // A credit that can't be split is still shown as stored.
    expect(credit('en', { ...ov, attribution: 'Hand-written credit', license: null })('p').text()).toBe('Hand-written credit');
  });

  it('Brave: "Image via host", linked; AI: says so; other kinds: nothing', () => {
    const brave = { kind: 'brave' as const, attribution: 'Image via host.example', license: null, sourcePageUrl: 'https://www.host.example/e/1' };
    const $ = credit('en', brave);
    expect($('p').text()).toBe('Image via host.example');
    expect($('a').attr('href')).toBe('https://www.host.example/e/1');
    expect(credit('zh', brave)('p').text()).toBe('图片来自 host.example');
    const ai = { kind: 'ai' as const, attribution: 'AI-generated cover (Recraft V4.1 Flash)', license: null, sourcePageUrl: null };
    expect(credit('en', ai)('p').text()).toBe('AI-generated cover');
    expect(credit('zh', ai)('p').text()).toBe('AI 生成封面');
    expect(credit('en', { ...ai, kind: 'upload' }).html()).not.toContain('<p');
  });
});
