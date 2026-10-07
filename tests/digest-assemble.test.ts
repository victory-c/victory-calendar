import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { testDb } from './helpers/pglite';

// Digest assembly (builder B): the snapshot every render uses, the email cover rule, the issue
// lifecycle and the audience. PGlite with the real migrations. The default db handle is pointed
// at the same PGlite instance, because settings (show_attendance, official_covers_to_template)
// are read through it.
const h = vi.hoisted(() => ({ db: null as unknown }));
vi.mock('@/lib/db', async (orig) => ({
  ...(await orig()),
  db: new Proxy({}, { get: (_t, p) => Reflect.get(h.db as object, p) }),
  hasDatabase: () => true,
}));

const { buildSnapshot, lumaCoverChoices } = await import('@/lib/digest/assemble');
const { coverFallsBack, emailCover, isKeepableLumaCover, templateEmailUrl } = await import('@/lib/digest/cover');
const issuesMod = await import('@/lib/digest/issues');
const { audience, cleanIntro, ensureIssue, getIssue, getIssueByWeek, INTRO_MAX, listIssues, saveIssue, scheduleIssue, unscheduleIssue } =
  issuesMod;
const { LATE_LIMIT_MS, sendAfterFor } = await import('@/lib/digest/week');
const { covers, digestIssues, digestSends, events, settings, subscribers } = await import('@/lib/db/schema');
const { templateCoverRow } = await import('@/lib/covers/template');
type DB = import('@/lib/db').DB;
type NewEvent = import('@/lib/db/schema').NewEvent;
type CoverKind = import('@/lib/events/types').PublicCover['kind'];
type PublicEvent = import('@/lib/events/types').PublicEvent;
type DigestIssue = import('@/lib/digest/issues').DigestIssue;

const ORIGIN = 'https://picks.test';
const W = '2026-W42'; // covers Mon Oct 12 00:00 PDT (07:00Z) → Mon Oct 19 00:00 PDT; sent Sun Oct 11 17:00 PDT
const T = (iso: string) => new Date(iso);
const WED = T('2026-10-15T01:00:00Z'); // Wed Oct 14 18:00 PDT, inside W42
const NEXT_WED = T('2026-10-22T01:00:00Z'); // Wed Oct 21 18:00 PDT, inside W43 (the preview week)

let db: DB;
let seq = 0;
beforeEach(async () => {
  db = (await testDb()).db as unknown as DB;
  h.db = db;
  vi.stubEnv('PUBLIC_HOST', 'picks.test');
  vi.stubEnv('SHOW_ATTENDANCE', '');
});
afterEach(() => {
  vi.unstubAllEnvs();
});

type CoverSpec = { kind: CoverKind; attribution?: string | null; sourcePageUrl?: string | null; license?: string | null } | null;

/** A published event (with the cover row a published event must have) unless overridden. */
async function addEvent(over: Partial<NewEvent> & { cover?: CoverSpec } = {}) {
  const { cover = { kind: 'template' }, ...rest } = over;
  const id = rest.id ?? `evt_${String(++seq).padStart(4, '0')}`;
  const category = rest.category ?? 'ai';
  let coverId: string | null = null;
  if (cover) {
    coverId = `cov_${id.slice(4)}`;
    await db.insert(covers).values(
      cover.kind === 'template'
        ? { id: coverId, ...templateCoverRow(category, rest.hostName ?? null) }
        : {
            id: coverId, kind: cover.kind, url1600: `https://blob.test/${id}-1600.webp`, url800: `https://blob.test/${id}-800.webp`,
            url400: `https://blob.test/${id}-400.webp`, urlOgEn: '', urlOgZh: '', thumbhash: 'x', dominant: '#000000', bytes: 1,
            attribution: cover.attribution ?? null, sourcePageUrl: cover.sourcePageUrl ?? null, license: cover.license ?? null,
          },
    );
  }
  await db.insert(events).values({
    slug: `event-${id}`, status: 'published', sourceUrl: `https://luma.com/${id}`, titleEn: `Event ${id}`, titleZh: `活动 ${id}`,
    startAt: WED, tz: 'America/Los_Angeles', city: 'San Francisco', format: 'in_person', going: 'interested', ...rest,
    id, category, coverId,
  });
  return id;
}

async function issue(over: Partial<typeof digestIssues.$inferInsert> = {}): Promise<DigestIssue> {
  const [row] = await db
    .insert(digestIssues)
    .values({ id: `dig_${String(++seq).padStart(4, '0')}`, isoWeek: W, ...over })
    .returning();
  return row;
}

const setSetting = (key: string, value: Record<string, unknown>) => db.insert(settings).values({ key, value });
const snap = async (over: Partial<typeof digestIssues.$inferInsert> = {}) => buildSnapshot(await issue(over), { db });
const ids = (list: { id: string }[]) => list.map((e) => e.id);
const reload = async (id: string) => (await getIssue(id, { db }))!;

