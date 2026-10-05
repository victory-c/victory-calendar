import { load } from 'cheerio';
import { eq } from 'drizzle-orm';
import { cloneElement, createElement, isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ev, snap } from './helpers/digest-fixtures';
import { testDb } from './helpers/pglite';

// The public /weekly archive (M3 week 15, DESIGN D7/D8): the pure view (snapshot decides
// membership and sections, live rows decide what is shown), the DigestArchive markup, the PGlite
// reads behind it, the cached wrappers, and the two pages (404 rules, seed mode, metadata).
// Mocked: the database handle (PGlite), next/cache, next-intl (the real messages) and the page shell.

const h = vi.hoisted(() => ({ db: null as unknown, hasDb: true, locale: 'en' as 'en' | 'zh', tags: [] as string[][] }));
vi.mock('@/lib/db', async (orig) => ({
  ...(await orig()),
  db: new Proxy({}, { get: (_t, p) => Reflect.get(h.db as object, p) }),
  hasDatabase: () => h.hasDb,
}));
// 'use cache' is a plain string outside Next; the cached functions run as ordinary functions here.
vi.mock('next/cache', () => ({ cacheTag: (...tags: string[]) => void h.tags.push(tags), cacheLife: () => {} }));
vi.mock('next-intl/server', async () => {
  const messages = { en: (await import('../messages/en.json')).default, zh: (await import('../messages/zh.json')).default };
  const lookup = (tree: unknown, key: string) =>
    key.split('.').reduce<unknown>((node, k) => (node as Record<string, unknown> | undefined)?.[k], tree);
  return {
    getLocale: async () => h.locale,
    getTranslations:
      async ({ locale, namespace }: { locale: 'en' | 'zh'; namespace: string }) =>
      (key: string, values?: Record<string, unknown>) => {
        const v = lookup((messages[locale] as Record<string, unknown>)[namespace], key);
        if (typeof v !== 'string') throw new Error(`missing message ${namespace}.${key}`);
        return v.replace(/\{(\w+)\}/g, (m, k: string) => (values && k in values ? String(values[k]) : m));
      },
  };
});
vi.mock('@/i18n/navigation', () => ({
  // Locale prefixing is next-intl's job; here the raw href is what the component chose.
  Link: ({ href, children, prefetch: _p, ...rest }: { href: string; children: ReactNode; prefetch?: boolean }) =>
    createElement('a', { href, ...rest }, children),
}));
vi.mock('@/components/PageShell', () => ({
  PageShell: ({ children }: { children: ReactNode }) => createElement('main', null, children),
}));

const { archiveView, isArchivable, weekDate } = await import('@/lib/digest/archive');
const { getArchiveIssue, listSentIssues, readArchiveIssue, readSentIssues } = await import('@/lib/digest/archive-queries');
const { listIssues } = await import('@/lib/digest/issues');
const { DigestArchive } = await import('@/components/DigestArchive');
const issuePage = await import('@/app/[locale]/weekly/[week]/page');
const { default: WeeklyIndexPage, generateMetadata: indexMetadata } = await import('@/app/[locale]/weekly/page');
const { covers, digestIssues, events, settings } = await import('@/lib/db/schema');
const { templateCoverRow } = await import('@/lib/covers/template');
type ArchiveIssue = import('@/lib/digest/archive').ArchiveIssue;
type DigestEvent = import('@/lib/digest/types').DigestEvent;
type DigestSnapshot = import('@/lib/digest/types').DigestSnapshot;
type PublicEvent = import('@/lib/events/types').PublicEvent;
type DB = import('@/lib/db').DB;

const db = () => h.db as DB;
const eqWeek = (w: string) => eq(digestIssues.isoWeek, w);

beforeEach(async () => {
  h.db = (await testDb()).db;
  h.hasDb = true;
  h.locale = 'en';
  h.tags = [];
});

/** Async server components resolved by hand (renderToStaticMarkup can't await them). */
async function resolve(node: ReactNode): Promise<ReactNode> {
  if (Array.isArray(node)) return Promise.all(node.map(resolve));
  if (!isValidElement(node)) return node;
  const el = node as ReactElement<{ children?: ReactNode }>;
  if (typeof el.type === 'function' && el.type.constructor.name === 'AsyncFunction') {
    return resolve(await (el.type as (p: unknown) => Promise<ReactNode>)(el.props));
  }
  if (el.props.children === undefined) return el;
  return cloneElement(el, undefined, await resolve(el.props.children));
}
const markup = async (node: ReactNode | Promise<ReactNode>) => renderToStaticMarkup((await resolve(await node)) as ReactElement);

