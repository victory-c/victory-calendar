import { load } from 'cheerio';
import { cloneElement, createElement, isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { PublicEvent } from '@/lib/events/types';

// PRD「日期格式」: every time a person reads is on the Pacific clock, whatever zone the event was
// stored in. e.tz only feeds machine output (ICS TZID, JSON-LD offsets, calendar links).
vi.mock('next-intl/server', () => ({
  getTranslations:
    async ({ locale, namespace }: { locale: string; namespace: string }) =>
    (key: string) =>
      `${locale}:${namespace}.${key}`,
}));
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, prefetch: _p, ...rest }: { href: string; children: ReactNode; prefetch?: boolean }) =>
    createElement('a', { href, ...rest }, children),
}));

const { DayList } = await import('@/components/DayList');
const { DateTime } = await import('@/components/DateTime');
const { buildRss } = await import('@/lib/rss');
const { seedEvents } = await import('@/lib/events/seed');

/**
 * Like the helper in newsletter-pages.test.ts: await async components, then render the rest to HTML.
 * Children go back as separate arguments, so React treats them as fixed children, not as a list
 * that needs keys (these lists have more children than that test's pages, so it would warn).
 */
async function resolve(node: ReactNode): Promise<ReactNode> {
  if (Array.isArray(node)) return Promise.all(node.map(resolve));
  if (!isValidElement(node)) return node;
  const el = node as ReactElement<{ children?: ReactNode }>;
  if (typeof el.type === 'function' && el.type.constructor.name === 'AsyncFunction') {
    return resolve(await (el.type as (p: unknown) => Promise<ReactNode>)(el.props));
  }
  if (el.props.children === undefined) return el;
  const children = await resolve(el.props.children);
  return cloneElement(el, undefined, ...(Array.isArray(children) ? children : [children]));
}
const html = async (node: ReactNode) => load(renderToStaticMarkup((await resolve(node)) as ReactElement));

const now = new Date('2026-10-05T12:00:00Z');
const base: PublicEvent = { ...seedEvents(now)[0], cover: null, going: 'none', allDay: false, status: 'published' };

// All three happen on the evening of Wed Oct 7 or the day after, Pacific time (PDT = UTC−7).
const newYork: PublicEvent = {
  ...base,
  id: 'ny',
  slug: 'ny',
  titleEn: 'New York stored',
  startAt: new Date('2026-10-08T01:00:00Z'), // Oct 7 18:00 PT (21:00 in New York)
  endAt: new Date('2026-10-08T03:00:00Z'), //   Oct 7 20:00 PT (23:00 in New York)
  tz: 'America/New_York',
};
const shanghai: PublicEvent = {
  ...base,
  id: 'sh',
  slug: 'sh',
  titleEn: 'Shanghai stored',
  startAt: new Date('2026-10-08T02:00:00Z'), // Oct 7 19:00 PT (Oct 8 10:00 in Shanghai)
  endAt: null,
  tz: 'Asia/Shanghai',
};
const pacific: PublicEvent = {
  ...base,
  id: 'pt',
  slug: 'pt',
  titleEn: 'Pacific stored',
  startAt: new Date('2026-10-08T19:00:00Z'), // Oct 8 12:00 PT
  endAt: null,
  tz: 'America/Los_Angeles',
};
const events = [newYork, shanghai, pacific];

describe('event times are read on the Pacific clock, whatever zone the event is stored in', () => {
  it('the detail page line says the Pacific time next to the PT label', async () => {
    const $ = await html(<DateTime start={newYork.startAt} end={newYork.endAt} allDay={false} locale="en" />);
    expect($('time').text()).toBe('Wed, Oct 7 · 6:00 – 8:00 PM PT');
    expect($('time').attr('datetime')).toBe('2026-10-07T18:00-07:00');
  });

  it('day groups follow the Pacific day, so a date heading never appears twice', async () => {
    const $ = await html(
      <DayList events={events} locale="en" now={now} todayKey="2026-10-05" showAttendance={false} label="Events" />,
    );
    const days = $('section[aria-labelledby]')
      .map((_, s) => ({
        id: $(s).attr('aria-labelledby'),
        heading: $(s).find('h2 time').text(),
        titles: $(s).find('article h3').map((__, h) => $(h).text()).get(),
      }))
      .get();
    expect(days).toEqual([
      { id: 'd-2026-10-07', heading: 'Oct 7', titles: ['New York stored', 'Shanghai stored'] },
      { id: 'd-2026-10-08', heading: 'Oct 8', titles: ['Pacific stored'] },
    ]);
  });

  it('the time column on each card shows the Pacific time', async () => {
    const $ = await html(
      <DayList events={events} locale="zh" now={now} todayKey="2026-10-05" showAttendance={false} label="Events" />,
    );
    const times = $('article time').map((_, t) => $(t).text()).get();
    expect(times).toEqual(['18:00', '19:00', '12:00']);
  });

  it('the RSS description carries the Pacific time', () => {
    const xml = buildRss({ events: [newYork], locale: 'zh', origin: 'https://picks.example.com', now });
    expect(xml).toContain('10月7日周三 18:00–20:00 北美太平洋时间');
    expect(xml).not.toContain('21:00');
  });
});

// All-day events show their day(s) and 全天 / All day, never a midnight clock time.
describe('all-day events show the day, not "12:00 AM"', () => {
  const conference: PublicEvent = {
    ...base,
    id: 'conf',
    slug: 'conf',
    allDay: true,
    startAt: new Date('2026-10-14T07:00:00Z'), // Wed Oct 14 00:00 PT
    endAt: new Date('2026-10-17T07:00:00Z'), //   exclusive: the last day is Fri Oct 16
    tz: 'America/Los_Angeles',
  };
  const oneDay: PublicEvent = { ...conference, id: 'one', slug: 'one', endAt: null };

  it('the detail page line gives the days, with a date-only datetime', async () => {
    const $ = await html(<DateTime start={conference.startAt} end={conference.endAt} allDay locale="en" />);
    expect($('time').text()).toBe('All day · Wed, Oct 14 – Fri, Oct 16');
    expect($('time').attr('datetime')).toBe('2026-10-14');
    const $zh = await html(<DateTime start={oneDay.startAt} end={oneDay.endAt} allDay locale="zh" />);
    expect($zh('time').text()).toBe('10月14日周三 · 全天');
  });

  it('the RSS description gives the days too', () => {
    const xml = buildRss({ events: [conference], locale: 'en', origin: 'https://picks.example.com', now });
    // Only the item's own text: the feed's <lastBuildDate> is a real clock time.
    const item = xml.match(/<item>[\s\S]*?<description>([^<]*)<\/description>/)?.[1] ?? '';
    expect(item).toContain('All day · Wed, Oct 14 – Fri, Oct 16');
    expect(item).not.toMatch(/12:00|AM|PT/);
  });
});