describe('emailCover (pure)', () => {
  const ev = (cover: CoverSpec, over: Partial<PublicEvent> = {}) =>
    ({
      id: 'evt_a', category: 'hackathon', hostName: 'Example Labs', sourceUrl: 'https://luma.com/abcd', coverId: cover ? 'cov_a' : null,
      cover: cover && {
        kind: cover.kind, url400: 'https://blob.test/a-400.webp', url800: '', url1600: '', thumbhash: '', dominant: '', letterboxed: false,
        attribution: cover.attribution ?? null, license: cover.license ?? null, sourcePageUrl: cover.sourcePageUrl ?? null,
      },
      ...over,
    }) as Parameters<typeof emailCover>[0];
  const none = { keep: new Set<string>(), allToTemplate: false };
  const tpl = { url: `${ORIGIN}/og/template/hackathon?s=192`, credit: null };
  const real = (credit: string | null) => ({ url: `${ORIGIN}/og/email-cover/cov_a`, credit });

  it('templates at 192 px without the host line, never the stored URL', () => {
    expect(emailCover(ev({ kind: 'template' }), ORIGIN, none)).toEqual(tpl);
    expect(emailCover(ev(null), ORIGIN, none)).toEqual(tpl);
    expect(templateEmailUrl(`${ORIGIN}/`, 'ai')).toBe(`${ORIGIN}/og/template/ai?s=192`);
    expect(emailCover(ev({ kind: 'template' }), ORIGIN, none).url).not.toContain('h=');
  });

  it('Luma official and host-composite covers fall back to the template unless kept', () => {
    const official = ev({ kind: 'official', attribution: 'Cover: Example Labs via Luma' });
    const composite = ev({ kind: 'host_composite', attribution: 'Host photos via Luma' });
    expect(emailCover(official, ORIGIN, none)).toEqual(tpl);
    expect(emailCover(composite, ORIGIN, none)).toEqual(tpl);
    expect(emailCover(ev({ kind: 'official' }, { sourceUrl: 'https://lu.ma/x' }), ORIGIN, none)).toEqual(tpl);
    const keep = { keep: new Set(['evt_a']), allToTemplate: false };
    expect(emailCover(official, ORIGIN, keep)).toEqual(real('Cover: Example Labs via Luma'));
    expect(emailCover(composite, ORIGIN, keep)).toEqual(real('Host photos via Luma'));
    expect(emailCover(official, ORIGIN, { keep: new Set(['evt_other']), allToTemplate: false })).toEqual(tpl);
  });

  it('other platforms keep their official cover, with a credit even when none was stored', () => {
    const partiful = { sourceUrl: 'https://partiful.com/e/abc' };
    expect(emailCover(ev({ kind: 'official' }, partiful), ORIGIN, none)).toEqual(real('Cover: Example Labs via Partiful'));
    expect(emailCover(ev({ kind: 'official' }, { ...partiful, hostName: null }), ORIGIN, none)).toEqual(real('Cover: Partiful via Partiful'));
    expect(emailCover(ev({ kind: 'host_composite' }, partiful), ORIGIN, none)).toEqual(real('Host photos via Partiful'));
  });

  it("Victor's own and licensed covers are used as they are", () => {
    expect(emailCover(ev({ kind: 'upload' }), ORIGIN, none)).toEqual(real(null));
    expect(emailCover(ev({ kind: 'ai' }), ORIGIN, none)).toEqual(real(null));
    expect(emailCover(ev({ kind: 'url' }), ORIGIN, none)).toEqual(real(null));
    expect(emailCover(ev({ kind: 'openverse', attribution: '"Bridge" by A. Person, CC BY 2.0' }), ORIGIN, none)).toEqual(
      real('"Bridge" by A. Person, CC BY 2.0'),
    );
  });

  it('an Openverse credit carries the work’s page and the licence deed; no other cover does', () => {
    const page = 'https://www.flickr.example/photos/a/1';
    const credit = '"Bridge" by A. Person · CC BY-SA 2.0 · cropped';
    expect(emailCover(ev({ kind: 'openverse', attribution: credit, license: 'by-sa/2.0', sourcePageUrl: page }), ORIGIN, none)).toEqual({
      ...real(credit), sourceUrl: page, licenseUrl: 'https://creativecommons.org/licenses/by-sa/2.0/',
    });
    expect(emailCover(ev({ kind: 'openverse', attribution: 'Untitled image · CC0 1.0', license: 'cc0/1.0' }), ORIGIN, none)).toEqual({
      ...real('Untitled image · CC0 1.0'), licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
    });
    // A licence code we don't know gives no deed; Brave and official covers have a page but no links.
    expect(emailCover(ev({ kind: 'openverse', attribution: credit, license: 'by-nc/2.0', sourcePageUrl: page }), ORIGIN, none)).toEqual({
      ...real(credit), sourceUrl: page,
    });
    expect(emailCover(ev({ kind: 'brave', sourcePageUrl: page }), ORIGIN, none)).toEqual(tpl);
    const partiful = { sourceUrl: 'https://partiful.com/e/1' };
    expect(emailCover(ev({ kind: 'official', license: 'by/2.0', sourcePageUrl: partiful.sourceUrl }, partiful), ORIGIN, none)).toEqual(
      real('Cover: Example Labs via Partiful'),
    );
  });

  it('official_covers_to_template wins over keep, for official covers only', () => {
    const all = { keep: new Set(['evt_a']), allToTemplate: true };
    expect(emailCover(ev({ kind: 'official' }), ORIGIN, all)).toEqual(tpl);
    expect(emailCover(ev({ kind: 'official' }, { sourceUrl: 'https://partiful.com/e/1' }), ORIGIN, all)).toEqual(tpl);
    expect(emailCover(ev({ kind: 'host_composite' }, { sourceUrl: 'https://meetup.com/g/e/1' }), ORIGIN, all)).toEqual(tpl);
    expect(emailCover(ev({ kind: 'upload' }), ORIGIN, all)).toEqual(real(null));
  });

  it('a real cover without a known cover id falls back to the template; ids are URL-encoded', () => {
    expect(emailCover(ev({ kind: 'upload' }, { coverId: null } as never), ORIGIN, none)).toEqual(tpl);
    expect(emailCover(ev({ kind: 'upload' }, { coverId: 'cov a/b' } as never), `${ORIGIN}//`, none).url).toBe(
      `${ORIGIN}/og/email-cover/cov%20a%2Fb`,
    );
  });

  it('coverFallsBack / isKeepableLumaCover agree with emailCover', () => {
    const official = ev({ kind: 'official' });
    expect(coverFallsBack(official, none)).toBe(true);
    expect(coverFallsBack(official, { keep: new Set(['evt_a']), allToTemplate: false })).toBe(false);
    expect(isKeepableLumaCover(official, false)).toBe(true);
    expect(isKeepableLumaCover(official, true)).toBe(false);
    expect(isKeepableLumaCover(ev({ kind: 'upload' }), false)).toBe(false);
    expect(isKeepableLumaCover(ev({ kind: 'official' }, { sourceUrl: 'https://partiful.com/e/1' }), false)).toBe(false);
  });

  it('a cover fetched from Luma stays Luma-sourced after the event link is edited to another site', () => {
    const host = { sourceUrl: 'https://host.example/register' };
    const fromLuma = ev({ kind: 'official', attribution: 'Cover: Example Labs via Luma', sourcePageUrl: 'https://luma.com/abcd' }, host);
    expect(coverFallsBack(fromLuma, none)).toBe(true);
    expect(emailCover(fromLuma, ORIGIN, none)).toEqual(tpl);
    expect(isKeepableLumaCover(fromLuma, false)).toBe(true);
    expect(emailCover(fromLuma, ORIGIN, { keep: new Set(['evt_a']), allToTemplate: false })).toEqual(real('Cover: Example Labs via Luma'));
    expect(coverFallsBack(ev({ kind: 'host_composite', sourcePageUrl: 'https://lu.ma/abcd' }, host), none)).toBe(true);
    // Either link pointing at Luma is enough; neither keeps the real cover.
    const partifulCover = ev({ kind: 'official', sourcePageUrl: 'https://partiful.com/e/1' }, host);
    expect(coverFallsBack(partifulCover, none)).toBe(false);
    expect(isKeepableLumaCover(partifulCover, false)).toBe(false);
    expect(coverFallsBack(ev({ kind: 'official', sourcePageUrl: 'https://partiful.com/e/1' }), none)).toBe(true); // event still on Luma
    // Without a stored credit, the generated one names where the image came from.
    expect(emailCover(partifulCover, ORIGIN, none)).toEqual(real('Cover: Example Labs via Partiful'));
  });
});