/** Strings that only ever belong in one reader's email. */
function expectNothingPerReader(html: string) {
  for (const s of ['/prefs/', '/unsubscribe', '__VP_TOKEN__', 'sub_', '/og/email-cover']) expect(html, s).not.toContain(s);
}

/** The event's live row, as publicEvents() returns it: same id, slug and times unless overridden. */
const live = (d: DigestEvent, over: Partial<PublicEvent> = {}): PublicEvent => ({
  id: d.id, slug: d.slug, status: 'published', titleEn: d.titleEn, titleZh: d.titleZh, summaryEn: null, summaryZh: null, noteEn: d.noteEn,
  noteZh: d.noteZh, category: d.category, tags: [], eventLanguage: 'en', startAt: new Date(d.startAt), endAt: d.endAt ? new Date(d.endAt) : null,
  tz: d.tz, allDay: d.allDay, format: d.format, venueName: null, city: d.place, neighborhood: null, region: null, address: null, privateVenue: false,
  priceText: d.priceText, access: d.access, hostName: null, hostUrl: null, sourceUrl: d.sourceUrl, going: d.seal ?? 'none', goingVisibility: 'public',
  featured: d.featured, sequence: 0, publishedAt: null, cover: null, ...over,
});

// W42 = Mon Oct 12 – Sun Oct 18 2026 (PDT). The issue went out Sunday evening, Oct 11.
const SENT_AT = '2026-10-12T01:00:00.000Z';
const AI_WED = ev({ id: 'evt_ai_wed', slug: 'agents-night', category: 'ai', startAt: '2026-10-14T01:30:00.000Z', titleEn: 'Agents Night', titleZh: '智能体之夜', seal: 'going' });
const AI_THU = ev({ id: 'evt_ai_thu', slug: 'evals-hour', category: 'ai', startAt: '2026-10-15T19:00:00.000Z', endAt: '2026-10-15T20:00:00.000Z', titleEn: 'Evals Hour', titleZh: 'Evals Hour' });
const VC_WED = ev({ id: 'evt_vc_wed', slug: 'founder-hours', category: 'vc', startAt: '2026-10-14T02:00:00.000Z', titleEn: 'Founder Hours', titleZh: '创业者答疑会', seal: 'speaking' });
const HK_SAT = ev({ id: 'evt_hk_sat', slug: 'cal-hacks', category: 'hackathon', startAt: '2026-10-17T16:00:00.000Z', titleEn: 'Cal Hacks', titleZh: 'Cal Hacks 黑客松' });
const PV_1 = ev({ id: 'evt_pv_1', slug: 'demo-day', category: 'vc', startAt: '2026-10-21T01:00:00.000Z', titleEn: 'Demo Day', titleZh: '路演日', featured: true });
const PV_2 = ev({ id: 'evt_pv_2', slug: 'gone-preview', category: 'ai', startAt: '2026-10-22T01:00:00.000Z', titleEn: 'Gone Preview', featured: true });
const SNAP = snap({ events: [AI_WED, VC_WED, AI_THU, HK_SAT], preview: [PV_1, PV_2] });

const issue = (over: Partial<ArchiveIssue> = {}, rows: PublicEvent[] = [AI_WED, VC_WED, AI_THU, HK_SAT, PV_1, PV_2].map((e) => live(e))): ArchiveIssue => ({
  now: SENT_AT, snap: SNAP, live: rows, showAttendance: true, nextIssue: false, ...over,
});
const ids = (list: { id: string }[]) => list.map((e) => e.id);
const sectionIds = (v: ReturnType<typeof archiveView>) => v.sections.map((s) => [s.category, s.days.map((d) => [d.key, ids(d.cards.map((c) => c.event))])]);

// ---- pure view -----------------------------------------------------------------------------------

describe('archiveView', () => {
  it('every category with events, in taxonomy order, by Pacific day; the intro in the page language', () => {
    const v = archiveView(issue(), 'zh');
    expect(sectionIds(v)).toEqual([
      ['ai', [['2026-10-13', ['evt_ai_wed']], ['2026-10-15', ['evt_ai_thu']]]],
      ['hackathon', [['2026-10-17', ['evt_hk_sat']]]],
      ['vc', [['2026-10-13', ['evt_vc_wed']]]],
    ]);
    expect(v.intro).toEqual(['这周 AI 活动扎堆，还有一场我主办的黑客松。', '现场见。']);
    expect(archiveView(issue(), 'en').intro).toEqual(['A heavy AI week, and a hackathon I am hosting.', 'See you there.']);
    expect(v.picks).toBe(4);
    expect(v.isoWeek).toBe('2026-W42');
  });

  it('an event unpublished since vanishes (its live row is gone); a cancelled one stays', () => {
    const rows = [live(AI_WED, { status: 'cancelled' }), live(VC_WED), live(HK_SAT)]; // AI_THU archived
    const v = archiveView(issue({}, rows), 'en');
    expect(sectionIds(v)).toEqual([
      ['ai', [['2026-10-13', ['evt_ai_wed']]]],
      ['hackathon', [['2026-10-17', ['evt_hk_sat']]]],
      ['vc', [['2026-10-13', ['evt_vc_wed']]]],
    ]);
    expect(v.sections[0].days[0].cards[0].event.status).toBe('cancelled');
    // A cancelled event never stays in the going list, even with its seal in the snapshot.
    expect(ids(v.going.map((g) => g.event))).toEqual(['evt_vc_wed']);
  });

  it('going: the snapshot seal, re-checked live (visibility hidden, kill switch, after the event)', () => {
    expect(archiveView(issue(), 'en').going.map((g) => [g.event.id, g.seal])).toEqual([
      ['evt_ai_wed', 'going'],
      ['evt_vc_wed', 'speaking'],
    ]);
    // Hidden since the send: out of the going list, and its card shows no seal.
    const hidden = archiveView(issue({}, [live(AI_WED, { goingVisibility: 'hidden' }), live(VC_WED)]), 'en');
    expect(ids(hidden.going.map((g) => g.event))).toEqual(['evt_vc_wed']);
    expect(hidden.sections[0].days[0].cards[0].going).toEqual({ kind: 'none' });
    // Kill switch on now: no going list, no seal anywhere.
    const off = archiveView(issue({ showAttendance: false }), 'en');
    expect(off.going).toEqual([]);
    expect(off.sections.flatMap((s) => s.days.flatMap((d) => d.cards.map((c) => c.going.kind)))).toEqual(['none', 'none', 'none', 'none']);
    // A month later the seals read 去过 / WENT, as on /going.
    const later = archiveView(issue({ now: '2026-11-15T00:00:00.000Z' }), 'en');
    expect(later.going.map((g) => g.seal)).toEqual(['went', 'went']);
  });

  it('attendance off in the snapshot: no going list even when attendance is on now', () => {
    const v = archiveView(issue({ snap: { ...SNAP, showAttendance: false } }), 'en');
    expect(v.going).toEqual([]);
  });

  it('a seal added after the send shows on its card but does not join the going list', () => {
    const v = archiveView(issue({}, [live(AI_WED), live(AI_THU, { going: 'hosting' })]), 'en');
    expect(ids(v.going.map((g) => g.event))).toEqual(['evt_ai_wed']);
    expect(v.sections[0].days[1].cards[0].going).toEqual({ kind: 'seal', seal: 'hosting' });
  });

  it('"interested" shows nothing, as in the email', () => {
    const v = archiveView(issue({}, [live(AI_THU, { going: 'interested' })]), 'en');
    expect(v.sections[0].days[0].cards[0].going).toEqual({ kind: 'none' });
  });

  it('a rescheduled event sits under its new day, in time order', () => {
    const moved = live(AI_WED, { startAt: new Date('2026-10-16T01:30:00.000Z') }); // Wed → Thu evening PT
    const v = archiveView(issue({}, [moved, live(AI_THU)]), 'en');
    expect(sectionIds(v)).toEqual([['ai', [['2026-10-15', ['evt_ai_thu', 'evt_ai_wed']]]]]);
  });

  it('preview: live rows only, linked to /weekly when the next issue is public, else /week', () => {
    const rows = [AI_WED, PV_1].map((e) => live(e)); // PV_2 unpublished since
    const v = archiveView(issue({}, rows), 'en');
    expect(ids(v.preview.events)).toEqual(['evt_pv_1']);
    expect(v.preview).toMatchObject({ isoWeek: '2026-W43', href: '/week/2026-W43' });
    expect(archiveView(issue({ nextIssue: true }, rows), 'en').preview.href).toBe('/weekly/2026-W43');
  });

  it('everything taken down: no sections, no going, picks 0', () => {
    const v = archiveView(issue({}, []), 'en');
    expect(v).toMatchObject({ sections: [], going: [], picks: 0, preview: { events: [] } });
    expect(v.intro).toHaveLength(2);
  });

  it('isArchivable: version 1, this week, events and a preview list', () => {
    expect(isArchivable(SNAP, '2026-W42')).toBe(true);
    expect(isArchivable(SNAP, '2026-W43')).toBe(false);
    expect(isArchivable({ ...SNAP, version: 2 }, '2026-W42')).toBe(false);
    expect(isArchivable({ ...SNAP, events: [] }, '2026-W42')).toBe(false);
    expect(isArchivable({ ...SNAP, preview: null }, '2026-W42')).toBe(false);
    expect(isArchivable(null, '2026-W42')).toBe(false);
  });

  it('weekDate: the covered Monday with its year, in both languages', () => {
    expect(weekDate('2026-W42', 'en')).toBe('Oct 12, 2026');
    expect(weekDate('2026-W42', 'zh')).toBe('2026年10月12日');
    expect(weekDate('2027-W01', 'en')).toBe('Jan 4, 2027');
    expect(() => weekDate('2026-W54', 'en')).toThrow();
  });
});