describe('buildSnapshot: which events', () => {
  it('published events starting in [Mon 00:00 PT, next Mon 00:00 PT); cancelled, draft and archived left out', async () => {
    await addEvent({ id: 'evt_prev', startAt: T('2026-10-12T06:30:00Z') }); // Sun Oct 11 23:30 PDT → previous issue
    await addEvent({ id: 'evt_first', startAt: T('2026-10-12T07:00:00Z') }); // Mon Oct 12 00:00 PDT exactly
    await addEvent({ id: 'evt_mon', startAt: T('2026-10-12T07:30:00Z') }); // Mon 00:30
    await addEvent({ id: 'evt_last', startAt: T('2026-10-19T06:59:00Z') }); // Sun Oct 18 23:59 PDT
    await addEvent({ id: 'evt_next', startAt: T('2026-10-19T07:00:00Z') }); // Mon Oct 19 00:00 PDT → next issue
    await addEvent({ id: 'evt_cancelled', status: 'cancelled' });
    await addEvent({ id: 'evt_draft', status: 'draft', cover: null });
    await addEvent({ id: 'evt_archived', status: 'archived' });
    const s = await snap();
    expect(ids(s.events)).toEqual(['evt_first', 'evt_mon', 'evt_last']);
    expect(s).toMatchObject({
      version: 1, isoWeek: W, from: '2026-10-12T07:00:00.000Z', to: '2026-10-19T07:00:00.000Z', previewWeek: '2026-W43',
      sendAfter: '2026-10-12T00:00:00.000Z', origin: ORIGIN, showAttendance: true, preview: [],
    });
  });

  it('DST week (2026-W44, 169 h): Sunday 23:30 PST is in, Monday 00:30 PST is the next issue', async () => {
    await addEvent({ id: 'evt_w43_sun', startAt: T('2026-10-26T06:30:00Z') }); // Sun Oct 25 23:30 PDT
    await addEvent({ id: 'evt_w44_mon', startAt: T('2026-10-26T07:00:00Z') }); // Mon Oct 26 00:00 PDT
    await addEvent({ id: 'evt_w44_sun', startAt: T('2026-11-02T07:30:00Z') }); // Sun Nov 1 23:30 PST (a fixed 168 h would drop it)
    await addEvent({ id: 'evt_w45_mon', startAt: T('2026-11-02T08:30:00Z') }); // Mon Nov 2 00:30 PST
    const w44 = await snap({ isoWeek: '2026-W44' });
    expect(ids(w44.events)).toEqual(['evt_w44_mon', 'evt_w44_sun']);
    expect([w44.from, w44.to]).toEqual(['2026-10-26T07:00:00.000Z', '2026-11-02T08:00:00.000Z']);
    expect(w44.sendAfter).toBe('2026-10-26T00:00:00.000Z');
    const w45 = await snap({ isoWeek: '2026-W45' });
    expect(ids(w45.events)).toEqual(['evt_w45_mon']);
    expect(w45.sendAfter).toBe('2026-11-02T01:00:00.000Z'); // 17:00 PST
  });

  it('maps every field public-safe, in start order with ties by id', async () => {
    await addEvent({
      id: 'evt_full', titleEn: 'Agent Night', titleZh: 'Agent 之夜', noteEn: '  Worth it.\r\nBring a laptop.  ', noteZh: '   ',
      endAt: T('2026-10-15T03:00:00Z'), neighborhood: 'SoMa', venueName: 'Secret Loft', address: '1 Hidden St', addressPublic: true,
      priceText: ' Free ', access: 'apply', hostName: 'Example Labs', sourceUrl: 'https://luma.com/agent-night', featured: true,
      going: 'going', category: 'hackathon',
    });
    await addEvent({ id: 'evt_b', startAt: T('2026-10-14T01:00:00Z'), format: 'online', city: null, sourceUrl: 'https://example.org/e/1' });
    await addEvent({ id: 'evt_a', startAt: T('2026-10-14T01:00:00Z'), format: 'hybrid', city: 'Oakland', neighborhood: null });
    await addEvent({ id: 'evt_ride', category: 'cycling', city: 'Palo Alto', neighborhood: 'Downtown', venueName: 'Cafe', startAt: T('2026-10-16T15:00:00Z') });
    await addEvent({ id: 'evt_zhonly', titleEn: null, titleZh: '只有中文', startAt: T('2026-10-17T18:00:00Z'), priceText: '', eventLanguage: 'zh' });
    const s = await snap();
    expect(ids(s.events)).toEqual(['evt_a', 'evt_b', 'evt_full', 'evt_ride', 'evt_zhonly']);
    expect(s.events[2]).toEqual({
      id: 'evt_full', slug: 'event-evt_full', category: 'hackathon', startAt: '2026-10-15T01:00:00.000Z', endAt: '2026-10-15T03:00:00.000Z',
      tz: 'America/Los_Angeles', allDay: false, format: 'in_person', eventLanguage: 'en', titleEn: 'Agent Night', titleZh: 'Agent 之夜',
      noteEn: 'Worth it.\nBring a laptop.', noteZh: null, place: 'SoMa', priceText: 'Free', access: 'apply',
      sourceUrl: 'https://luma.com/agent-night', platform: 'Luma', coverUrl: `${ORIGIN}/og/template/hackathon?s=192`, coverCredit: null,
      seal: 'going', featured: true,
    });
    const [hybrid, online, , ride, zhOnly] = s.events;
    expect(hybrid.place).toBe('Oakland');
    expect(online).toMatchObject({ place: null, platform: 'example.org', format: 'online' });
    expect(ride.place).toBe('Palo Alto'); // cycling: city only (redactForPublic)
    expect(zhOnly).toMatchObject({ titleEn: '只有中文', titleZh: '只有中文', priceText: null });
    // F19: the event language rides along for the facets (the column default is 'en').
    expect(s.events.map((e) => e.eventLanguage)).toEqual(['en', 'en', 'en', 'en', 'zh']);
    // Nothing private or internal leaks into the frozen content.
    const json = JSON.stringify(s);
    for (const secret of ['1 Hidden St', 'Secret Loft', 'Downtown', 'Cafe', 'blob.test']) expect(json).not.toContain(secret);
  });

  it('is deterministic, JSON-safe and independent of the wall clock', async () => {
    await addEvent({ going: 'going' });
    await addEvent({ startAt: T('2026-10-13T02:00:00Z'), cover: { kind: 'official' }, sourceUrl: 'https://partiful.com/e/1' });
    const row = await issue({ introEn: '  Hi.\r\n\r\nTwo lines.  ', introZh: '' });
    const a = await buildSnapshot(row, { db });
    const b = await buildSnapshot(row, { db, now: T('2027-01-01T00:00:00Z') });
    expect(b).toEqual(a);
    expect(JSON.parse(JSON.stringify(a))).toEqual(a);
    expect([a.introEn, a.introZh]).toEqual(['Hi.\n\nTwo lines.', null]);
  });
});