// ---- DigestArchive markup ------------------------------------------------------------------------

describe('DigestArchive', () => {
  const render = async (i: ArchiveIssue, locale: 'en' | 'zh' = 'en') => load(await markup(DigestArchive({ view: archiveView(i, locale), locale })));

  it('the issue in email order, with unique day anchors across sections and links to the site only', async () => {
    const html = await markup(DigestArchive({ view: archiveView(issue(), 'en'), locale: 'en' }));
    const $ = load(html);
    expect($('h1').text()).toBe('Weekly picks · week of Oct 12, 2026');
    expect($('article p').first().text()).toBe('A heavy AI week, and a hackathon I am hosting.');
    expect($('article > section > h2').map((_, el) => $(el).text()).get()).toEqual([
      'Victor is going', 'AI & Tech', 'Hackathons', 'VC & Founders', 'Next week · week of Oct 19, 2026',
    ]);
    // Day anchors repeat the date across categories (both sections have Tue Oct 13): ids stay unique.
    const anchors = $('[id^="d-"]').map((_, el) => $(el).attr('id')).get();
    expect(anchors).toContain('d-ai-2026-10-13');
    expect(anchors).toContain('d-vc-2026-10-13');
    expect(new Set(anchors).size).toBe(anchors.length);
    const allIds = $('[id]').map((_, el) => $(el).attr('id')).get();
    expect(new Set(allIds).size).toBe(allIds.length);
    // Cross-links: the plain week, the index, the event pages, the next week.
    const hrefs = $('a').map((_, el) => $(el).attr('href')).get();
    expect(hrefs).toEqual(expect.arrayContaining(['/weekly', '/week/2026-W42', '/events/agents-night', '/events/demo-day', '/week/2026-W43']));
    expect(hrefs.every((href) => href.startsWith('/'))).toBe(true);
    expectNothingPerReader(html);
  });

  it('a cancelled event is struck through; an unpublished one is gone', async () => {
    const $ = await render(issue({}, [live(AI_WED, { status: 'cancelled' }), live(VC_WED)]));
    const title = $('a[href="/events/agents-night"].title-link').first();
    expect(title.attr('class')).toContain('line-through');
    expect($('a[href="/events/evals-hour"]')).toHaveLength(0);
    expect($('a[href="/events/founder-hours"].title-link').first().attr('class')).not.toContain('line-through');
  });

  it('zh going row: seal, 打算去 and the day, never a time; after the event 去过 without 打算去', async () => {
    const $ = await render(issue({}, [live(AI_WED)]), 'zh');
    const row = $('#going-h').next('ul').find('li').first();
    expect(row.find('[role="img"]').attr('aria-label')).toBe('会去');
    expect(row.find('p').text()).toBe('打算去 · 10月13日周二 · SoMa');
    expect(row.text()).not.toMatch(/\d{1,2}:\d\d/);
    const $later = await render(issue({ now: '2026-11-15T00:00:00.000Z' }, [live(AI_WED)]), 'zh');
    const later = $later('#going-h').next('ul').find('li').first();
    expect(later.find('[role="img"]').attr('aria-label')).toBe('去过');
    expect(later.find('p').text()).toBe('10月13日周二 · SoMa');
  });

  it('headings nest one level per step: category h2 → day h3 → event h4 (DayList keeps h2 → h3)', async () => {
    const $ = await render(issue());
    const tag = (el: Parameters<typeof $>[0]) => String($(el).prop('tagName')).toLowerCase();
    const tags = (sel: string) => $(sel).map((_, el) => tag(el)).get();
    expect(tags('.day-header')).toEqual(['h3', 'h3', 'h3', 'h3']); // ai Tue + Thu, hackathon Sat, vc Tue
    expect(tags('article.event-card :header')).toEqual(['h4', 'h4', 'h4', 'h4']);
    $('.day-header').each((_, el) => {
      expect($(el).parent().parent().children('h2').attr('id')).toMatch(/^c-/); // inside its category section
    });
    const levels = $(':header').map((_, el) => Number(tag(el)[1])).get();
    levels.forEach((l, i) => i > 0 && expect(l - levels[i - 1], `${i}`).toBeLessThanOrEqual(1));
    // The defaults DayList relies on.
    const { DayHeader } = await import('@/components/DayHeader');
    const { EventCard } = await import('@/components/EventCard');
    expect(load(await markup(DayHeader({ id: 'd-x', date: new Date(AI_WED.startAt), locale: 'en' })))('.day-header').prop('tagName')).toBe('H2');
    const card = load(await markup(EventCard({ event: live(AI_WED), locale: 'en', going: { kind: 'none' } })));
    expect(card('article.event-card :header').prop('tagName')).toBe('H3');
  });

  it('zh: place names in the going and preview rows are marked English; "online" and the separators are not read out', async () => {
    const spoken = (el: ReturnType<typeof $>) => {
      const c = el.clone();
      c.find('[aria-hidden]').remove();
      return c.text();
    };
    let $ = await render(issue(), 'zh');
    const going = $('#going-h').next('ul').find('li p').first();
    expect(going.find('[lang="en"]').map((_, el) => spoken($(el))).get()).toEqual(['SoMa']);
    // Only the dot is hidden: the spaces around it stay, so a screen reader doesn't run words together.
    expect(going.find('[aria-hidden]').map((_, el) => $(el).text()).get()).toEqual(['·', '·']);
    const preview = $('#preview-h').next('ul').find('li p').first();
    expect(preview.find('[lang="en"]').map((_, el) => spoken($(el))).get()).toEqual(['SoMa']);
    expect(preview.text()).toMatch(/ · SoMa$/);

    // Online and all-day, cancelled: the label is in the page language, every separator hidden.
    const rows = [live(AI_WED, { format: 'online', city: null }), live(PV_1, { format: 'online', city: null, allDay: true, status: 'cancelled' })];
    $ = await render(issue({}, rows), 'zh');
    expect($('#going-h').next('ul').find('li p').first().text()).toBe('打算去 · 10月13日周二 · 线上');
    const row = $('#preview-h').next('ul').find('li p').first();
    expect(row.text()).toBe('10月20日周二 · 全天 · 线上 · 已取消');
    expect(row.find('[lang]')).toHaveLength(0);
    expect(spoken(row).replace(/\s+/g, ' ')).toBe('10月20日周二 全天 线上 已取消');
  });

  it('kill switch on: no going section and no seal on any card', async () => {
    const $ = await render(issue({ showAttendance: false }));
    expect($('#going-h')).toHaveLength(0);
    expect($('.seal')).toHaveLength(0);
  });

  it('everything taken down: the intro and an empty-state line, no sections', async () => {
    const html = await markup(DigestArchive({ view: archiveView(issue({}, []), 'en'), locale: 'en' }));
    const $ = load(html);
    expect($('h1')).toHaveLength(1);
    expect(html).toContain('See you there.');
    expect(html).toContain('The events in this issue have since been taken down.');
    expect($('article.event-card')).toHaveLength(0);
    expectNothingPerReader(html);
  });
});

// ---- PGlite reads ----------------------------------------------------------------------------------

async function seedEvents() {
  await db().insert(covers).values({ id: 'cov_t', ...templateCoverRow('ai', null) });
  const base = { sourceUrl: 'https://luma.com/x', coverId: 'cov_t', createdVia: 'admin' as const, publishedAt: new Date('2026-10-01T00:00:00Z') };
  const row = (d: DigestEvent, status: 'published' | 'cancelled' | 'archived') => ({
    ...base, id: d.id, slug: d.slug, status, titleEn: d.titleEn, titleZh: d.titleZh, category: d.category, startAt: new Date(d.startAt),
    endAt: d.endAt ? new Date(d.endAt) : null, going: d.seal ?? ('none' as const), featured: d.featured,
  });
  await db()
    .insert(events)
    .values([row(AI_WED, 'published'), row(VC_WED, 'published'), row(AI_THU, 'archived'), row(HK_SAT, 'cancelled'), row(PV_1, 'published')]);
}
type IssueRow = typeof digestIssues.$inferInsert;
async function seedIssue(isoWeek: string, over: Partial<IssueRow> = {}) {
  await db()
    .insert(digestIssues)
    .values({ id: `dig_${isoWeek.replace('-', '')}`, isoWeek, status: 'sent', sentAt: new Date(SENT_AT), snapshot: snap({ isoWeek, events: [ev()] }), ...over });
}