describe('buildSnapshot: going seals and the kill switch', () => {
  async function seedGoing() {
    await addEvent({ id: 'evt_going', going: 'going' });
    await addEvent({ id: 'evt_hosting', going: 'hosting', sourceUrl: 'https://example.org/own-event' });
    await addEvent({ id: 'evt_speaking', going: 'speaking', sourceUrl: 'https://partiful.com/e/1' });
    await addEvent({ id: 'evt_interested', going: 'interested' });
    await addEvent({ id: 'evt_none', going: 'none' });
    await addEvent({ id: 'evt_after', going: 'going', goingVisibility: 'after_event' });
    await addEvent({ id: 'evt_hidden', going: 'hosting', goingVisibility: 'hidden' });
    await addEvent({ id: 'evt_ride', going: 'going', category: 'cycling' });
    await addEvent({ id: 'evt_unlisted', going: 'going', sourceUrl: 'https://example.org/e/2' }); // auto after_event
    await addEvent({ id: 'evt_private', going: 'going', privateVenue: true });
  }
  const seals = (s: { events: { id: string; seal: string | null }[] }) =>
    Object.fromEntries(s.events.filter((e) => e.seal).map((e) => [e.id, e.seal]));

  it('only public going / hosting / speaking seals, never "interested"', async () => {
    await seedGoing();
    const s = await snap();
    expect(s.showAttendance).toBe(true);
    expect(seals(s)).toEqual({ evt_going: 'going', evt_hosting: 'hosting', evt_speaking: 'speaking' });
  });

  it('settings.show_attendance off ⇒ no seals at all', async () => {
    await seedGoing();
    await setSetting('show_attendance', { on: false });
    const s = await snap();
    expect(s.showAttendance).toBe(false);
    expect(seals(s)).toEqual({});
  });

  it('SHOW_ATTENDANCE=false forces it off at deploy time; a malformed row hides attendance', async () => {
    await seedGoing();
    const row = await issue();
    vi.stubEnv('SHOW_ATTENDANCE', 'false');
    expect((await buildSnapshot(row, { db })).showAttendance).toBe(false);
    vi.stubEnv('SHOW_ATTENDANCE', '');
    await setSetting('show_attendance', {});
    const s = await buildSnapshot(row, { db });
    expect(s.showAttendance).toBe(false);
    expect(seals(s)).toEqual({});
  });

  it('"has it ended" is judged at the issue send time, and "went" never becomes a seal', async () => {
    await addEvent({ id: 'evt_going', going: 'going', endAt: T('2026-10-15T03:00:00Z') });
    const row = await issue();
    expect((await buildSnapshot(row, { db })).events[0].seal).toBe('going'); // send_after null → sendAfterFor(W)
    // Judged at a send time after the event ended (hypothetical), the seal would be "went": not shown.
    const late = await buildSnapshot({ ...row, sendAfter: T('2026-10-16T00:00:00Z') }, { db });
    expect(late.sendAfter).toBe('2026-10-16T00:00:00.000Z');
    expect(late.events[0].seal).toBeNull();
  });
});