describe('readArchiveIssue', () => {
  beforeEach(seedEvents);

  it('drafts and scheduled issues are not public; sending and sent are', async () => {
    for (const status of ['draft', 'scheduled'] as const) {
      await db().delete(digestIssues);
      await seedIssue('2026-W42', { status, snapshot: SNAP });
      expect(await readArchiveIssue('2026-W42'), status).toBeNull();
    }
    for (const status of ['sending', 'sent'] as const) {
      await db().delete(digestIssues);
      await seedIssue('2026-W42', { status, snapshot: SNAP });
      expect((await readArchiveIssue('2026-W42'))?.snap.isoWeek, status).toBe('2026-W42');
    }
  });

  it('no snapshot, another version, another week or no events: null', async () => {
    const cases: [string, unknown][] = [
      ['null', null],
      ['version 2', { ...SNAP, version: 2 }],
      ['other week', { ...SNAP, isoWeek: '2026-W41' }],
      ['no events', { ...SNAP, events: [] }],
      ['events not a list', { ...SNAP, events: 'x' }],
    ];
    for (const [name, snapshot] of cases) {
      await db().delete(digestIssues);
      await seedIssue('2026-W42', { snapshot });
      expect(await readArchiveIssue('2026-W42'), name).toBeNull();
    }
    expect(await readArchiveIssue('2026-W30')).toBeNull(); // no row at all
  });

  it('live rows: archived dropped, cancelled kept; attendance from settings; the next issue', async () => {
    await seedIssue('2026-W42', { snapshot: SNAP });
    const now = new Date('2026-10-12T02:00:00.000Z');
    const got = await readArchiveIssue('2026-W42', { now });
    expect(got).toMatchObject({ now: now.toISOString(), showAttendance: true, nextIssue: false });
    expect(got!.live.map((e) => [e.id, e.status])).toEqual([
      ['evt_ai_wed', 'published'],
      ['evt_vc_wed', 'published'],
      ['evt_hk_sat', 'cancelled'],
      ['evt_pv_1', 'published'],
    ]);
    expect(got!.live[0].cover?.kind).toBe('template');

    await db().insert(settings).values({ key: 'show_attendance', value: { on: false } });
    await seedIssue('2026-W43', { status: 'sending', snapshot: snap({ isoWeek: '2026-W43', events: [ev()] }) });
    expect(await readArchiveIssue('2026-W42', { now })).toMatchObject({ showAttendance: false, nextIssue: true });
  });

  it('the next issue only counts when its own page would show', async () => {
    await seedIssue('2026-W42', { snapshot: SNAP });
    await seedIssue('2026-W43', { status: 'scheduled', snapshot: snap({ isoWeek: '2026-W43', events: [ev()] }) });
    expect((await readArchiveIssue('2026-W42'))?.nextIssue).toBe(false);
    await db().update(digestIssues).set({ status: 'sent', snapshot: snap({ isoWeek: '2026-W43', events: [] }) }).where(eqWeek('2026-W43'));
    expect((await readArchiveIssue('2026-W42'))?.nextIssue).toBe(false);
  });
});

describe('readSentIssues', () => {
  it("sent issues whose page shows, newest first, with the snapshot's intros and the send time", async () => {
    await seedIssue('2026-W40', { snapshot: snap({ isoWeek: '2026-W40', events: [ev()], introEn: 'Forty', introZh: '四十' }) });
    await seedIssue('2026-W42', { sentAt: new Date('2026-10-12T01:30:00Z') });
    await seedIssue('2026-W41', { status: 'sending' }); // public page, not listed until sent
    await seedIssue('2026-W39', { snapshot: snap({ isoWeek: '2026-W39', events: [] }) }); // only empty notices went out
    await seedIssue('2026-W38', { snapshot: { ...snap({ isoWeek: '2026-W38', events: [ev()] }), version: 2 } });
    await seedIssue('2026-W37', { snapshot: snap({ isoWeek: '2026-W36', events: [ev()] }) }); // mismatched week
    await seedIssue('2026-W36', { snapshot: { ...snap({ isoWeek: '2026-W36' }), events: { bad: true } } as unknown as DigestSnapshot });
    await seedIssue('2026-W35', { snapshot: null });
    await seedIssue('2026-W43', { status: 'draft' });
    const got = await readSentIssues();
    expect(got.map((i) => i.isoWeek)).toEqual(['2026-W42', '2026-W40']);
    expect(got[0].sentAt).toEqual(new Date('2026-10-12T01:30:00Z'));
    expect(got[1]).toMatchObject({ introEn: 'Forty', introZh: '四十' });
    // Every listed week has a page.
    for (const i of got) expect(await readArchiveIssue(i.isoWeek), i.isoWeek).not.toBeNull();
  });
});

describe('listIssues archivable (the admin "public page" link)', () => {
  it('the same predicate as the archive: sending or sent and archivable exactly when /weekly/W shows', async () => {
    await seedIssue('2026-W42'); // sent with events
    await seedIssue('2026-W41', { status: 'sending' });
    await seedIssue('2026-W40', { snapshot: snap({ isoWeek: '2026-W40', events: [] }) }); // only empty notices went out
    await seedIssue('2026-W39', { snapshot: { ...snap({ isoWeek: '2026-W39', events: [ev()] }), version: 2 } });
    await seedIssue('2026-W38', { snapshot: snap({ isoWeek: '2026-W37', events: [ev()] }) }); // mismatched week
    await seedIssue('2026-W37', { snapshot: { ...snap({ isoWeek: '2026-W37' }), events: { bad: true } } as unknown as DigestSnapshot });
    await seedIssue('2026-W36', { snapshot: { ...snap({ isoWeek: '2026-W36', events: [ev()] }), preview: null } as unknown as DigestSnapshot });
    await seedIssue('2026-W35', { snapshot: null });
    await seedIssue('2026-W34', { snapshot: { version: 1 } as unknown as DigestSnapshot }); // no isoWeek: NULL in SQL
    await seedIssue('2026-W43', { status: 'draft', snapshot: null });
    const list = await listIssues(20, { db: db() });
    expect(list.filter((i) => i.archivable).map((i) => i.isoWeek)).toEqual(['2026-W42', '2026-W41']);
    for (const i of list) {
      const linked = i.archivable && (i.status === 'sending' || i.status === 'sent');
      expect(Boolean(await readArchiveIssue(i.isoWeek)), i.isoWeek).toBe(linked);
      expect(typeof i.archivable, i.isoWeek).toBe('boolean');
    }
  });
});

// ---- cached wrappers -------------------------------------------------------------------------------

describe('cached reads', () => {
  it("getArchiveIssue is tagged 'digest' and 'events'; listSentIssues 'digest'", async () => {
    await seedEvents();
    await seedIssue('2026-W42', { snapshot: SNAP });
    expect((await getArchiveIssue('2026-W42'))?.snap.isoWeek).toBe('2026-W42');
    expect((await listSentIssues()).map((i) => i.isoWeek)).toEqual(['2026-W42']);
    expect(h.tags).toEqual([['digest', 'events'], ['digest']]);
  });

  it('without a database, or for a malformed week, nothing is queried', async () => {
    h.db = new Proxy({}, { get: () => { throw new Error('database touched'); } });
    expect(await getArchiveIssue('__placeholder__')).toBeNull();
    expect(await getArchiveIssue('2026-W54')).toBeNull();
    h.hasDb = false;
    expect(await getArchiveIssue('2026-W42')).toBeNull();
    expect(await listSentIssues()).toEqual([]);
  });
});

// ---- pages ------------------------------------------------------------------------------------------