describe('buildSnapshot: covers', () => {
  it('Luma official covers become the template unless kept; others use the email cover route', async () => {
    await addEvent({ id: 'evt_luma', cover: { kind: 'official', attribution: 'Cover: Example Labs via Luma' } });
    await addEvent({ id: 'evt_kept', cover: { kind: 'official', attribution: 'Cover: Kept Host via Luma' } });
    await addEvent({ id: 'evt_comp', cover: { kind: 'host_composite', attribution: 'Host photos via Luma' }, category: 'vc' });
    await addEvent({ id: 'evt_partiful', cover: { kind: 'official' }, hostName: 'Pier Club', sourceUrl: 'https://partiful.com/e/9' });
    await addEvent({ id: 'evt_upload', cover: { kind: 'upload' } });
    await addEvent({ id: 'evt_tpl', category: 'social', hostName: 'Someone' });
    const s = await snap({ keepCoverIds: ['evt_kept'] });
    const by = Object.fromEntries(s.events.map((e) => [e.id, [e.coverUrl, e.coverCredit]]));
    expect(by).toEqual({
      evt_luma: [`${ORIGIN}/og/template/ai?s=192`, null],
      evt_kept: [`${ORIGIN}/og/email-cover/cov_kept`, 'Cover: Kept Host via Luma'],
      evt_comp: [`${ORIGIN}/og/template/vc?s=192`, null],
      evt_partiful: [`${ORIGIN}/og/email-cover/cov_partiful`, 'Cover: Pier Club via Partiful'],
      evt_upload: [`${ORIGIN}/og/email-cover/cov_upload`, null],
      evt_tpl: [`${ORIGIN}/og/template/social?s=192`, null],
    });
    for (const e of s.events) expect(e.coverUrl).toMatch(/^https:\/\/picks\.test\/og\//);
  });

  it('Openverse covers carry their page and deed into the snapshot; other covers add no keys', async () => {
    await addEvent({
      id: 'evt_ov', cover: {
        kind: 'openverse', attribution: '"Bridge" by A. Person · CC BY 2.0', license: 'by/2.0', sourcePageUrl: 'https://www.flickr.example/photos/a/1',
      },
    });
    await addEvent({ id: 'evt_partiful', cover: { kind: 'official', sourcePageUrl: 'https://partiful.com/e/9' }, sourceUrl: 'https://partiful.com/e/9' });
    await addEvent({ id: 'evt_tpl' });
    const s = await snap();
    const by = Object.fromEntries(s.events.map((e) => [e.id, e]));
    expect(by.evt_ov).toMatchObject({
      coverUrl: `${ORIGIN}/og/email-cover/cov_ov`, coverCredit: '"Bridge" by A. Person · CC BY 2.0',
      coverSourceUrl: 'https://www.flickr.example/photos/a/1', coverLicenseUrl: 'https://creativecommons.org/licenses/by/2.0/',
    });
    for (const e of [by.evt_partiful, by.evt_tpl]) {
      expect(e).not.toHaveProperty('coverSourceUrl');
      expect(e).not.toHaveProperty('coverLicenseUrl');
    }
  });

  it('official_covers_to_template sends every official cover to the template, kept or not', async () => {
    await addEvent({ id: 'evt_kept', cover: { kind: 'official' } });
    await addEvent({ id: 'evt_partiful', cover: { kind: 'official' }, sourceUrl: 'https://partiful.com/e/9' });
    await addEvent({ id: 'evt_upload', cover: { kind: 'upload' } });
    await setSetting('official_covers_to_template', { on: true });
    const s = await snap({ keepCoverIds: ['evt_kept'] });
    expect(s.events.map((e) => e.coverUrl)).toEqual([
      `${ORIGIN}/og/template/ai?s=192`, `${ORIGIN}/og/template/ai?s=192`, `${ORIGIN}/og/email-cover/cov_upload`,
    ]);
  });

  it('lumaCoverChoices lists the keepable Luma covers of the covered week only (the preview shows no covers)', async () => {
    await addEvent({ id: 'evt_luma', cover: { kind: 'official' } });
    await addEvent({ id: 'evt_comp', cover: { kind: 'host_composite' }, startAt: T('2026-10-13T01:00:00Z') });
    await addEvent({ id: 'evt_partiful', cover: { kind: 'official' }, sourceUrl: 'https://partiful.com/e/9' });
    await addEvent({ id: 'evt_tpl' });
    await addEvent({ id: 'evt_preview', cover: { kind: 'official' }, startAt: NEXT_WED });
    await addEvent({ id: 'evt_not_featured', cover: { kind: 'official' }, startAt: NEXT_WED });
    const row = await issue({ keepCoverIds: ['evt_luma'], featuredIds: ['evt_preview'] });
    const list = await lumaCoverChoices(row, { db });
    expect(list.map((x) => [x.id, x.kept])).toEqual([
      ['evt_comp', false],
      ['evt_luma', true],
    ]);
    expect(list[0]).toEqual({
      id: 'evt_comp', slug: 'event-evt_comp', titleEn: 'Event evt_comp', titleZh: '活动 evt_comp', startAt: '2026-10-13T01:00:00.000Z', kept: false,
    });
    await setSetting('official_covers_to_template', { on: true });
    expect(await lumaCoverChoices(row, { db })).toEqual([]);
  });

  it('a Luma cover on an event whose link was edited to the host’s page still falls back and is listed', async () => {
    await addEvent({
      id: 'evt_moved', sourceUrl: 'https://host.example/register',
      cover: { kind: 'official', attribution: 'Cover: Host via Luma', sourcePageUrl: 'https://luma.com/moved' },
    });
    const row = await issue();
    const s = await buildSnapshot(row, { db });
    expect([s.events[0].coverUrl, s.events[0].coverCredit, s.events[0].platform]).toEqual([`${ORIGIN}/og/template/ai?s=192`, null, 'host.example']);
    expect((await lumaCoverChoices(row, { db })).map((x) => x.id)).toEqual(['evt_moved']);
    const kept = await buildSnapshot({ ...row, keepCoverIds: ['evt_moved'] }, { db });
    expect([kept.events[0].coverUrl, kept.events[0].coverCredit]).toEqual([`${ORIGIN}/og/email-cover/cov_moved`, 'Cover: Host via Luma']);
  });
});

describe('buildSnapshot: next-week preview', () => {
  it('only the issue’s featured ids, still published and starting in the following week', async () => {
    await addEvent({ id: 'evt_p2', startAt: T('2026-10-23T01:00:00Z'), featured: true });
    await addEvent({ id: 'evt_p1', startAt: NEXT_WED, featured: true });
    await addEvent({ id: 'evt_picked', startAt: T('2026-10-24T18:00:00Z') }); // not events.featured, but Victor picked it
    await addEvent({ id: 'evt_draft', startAt: NEXT_WED, status: 'draft', cover: null, featured: true });
    await addEvent({ id: 'evt_cancelled', startAt: NEXT_WED, status: 'cancelled', featured: true });
    await addEvent({ id: 'evt_this_week', featured: true });
    await addEvent({ id: 'evt_w44', startAt: T('2026-10-28T01:00:00Z'), featured: true });
    await addEvent({ id: 'evt_unpicked', startAt: NEXT_WED, featured: true });
    const s = await snap({
      featuredIds: ['evt_p2', 'evt_picked', 'evt_draft', 'evt_cancelled', 'evt_this_week', 'evt_w44', 'evt_missing', 'evt_p1'],
    });
    expect(ids(s.preview)).toEqual(['evt_p1', 'evt_p2', 'evt_picked']);
    expect(ids(s.events)).toEqual(['evt_this_week']); // the preview never leaks into the week, nor the reverse
    expect(s.preview[0]).toMatchObject({ featured: true, coverUrl: `${ORIGIN}/og/template/ai?s=192` });
  });
});

describe('issue lifecycle', () => {
  it('ensureIssue creates a draft with next week’s featured events, once', async () => {
    await addEvent({ id: 'evt_f2', startAt: T('2026-10-23T01:00:00Z'), featured: true });
    await addEvent({ id: 'evt_f1', startAt: NEXT_WED, featured: true });
    await addEvent({ id: 'evt_plain', startAt: NEXT_WED });
    await addEvent({ id: 'evt_fdraft', startAt: NEXT_WED, featured: true, status: 'draft', cover: null });
    await addEvent({ id: 'evt_fcancel', startAt: NEXT_WED, featured: true, status: 'cancelled' });
    await addEvent({ id: 'evt_fweek', featured: true }); // in the covered week, not the preview week
    const row = await ensureIssue(W, { db });
    expect(row).toMatchObject({ isoWeek: W, status: 'draft', featuredIds: ['evt_f1', 'evt_f2'], sendAfter: null, snapshot: null });
    expect(row.id).toMatch(/^dig_[0-9a-z]{16}$/);
    // Later calls return the same row; the preview list is not recomputed.
    await db.update(events).set({ featured: false }).where(eq(events.id, 'evt_f1'));
    expect(await ensureIssue(W, { db })).toEqual(row);
    expect(await getIssueByWeek(W, { db })).toEqual(row);
    expect(await getIssue(row.id, { db })).toEqual(row);
    expect(await getIssue('dig_nope', { db })).toBeNull();
    expect(await getIssueByWeek('2026-W43', { db })).toBeNull();
  });

  it('concurrent ensureIssue calls make one row', async () => {
    const rows = await Promise.all([ensureIssue(W, { db }), ensureIssue(W, { db }), ensureIssue(W, { db })]);
    expect(new Set(rows.map((r) => r.id)).size).toBe(1);
    expect(await db.select().from(digestIssues)).toHaveLength(1);
  });

  it('ensureIssue rejects malformed or impossible weeks', async () => {
    await expect(ensureIssue('2027-W53', { db })).rejects.toThrow();
    await expect(ensureIssue('next week', { db })).rejects.toThrow();
  });

  it('saveIssue cleans intros, keeps only valid featured and kept-cover ids, and leaves untouched fields alone', async () => {
    await addEvent({ id: 'evt_week' });
    await addEvent({ id: 'evt_next', startAt: NEXT_WED });
    await addEvent({ id: 'evt_next_draft', startAt: NEXT_WED, status: 'draft', cover: null });
    await addEvent({ id: 'evt_far', startAt: T('2026-10-29T01:00:00Z') });
    const row = await ensureIssue(W, { db });
    const long = `${'长'.repeat(INTRO_MAX - 1)}😀😀`;
    const saved = await saveIssue(
      row.id,
      {
        introEn: '  Hello there.\r\nSecond line.  ', introZh: long,
        featuredIds: ['evt_next', 'evt_week', 'evt_next_draft', 'evt_far', 'evt_ghost', 'evt_next', 42 as never],
        keepCoverIds: ['evt_week', 'evt_next', 'evt_far', ' evt_week '],
        autoFields: ['intro_zh', 'intro_zh', ''],
      },
      { db },
    );
    expect(saved).toMatchObject({
      // Kept covers: covered week only (evt_next is in the preview, which shows no covers).
      introEn: 'Hello there.\nSecond line.', featuredIds: ['evt_next'], keepCoverIds: ['evt_week'], autoFields: ['intro_zh'],
    });
    expect(Array.from(saved!.introZh!)).toHaveLength(INTRO_MAX);
    expect(saved!.introZh!.endsWith('😀')).toBe(true); // capped by characters, no broken surrogate pair

    const partial = await saveIssue(row.id, { introZh: '   ', autoFields: [] }, { db });
    expect(partial).toMatchObject({ introEn: 'Hello there.\nSecond line.', introZh: null, autoFields: [], featuredIds: ['evt_next'] });
    expect(await saveIssue(row.id, {}, { db })).toEqual(partial);
    expect(await saveIssue('dig_nope', { introEn: 'x' }, { db })).toBeNull();
  });

  it('only drafts can be edited', async () => {
    const row = await issue({ introEn: 'Hi', introZh: '你好', status: 'scheduled', sendAfter: sendAfterFor(W) });
    expect(await saveIssue(row.id, { introEn: 'Changed' }, { db })).toBeNull();
    expect((await reload(row.id)).introEn).toBe('Hi');
  });

  it('cleanIntro', () => {
    expect(cleanIntro(null)).toBeNull();
    expect(cleanIntro(' \r\n ')).toBeNull();
    expect(cleanIntro('a\rb')).toBe('a\nb');
    expect(cleanIntro(`${'x'.repeat(INTRO_MAX)}   tail`)).toHaveLength(INTRO_MAX);
  });

  describe('scheduleIssue', () => {
    const BEFORE = T('2026-10-08T12:00:00Z');
    const ready = (over: Partial<typeof digestIssues.$inferInsert> = {}) => issue({ introEn: 'This week.', introZh: '本周。', ...over });

    it('draft → scheduled at the Sunday 17:00 PT before the week', async () => {
      const row = await ready();
      const r = await scheduleIssue(row.id, { db, now: BEFORE });
      expect(r).toEqual({ ok: true, sendAfter: T('2026-10-12T00:00:00Z') });
      expect(await reload(row.id)).toMatchObject({ status: 'scheduled', sendAfter: T('2026-10-12T00:00:00Z') });
      expect(await scheduleIssue(row.id, { db, now: BEFORE })).toEqual({ ok: false, error: 'not_draft' });
    });

    it('needs both intros, approved', async () => {
      const noZh = await ready({ introZh: null, isoWeek: '2026-W43' });
      expect(await scheduleIssue(noZh.id, { db, now: BEFORE })).toEqual({ ok: false, error: 'intro_missing' });
      const blankEn = await ready({ introEn: ' \n ', isoWeek: '2026-W44' });
      expect(await scheduleIssue(blankEn.id, { db, now: BEFORE })).toEqual({ ok: false, error: 'intro_missing' });
      const auto = await ready({ autoFields: ['intro_zh'] });
      expect(await scheduleIssue(auto.id, { db, now: BEFORE })).toEqual({ ok: false, error: 'unapproved' });
      expect((await reload(auto.id)).status).toBe('draft');
      await saveIssue(auto.id, { autoFields: [] }, { db });
      expect((await scheduleIssue(auto.id, { db, now: BEFORE })).ok).toBe(true);
    });

    it('can still be scheduled late inside the send window, not after it', async () => {
      const limit = sendAfterFor(W).getTime() + LATE_LIMIT_MS; // Tue Oct 13 03:00Z (Mon 20:00 PDT)
      const row = await ready();
      expect(await scheduleIssue(row.id, { db, now: new Date(limit) })).toEqual({ ok: false, error: 'too_late' });
      expect((await reload(row.id)).status).toBe('draft');
      expect(await scheduleIssue(row.id, { db, now: new Date(limit - 1) })).toMatchObject({ ok: true });
    });

    it('refuses unknown, sending and sent issues', async () => {
      expect(await scheduleIssue('dig_nope', { db, now: BEFORE })).toEqual({ ok: false, error: 'not_draft' });
      const sending = await ready({ status: 'sending', sendAfter: sendAfterFor(W) });
      expect(await scheduleIssue(sending.id, { db, now: BEFORE })).toEqual({ ok: false, error: 'not_draft' });
      const sent = await ready({ isoWeek: '2026-W41', status: 'sent' });
      expect(await scheduleIssue(sent.id, { db, now: BEFORE })).toEqual({ ok: false, error: 'not_draft' });
    });

    it('two schedules at once: exactly one wins', async () => {
      const row = await ready();
      const rs = await Promise.all([scheduleIssue(row.id, { db, now: BEFORE }), scheduleIssue(row.id, { db, now: BEFORE })]);
      expect(rs.filter((r) => r.ok)).toHaveLength(1);
      expect(rs.filter((r) => !r.ok)).toEqual([{ ok: false, error: 'not_draft' }]);
    });
  });

  it('unscheduleIssue: scheduled → draft only', async () => {
    const row = await issue({ introEn: 'a', introZh: 'b', status: 'scheduled', sendAfter: sendAfterFor(W) });
    expect(await unscheduleIssue(row.id, { db })).toBe(true);
    expect(await reload(row.id)).toMatchObject({ status: 'draft', sendAfter: null });
    expect(await unscheduleIssue(row.id, { db })).toBe(false);
    const sending = await issue({ isoWeek: '2026-W43', status: 'sending', sendAfter: sendAfterFor('2026-W43') });
    expect(await unscheduleIssue(sending.id, { db })).toBe(false);
    expect((await reload(sending.id)).status).toBe('sending');
    expect(await unscheduleIssue('dig_nope', { db })).toBe(false);
  });
});

describe('listIssues', () => {
  it('newest covered week first, with send counts and without the snapshot', async () => {
    const subs = await db
      .insert(subscribers)
      .values(Array.from({ length: 6 }, (_, i) => ({ id: `sub_${i}`, email: `r${i}@example.org`, status: 'active' as const })))
      .returning();
    const old = await issue({ isoWeek: '2026-W40', status: 'sent', snapshot: { big: 'x'.repeat(1000) } });
    const mid = await issue({ isoWeek: '2026-W41', status: 'sending' });
    const fresh = await issue({ isoWeek: '2026-W42' });
    const row = (s: number, over: Partial<typeof digestSends.$inferInsert> = {}) => ({
      issueId: mid.id, subscriberId: subs[s].id, variantKey: 'en:ai', ...over,
    });
    await db.insert(digestSends).values([
      row(0, { resendId: 're_1', sentAt: T('2026-10-05T01:00:00Z') }),
      row(1, { resendId: 'dev', sentAt: T('2026-10-05T01:00:00Z'), kind: 'empty' }),
      row(2, { resendId: 're_3', error: 'failed:bounce' }),
      row(3, { error: 'expired' }),
      row(4), // claimed, pending
      { ...row(5), issueId: old.id, resendId: 're_9' },
    ]);
    const list = await listIssues(8, { db });
    expect(list.map((i) => [i.isoWeek, i.counts])).toEqual([
      [W, { sent: 0, failed: 0, claimed: 0 }],
      ['2026-W41', { sent: 2, failed: 2, claimed: 5 }],
      ['2026-W40', { sent: 1, failed: 0, claimed: 1 }],
    ]);
    expect(list[0]).not.toHaveProperty('snapshot');
    expect(list[0].id).toBe(fresh.id);
    expect((await listIssues(2, { db })).map((i) => i.isoWeek)).toEqual([W, '2026-W41']);
  });
});

describe('audience', () => {
  const now = T('2026-10-10T12:00:00Z');
  let n = 0;
  const sub = (over: Partial<typeof subscribers.$inferInsert>) =>
    db.insert(subscribers).values({ id: `sub_${++n}`, email: `p${n}@example.org`, status: 'active', locale: 'en', categories: ['ai'], ...over });

  it('counts eligible subscribers per variant: expired pauses count; pending, unsubscribed, suppressed and empty rows do not', async () => {
    await sub({ categories: ['ai', 'hackathon'] });
    await sub({ categories: ['hackathon', 'ai'] }); // same set, other order
    await sub({ categories: ['ai', 'hackathon', 'ai', 'bogus'] }); // duplicates and unknown slugs normalise away
    await sub({ status: 'paused', pausedUntil: T('2026-10-09T00:00:00Z'), categories: ['ai', 'hackathon'] }); // pause over
    await sub({ status: 'paused', pausedUntil: now, categories: ['ai', 'hackathon'] }); // ends exactly now
    await sub({ status: 'paused', pausedUntil: null, categories: ['vc'] }); // no end date: counts (prefs shows it as active)
    await sub({ status: 'paused', pausedUntil: T('2026-11-01T00:00:00Z') }); // still paused
    await sub({ status: 'pending' });
    await sub({ status: 'unsubscribed' });
    await sub({ status: 'suppressed' });
    await sub({ categories: [] });
    await sub({ categories: ['bogus'] });
    await sub({ locale: 'zh', categories: ['social', 'ai'] });
    await sub({ locale: 'zh', categories: ['ai', 'social'] });
    await sub({ locale: 'zh', categories: ['ai'] });
    const list = await audience({ db, now });
    expect(list.map((a) => [a.variant.key, a.count])).toEqual([
      ['en:ai,hackathon', 5],
      ['zh:ai,social', 2],
      ['en:vc', 1],
      ['zh:ai', 1],
    ]);
    expect(list[1].variant).toEqual({ key: 'zh:ai,social', locale: 'zh', categories: ['ai', 'social'], evLang: null, onlineOnly: false });
    expect(JSON.stringify(list)).not.toContain('@');
  });

  it('F19: groups by facets too, normalising stored shapes the digest reads as none (as the claim does)', async () => {
    await sub({});
    await sub({ evLangPref: ['xx'] }); // unknown: no preference
    await sub({ evLangPref: ['en', 'zh'], onlineOnly: false }); // two values: no preference
    await sub({ evLangPref: [], onlineOnly: null });
    await sub({ evLangPref: ['zh'] });
    await sub({ evLangPref: ['zh'], categories: ['ai', 'bogus'] });
    await sub({ evLangPref: ['zh'], onlineOnly: true });
    await sub({ onlineOnly: true, locale: 'zh', categories: ['vc', 'ai'] });
    const list = await audience({ db, now });
    expect(list.map((a) => [a.variant.key, a.count])).toEqual([
      ['en:ai', 4],
      ['en:ai;l=zh', 2],
      ['en:ai;l=zh;o', 1],
      ['zh:ai,vc;o', 1],
    ]);
    expect(list[2].variant).toEqual({ key: 'en:ai;l=zh;o', locale: 'en', categories: ['ai'], evLang: 'zh', onlineOnly: true });
  });

  it('is empty without subscribers', async () => {
    expect(await audience({ db, now })).toEqual([]);
  });

  it('eligibleSubscriber (shared with the sending claim) is the same rule', async () => {
    await sub({ id: 'sub_active' });
    await sub({ id: 'sub_paused_over', status: 'paused', pausedUntil: T('2026-10-01T00:00:00Z') });
    await sub({ id: 'sub_paused', status: 'paused', pausedUntil: T('2026-10-11T00:00:00Z') });
    await sub({ id: 'sub_none', categories: [] });
    await sub({ id: 'sub_unknown', categories: ['bogus'] });
    await sub({ id: 'sub_mixed', categories: ['bogus', 'vc'] });
    await sub({ id: 'sub_gone', status: 'unsubscribed' });
    const rows = await db.select({ id: subscribers.id }).from(subscribers).where(issuesMod.eligibleSubscriber(now));
    expect(rows.map((r) => r.id).sort()).toEqual(['sub_active', 'sub_mixed', 'sub_paused_over']);
  });
});