describe('/weekly/[week]', () => {
  const params = (week: string) => ({ params: Promise.resolve({ locale: h.locale, week }) }) as unknown as PageProps<'/[locale]/weekly/[week]'>;
  const page = (week: string) => issuePage.default(params(week));
  const NOT_FOUND = { digest: 'NEXT_HTTP_ERROR_FALLBACK;404' };

  it('404s a malformed, impossible, unknown or unsent week; the placeholder never queries', async () => {
    await seedEvents();
    await seedIssue('2026-W41', { status: 'scheduled', snapshot: null });
    await seedIssue('2026-W40', { snapshot: snap({ isoWeek: '2026-W40', events: [] }) });
    for (const week of ['2026-W99', '2027-W53', '2026-w42', '2026-W42', '2026-W41', '2026-W40']) {
      await expect(page(week), week).rejects.toMatchObject(NOT_FOUND);
    }
    h.db = new Proxy({}, { get: () => { throw new Error('database touched'); } });
    await expect(page('__placeholder__')).rejects.toMatchObject(NOT_FOUND);
  });

  it('renders a sending or sent issue in the page language', async () => {
    await seedEvents();
    await seedIssue('2026-W42', { status: 'sending', snapshot: SNAP });
    h.locale = 'zh';
    const html = await markup(page('2026-W42'));
    const $ = load(html);
    expect($('h1').text()).toBe('周报 · 2026年10月12日 这一周');
    expect(html).toContain('现场见。');
    expect($('a[href="/events/agents-night"]').length).toBeGreaterThan(0);
    expect($('a[href="/events/evals-hour"]')).toHaveLength(0); // archived since
    expect($('a[href="/events/cal-hacks"].title-link').attr('class')).toContain('line-through'); // cancelled since
    expect($('a[href="/events/demo-day"]')).toHaveLength(1);
    expect($('a[href="/events/gone-preview"]')).toHaveLength(0); // never published
    expectNothingPerReader(html);
  });

  it('every event taken down: still a 200 with the intro, since emails link here', async () => {
    await seedEvents();
    await seedIssue('2026-W42', { snapshot: snap({ events: [AI_THU] }) });
    const html = await markup(page('2026-W42'));
    expect(html).toContain('See you there.');
    expect(html).toContain('The events in this issue have since been taken down.');
  });

  it('generateStaticParams: the placeholder before the first send, then the latest sent weeks', async () => {
    expect(await issuePage.generateStaticParams()).toEqual([{ week: '__placeholder__' }]);
    h.hasDb = false;
    expect(await issuePage.generateStaticParams()).toEqual([{ week: '__placeholder__' }]);
    h.hasDb = true;
    for (let w = 1; w <= 14; w++) await seedIssue(`2026-W${String(w).padStart(2, '0')}`, { snapshot: snap({ isoWeek: `2026-W${String(w).padStart(2, '0')}`, events: [ev()] }) });
    const got = await issuePage.generateStaticParams();
    expect(got).toHaveLength(12);
    expect(got[0]).toEqual({ week: '2026-W14' });
  });

  it('metadata: title, the intro as description, hreflang for both languages; none for a 404', async () => {
    vi.stubEnv('PUBLIC_HOST', 'picks.example.org');
    await seedEvents();
    await seedIssue('2026-W42', { snapshot: SNAP });
    const meta = await issuePage.generateMetadata(params('2026-W42'));
    expect(meta.title).toBe('Weekly picks · week of Oct 12, 2026');
    expect(meta.description).toBe('A heavy AI week, and a hackathon I am hosting.');
    expect(meta.alternates?.languages).toEqual({
      en: 'https://picks.example.org/weekly/2026-W42',
      'zh-Hans': 'https://picks.example.org/zh/weekly/2026-W42',
      'x-default': 'https://picks.example.org/weekly/2026-W42',
    });
    await db().update(digestIssues).set({ snapshot: { ...SNAP, introEn: null } }).where(eqWeek('2026-W42'));
    expect((await issuePage.generateMetadata(params('2026-W42'))).description).toMatch(/^Victor's weekly email for the week of Oct 12, 2026/);
    expect(await issuePage.generateMetadata(params('2026-W43'))).toEqual({});
    vi.unstubAllEnvs();
  });
});

describe('/weekly', () => {
  it('seed mode (no database): an empty state, no query', async () => {
    h.hasDb = false;
    h.db = new Proxy({}, { get: () => { throw new Error('database touched'); } });
    const html = await markup(WeeklyIndexPage());
    expect(load(html)('h1').text()).toBe('Weekly picks');
    expect(html).toContain('No issues have gone out yet.');
  });

  it('lists sent issues newest first with the first intro line, linking to each archive', async () => {
    await seedIssue('2026-W40', { snapshot: snap({ isoWeek: '2026-W40', events: [ev()], introZh: '第一行\n第二行' }) });
    await seedIssue('2026-W42');
    await seedIssue('2026-W43', { status: 'sending' });
    h.locale = 'zh';
    const $ = load(await markup(WeeklyIndexPage()));
    expect($('h1').text()).toBe('周报');
    expect($('li a').map((_, el) => [[$(el).attr('href'), $(el).text()]]).get()).toEqual([
      ['/weekly/2026-W42', '2026年10月12日 这一周'],
      ['/weekly/2026-W40', '2026年9月28日 这一周'],
    ]);
    expect($('li').last().find('p').text()).toBe('第一行');
  });

  it('metadata in both languages', async () => {
    expect((await indexMetadata()).title).toBe('Weekly picks');
    h.locale = 'zh';
    expect((await indexMetadata()).title).toBe('周报');
  });
});
