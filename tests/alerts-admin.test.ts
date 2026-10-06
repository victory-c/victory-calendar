import { load } from 'cheerio';
import { eq } from 'drizzle-orm';
import { createElement, isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { testDb } from './helpers/pglite';

// F20 admin side (DESIGN-F20 G5, G15): the going actions pass Victor's "Alert subscribers" switch
// to setGoing and say whether an alert was queued; the editor's switch shows only for a public
// going / hosting / speaking. Real setGoing and going_marks on PGlite.

const h = vi.hoisted(() => ({ db: null as unknown, admin: true, tags: [] as string[], refreshed: 0 }));
vi.mock('@/lib/db', async (orig) => ({ ...(await orig()), db: new Proxy({}, { get: (_t, p) => Reflect.get(h.db as object, p) }), hasDatabase: () => true }));
vi.mock('@/lib/admin-session', () => ({
  requireAdmin: async () => {
    if (!h.admin) throw new Error('NEXT_REDIRECT /admin/sign-in');
    return { user: { email: 'v@example.org' } };
  },
}));
vi.mock('next/cache', () => ({ refresh: () => void h.refreshed++, updateTag: (t: string) => void h.tags.push(t), revalidateTag: () => {} }));
vi.mock('next/server', async (orig) => ({ ...(await orig()), after: () => {} }));

const { editorAction, markGoing, quickAction, saveGoing } = await import('@/app/admin/actions');
const { setCandidateGoing } = await import('@/app/admin/inbox-actions');
const msg = await import('@/lib/admin/going-message');
const { GoingForm, goingFieldsKey } = await import('@/components/admin/GoingForm');
const { EditorShell } = await import('@/components/admin/EditorShell');
const { default: EditPage } = await import('@/app/admin/(app)/e/[id]/page');
const { QuickGoing } = await import('@/components/admin/QuickGoing');
const { candidates, covers, digestIssues, events, goingMarks } = await import('@/lib/db/schema');
const { templateCoverRow } = await import('@/lib/covers/template');
const { upsertCandidate, markAdded } = await import('@/lib/inbox/candidates');
const { writeSetting } = await import('@/lib/settings');
type DB = import('@/lib/db').DB;

const db = () => h.db as DB;
const DAY = 864e5;
const QUEUED = 'Saved · 已保存 · Alert goes out next morning ~8 AM PT (Monday if Sunday has a digest) · 明早约 8 点发提醒（周日发周报的话改到周一）';
const IN_DIGEST = "Saved · 已保存 · In Sunday's digest, no separate alert · 周日周报里会有，不另发提醒";
const PAUSED = 'Saved · 已保存 · Alerts are paused: this mark is kept and goes out if alerts resume within 7 days · 会去提醒暂停中：标记已保存，7 天内恢复会发出';

beforeEach(async () => {
  h.db = (await testDb()).db;
  h.admin = true;
  h.tags = [];
  h.refreshed = 0;
  // Local / CI: alerts run in 'dev' mode unless switched off.
  vi.stubEnv('VERCEL', '');
  vi.stubEnv('ALERTS_SENDING', '');
  vi.stubEnv('DIGEST_SENDING', '');
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

/** A published, publicly listable event ten days out (the next alert run can mail it), not marked yet. */
async function seed(over: Partial<typeof events.$inferInsert> = {}) {
  const id = over.id ?? 'evt_alert000000001';
  const coverId = `cov_${id.slice(4)}`;
  await db().insert(covers).values({ id: coverId, ...templateCoverRow('ai', null) });
  await db().insert(events).values({
    id, slug: `slug-${id}`, status: 'published', sourceUrl: 'https://luma.com/abcd1234', titleEn: 'Agent Night', titleZh: 'Agent 之夜',
    category: 'ai', startAt: new Date(Date.now() + 10 * DAY), tz: 'America/Los_Angeles', city: 'San Francisco', format: 'in_person',
    noteEn: 'Worth it.', going: 'none', goingVisibility: 'public', publishedAt: new Date(), coverId, ...over,
  });
  return id;
}
const mark = async (id: string) => (await db().select().from(goingMarks).where(eq(goingMarks.eventId, id)))[0] ?? null;
const form = (fields: [string, string][]) => {
  const fd = new FormData();
  for (const [k, v] of fields) fd.append(k, v);
  return fd;
};
/** What GoingForm posts: the selects, and with the switch shown a hidden off plus the box when ticked. */
const goingForm = (going: string, visibility: string, alert?: boolean) =>
  form([['going', going], ['visibility', visibility], ...(alert === undefined ? [] : ([['alert', 'off'], ...(alert ? [['alert', 'on']] : [])] as [string, string][]))]);

describe('saveGoing', () => {
  it('a public going with the switch on queues an alert and says when it goes out', async () => {
    const id = await seed();
    expect(await saveGoing(id, null, goingForm('going', 'public', true))).toEqual({ ok: true, message: QUEUED });
    expect(await mark(id)).toMatchObject({ eventId: id, alert: true });
    expect(h.tags).toContain('events');
  });

  it('hosting and speaking alert too', async () => {
    for (const going of ['hosting', 'speaking']) {
      const id = await seed({ id: `evt_${going.padEnd(16, '0')}` });
      expect((await saveGoing(id, null, goingForm(going, 'public', true)))?.message).toBe(QUEUED);
      expect((await mark(id))?.alert).toBe(true);
    }
  });

  it('the switch off: saved, no alert, and the mark says so', async () => {
    const id = await seed();
    expect(await saveGoing(id, null, goingForm('going', 'public', false))).toEqual({ ok: true, message: 'Saved · 已保存 · No alert · 不发提醒' });
    expect(await mark(id)).toMatchObject({ alert: false });
  });

  it('no switch in the form (any other caller): the default, on', async () => {
    const id = await seed();
    expect((await saveGoing(id, null, goingForm('going', 'public')))?.message).toBe(QUEUED);
    expect((await mark(id))?.alert).toBe(true);
  });

  it('a downgraded going: no alert, shown after the event, with the reason', async () => {
    const id = await seed({ sourceUrl: 'https://example.org/meetup' });
    expect(await saveGoing(id, null, goingForm('going', 'public', true))).toEqual({
      ok: true,
      message: 'No alert (shown after the event) · 不发提醒（活动后公开：不在 Luma、Partiful、Eventbrite、Meetup 上）',
    });
    expect(await mark(id)).toBeNull();
    expect((await db().select().from(events).where(eq(events.id, id)))[0].goingVisibility).toBe('after_event');
  });

  it('after the event by choice: no alert, and the line says why', async () => {
    const id = await seed();
    expect((await saveGoing(id, null, goingForm('going', 'after_event')))?.message).toBe('Saved · 已保存 · No alert (shown after the event) · 不发提醒（活动后公开）');
    expect(await mark(id)).toBeNull();
  });

  it('interested, hidden or none: just saved, no mark', async () => {
    const id = await seed();
    for (const [going, vis] of [['interested', 'public'], ['going', 'hidden'], ['none', 'public']]) {
      expect((await saveGoing(id, null, goingForm(going, vis)))?.message).toBe('Saved · 已保存');
    }
    expect(await mark(id)).toBeNull();
  });

  it('sending off (no verified sender on Vercel, or ALERTS_SENDING=0): paused, the mark kept for a resume within 7 days', async () => {
    vi.stubEnv('ALERTS_SENDING', '0');
    const id = await seed();
    expect((await saveGoing(id, null, goingForm('going', 'public', true)))?.message).toBe(PAUSED);
    // What the line says: the mark is kept with the alert on, so it goes out if sending resumes.
    expect(await mark(id)).toMatchObject({ alert: true });
    vi.stubEnv('ALERTS_SENDING', '');
    vi.stubEnv('VERCEL', '1');
    const other = await seed({ id: 'evt_alert000000002' });
    const line = (await saveGoing(other, null, goingForm('going', 'public', true)))?.message;
    expect(line).toBe(PAUSED);
    expect(line).not.toMatch(/nothing is sent|不会发出/);
  });

  it('a Saturday mark of an event early next week, with a Sunday digest scheduled: in the digest, no alert promised', async () => {
    // Sat 2026-10-10 11:00 PDT; the W42 digest goes out Sun 10-11 17:00 PDT, so Sunday's run sends no
    // alerts and Monday's only alerts events from Tuesday on.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-10T18:00:00Z'));
    await db().insert(digestIssues).values({ id: 'dig_0000000000000042', isoWeek: '2026-W42', status: 'scheduled', sendAfter: new Date('2026-10-12T00:00:00Z') });
    const monday = await seed({ startAt: new Date('2026-10-13T01:00:00Z') }); // Mon 10-12 18:00 PDT
    const line = (await saveGoing(monday, null, goingForm('going', 'public', true)))?.message;
    expect(line).toBe(IN_DIGEST);
    expect(line).not.toMatch(/Monday|周一|next morning|明早/);
    // Later in the digest's week: still carried by Sunday's digest, not promised as an alert.
    const thursday = await seed({ id: 'evt_alert000000004', startAt: new Date('2026-10-16T01:00:00Z') });
    expect((await saveGoing(thursday, null, goingForm('going', 'public', true)))?.message).toBe(IN_DIGEST);
    // After the digest's week: an alert, queued as usual (it goes out with Monday's run).
    const after = await seed({ id: 'evt_alert000000005', startAt: new Date('2026-10-20T01:00:00Z') });
    expect((await saveGoing(after, null, goingForm('going', 'public', true)))?.message).toBe(QUEUED);
  });

  it('the switch re-ticked after a decline turns the alert back on; a save with no switch posted leaves the decline', async () => {
    const id = await seed();
    await saveGoing(id, null, goingForm('going', 'public', false));
    expect((await saveGoing(id, null, goingForm('going', 'public')))?.message).toBe('Saved · 已保存');
    expect((await mark(id))?.alert).toBe(false);
    expect((await saveGoing(id, null, goingForm('going', 'public', true)))?.message).toBe(QUEUED);
    expect((await mark(id))?.alert).toBe(true);
  });

  it('an event too soon for the next run, or a draft: saved, and no promise of an email', async () => {
    const soon = await seed({ startAt: new Date(Date.now() + 3 * 3600_000) });
    expect((await saveGoing(soon, null, goingForm('going', 'public', true)))?.message).toBe('Saved · 已保存 · Too soon for an alert · 活动太近，不发提醒');
    const draft = await seed({ id: 'evt_alert000000003', status: 'draft' });
    expect((await saveGoing(draft, null, goingForm('going', 'public', true)))?.message).toBe('Saved · 已保存');
  });

  it('refuses bad values and needs the admin session', async () => {
    const id = await seed();
    expect(await saveGoing(id, null, goingForm('went', 'public'))).toEqual({ ok: false, message: 'bad value' });
    expect(await saveGoing(id, null, goingForm('going', 'everyone'))).toEqual({ ok: false, message: 'bad value' });
    h.admin = false;
    await expect(saveGoing(id, null, goingForm('going', 'public', true))).rejects.toThrow('NEXT_REDIRECT');
    expect(await mark(id)).toBeNull();
  });
});

describe('list and inbox going buttons (no switch: default on)', () => {
  it('quickAction going records an alert mark with the switch on; it stays a plain form action', async () => {
    const id = await seed();
    expect(await quickAction(id, 'going')).toBeUndefined();
    expect(await mark(id)).toMatchObject({ alert: true });
  });

  it('a list going button never turns an alert Victor declined back on (no switch: not his explicit choice)', async () => {
    const id = await seed();
    await saveGoing(id, null, goingForm('going', 'public', false));
    expect(await markGoing(id, 'going', null)).toEqual({ ok: true, message: 'Saved · 已保存' });
    await quickAction(id, 'going');
    expect((await mark(id))?.alert).toBe(false);
  });

  it('quickAction going follows the default visibility setting: after the event means no alert', async () => {
    await writeSetting('going_visibility_default', { v: 'after_event' });
    const id = await seed();
    await quickAction(id, 'going');
    expect(await mark(id)).toBeNull();
  });

  it('markGoing (the Live toggle with a status line) says whether an alert was queued', async () => {
    const id = await seed();
    expect(await markGoing(id, 'going', null)).toEqual({ ok: true, message: QUEUED });
    expect(await markGoing(id, 'interested', null)).toEqual({ ok: true, message: 'Saved · 已保存' });
    expect(await markGoing(id, 'hosting' as 'going', null)).toEqual({ ok: false, message: 'bad value' });
    h.admin = false;
    await expect(markGoing(id, 'going', null)).rejects.toThrow('NEXT_REDIRECT');
  });

  it('setCandidateGoing on a row already added as a published event queues the alert and says so', async () => {
    const id = await seed();
    const c = await upsertCandidate(
      {
        sourceKind: 'gcal', sourceRef: 'uid-1', providerKey: null, icalUid: 'uid-1', title: 'Agent Night', startAt: new Date(Date.now() + 10 * DAY),
        endAt: null, location: null, links: ['https://luma.com/abcd1234'], snippet: null,
      },
      { db: db() },
    );
    await markAdded(c!.id, id, db());
    expect(await setCandidateGoing(c!.id, 'going')).toEqual({ ok: true, message: QUEUED });
    expect(await mark(id)).toMatchObject({ alert: true });
    expect((await db().select().from(candidates).where(eq(candidates.id, c!.id)))[0].eventId).toBe(id);
  });
});

describe('editorAction publish', () => {
  it('publishing a draft already marked publicly going queues its alert and says so', async () => {
    const id = await seed({ status: 'draft', going: 'going', goingVisibility: 'public', publishedAt: null });
    const r = await editorAction(id, null, form([['_op', 'publish']]));
    expect(r).toEqual({ ok: true, message: 'Published · 已发布 · Alert goes out next morning ~8 AM PT (Monday if Sunday has a digest) · 明早约 8 点发提醒（周日发周报的话改到周一）' });
    expect(await mark(id)).toMatchObject({ alert: true });
  });

  it('publishing on a Saturday before a Sunday digest, for an event early next week: in the digest', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-10T18:00:00Z'));
    await db().insert(digestIssues).values({ id: 'dig_0000000000000042', isoWeek: '2026-W42', status: 'scheduled', sendAfter: new Date('2026-10-12T00:00:00Z') });
    const id = await seed({ status: 'draft', going: 'going', goingVisibility: 'public', publishedAt: null, startAt: new Date('2026-10-13T01:00:00Z') });
    expect(await editorAction(id, null, form([['_op', 'publish']]))).toEqual({ ok: true, message: "Published · 已发布 · In Sunday's digest, no separate alert · 周日周报里会有，不另发提醒" });
  });

  it('publishing an event nobody marked: just published', async () => {
    const id = await seed({ status: 'draft', publishedAt: null });
    expect(await editorAction(id, null, form([['_op', 'publish']]))).toEqual({ ok: true, message: 'Published · 已发布' });
    expect(await mark(id)).toBeNull();
  });
});

describe('goingSavedMessage / alertWanted', () => {
  const r = (over: Partial<import('@/lib/admin/going-message').GoingSaved> = {}) => ({ going: 'going', visibility: 'public', reason: null, alert: 'none' as const, ...over });
  it('while alerts are paused, an unticked switch or a start too close never claims the mark will go out', () => {
    const now = new Date('2026-10-07T18:00:00Z'); // Wed 11:00 PDT
    const later = new Date('2026-10-12T01:00:00Z'); // Sun 10-11 18:00 PDT
    const tomorrow = new Date('2026-10-09T01:00:00Z'); // Thu 10-08 18:00 PDT
    expect(msg.goingSavedMessage(r({ startAt: later }), { wanted: true, mode: 'off', now })).toBe(`Saved · 已保存 · ${msg.ALERTS_OFF}`);
    expect(msg.goingSavedMessage(r({ startAt: later }), { wanted: false, mode: 'off', now })).toBe('Saved · 已保存 · No alert · 不发提醒');
    expect(msg.goingSavedMessage(r({ startAt: tomorrow }), { wanted: true, mode: 'off', now })).toBe(`Saved · 已保存 · ${msg.TOO_SOON}`);
    expect(msg.goingSavedMessage(r({ startAt: tomorrow }), { wanted: true, mode: 'live', now })).toBe(`Saved · 已保存 · ${msg.TOO_SOON}`);
  });
  it('only a queued verdict promises an email; a re-save of a pending alert does not deny one', () => {
    expect(msg.goingSavedMessage(r({ alert: 'queued' }), { wanted: true, mode: 'live' })).toBe(QUEUED);
    expect(msg.goingSavedMessage(r({ alert: 'queued' }), { wanted: true, mode: 'dev' })).toBe(QUEUED);
    expect(msg.goingSavedMessage(r(), { wanted: true, mode: 'live' })).toBe('Saved · 已保存');
    expect(msg.goingSavedMessage(r(), { wanted: false, mode: 'live' })).toBe('Saved · 已保存 · No alert · 不发提醒');
    expect(msg.goingSavedMessage(r({ alert: 'queued' }), { wanted: true, mode: 'off' })).toBe(PAUSED);
    expect(msg.goingSavedMessage(r({ alert: 'digest' }), { wanted: true, mode: 'live' })).toBe(IN_DIGEST);
    expect(msg.goingSavedMessage(r({ alert: 'digest' }), { wanted: true, mode: 'off' })).toBe(PAUSED);
    expect(msg.goingSavedMessage(r({ going: 'went' }), { wanted: true, mode: 'live' })).toBe('Saved · 已保存');
    expect(msg.goingSavedMessage(r({ visibility: 'after_event', reason: 'cycling' }), { wanted: true, mode: 'off' })).toBe(
      'No alert (shown after the event) · 不发提醒（活动后公开：骑行活动不公开行踪）',
    );
    for (const m of [QUEUED, IN_DIGEST, msg.NO_ALERT, msg.NO_ALERT_AFTER_EVENT, msg.ALERTS_OFF, msg.TOO_SOON, msg.ALERT_HINT, msg.ALERTS_PAUSED_HINT, msg.DRAFT_NOTE, msg.DRAFT_NOTE_PAUSED]) {
      expect(m).not.toMatch(/invit|邀请/i);
    }
    // A queued alert goes out the next sending morning: Monday when Sunday has a digest (events in
    // that digest's week get IN_DIGEST instead, so the Monday note is only for later events).
    expect(msg.ALERT_QUEUED).toMatch(/Monday if Sunday has a digest/);
    expect(msg.ALERT_QUEUED).toMatch(/周日发周报的话改到周一/);
    expect(msg.ALERTS_OFF).not.toMatch(/nothing is sent|不会发出/);
  });

  it('publishedMessage: the editor line after Publish, per verdict', () => {
    expect(msg.publishedMessage('queued')).toBe('Published · 已发布 · Alert goes out next morning ~8 AM PT (Monday if Sunday has a digest) · 明早约 8 点发提醒（周日发周报的话改到周一）');
    expect(msg.publishedMessage('digest')).toBe("Published · 已发布 · In Sunday's digest, no separate alert · 周日周报里会有，不另发提醒");
    expect(msg.publishedMessage('none')).toBe('Published · 已发布');
    expect(msg.publishedMessage(undefined)).toBe('Published · 已发布');
  });

  it('alertTooSoon: before the day after tomorrow 00:00 PT (tomorrow\'s run alerts from then), or over', () => {
    const now = new Date('2026-10-06T19:00:00Z'); // Tue 12:00 PDT; Thu 10-08 00:00 PDT = 07:00Z
    expect(msg.alertTooSoon(new Date('2026-10-08T06:59:59Z'), now)).toBe(true);
    expect(msg.alertTooSoon(new Date('2026-10-08T07:00:00Z'), now)).toBe(false);
    expect(msg.alertTooSoon('2026-10-07T01:30:00.000Z', now.getTime())).toBe(true); // tonight
    expect(msg.alertTooSoon(new Date('2026-09-30T01:30:00Z'), now)).toBe(true); // over
    expect(msg.alertTooSoon(null, now)).toBe(false); // a draft without a start: the save decides
    // Late evening PT is already the next UTC day: still counted from the Pacific date.
    expect(msg.alertTooSoon(new Date('2026-10-09T06:59:00Z'), new Date('2026-10-08T06:30:00Z'))).toBe(true);
    expect(msg.alertTooSoon(new Date('2026-10-09T07:00:00Z'), new Date('2026-10-08T06:30:00Z'))).toBe(false);
  });

  it('alertSwitchDefault: the stored switch while the stored choice is a public going; a fresh mark starts on', () => {
    expect(msg.alertSwitchDefault('going', 'public', false)).toBe(false);
    expect(msg.alertSwitchDefault('speaking', 'public', false)).toBe(false);
    expect(msg.alertSwitchDefault('going', 'public', true)).toBe(true);
    for (const [going, vis] of [['none', 'public'], ['interested', 'public'], ['going', 'after_event'], ['going', 'hidden']]) {
      expect(msg.alertSwitchDefault(going, vis, false), `${going}/${vis}`).toBe(true);
    }
  });

  it('alertWanted: ticked, unticked (hidden off only), or no switch posted (default on)', () => {
    expect(msg.alertWanted(form([['alert', 'off'], ['alert', 'on']]))).toBe(true);
    expect(msg.alertWanted(form([['alert', 'off']]))).toBe(false);
    expect(msg.alertWanted(form([]))).toBe(true);
    expect(msg.alertWanted(form([['alert', 'yes']]))).toBe(false);
  });
});

describe('GoingForm', () => {
  // Tue 2026-10-06 12:00 PDT; FAR is ten days out (alertable), SOON tonight.
  const NOW = Date.parse('2026-10-06T19:00:00Z');
  const FAR = new Date('2026-10-16T01:30:00Z');
  const SOON = new Date('2026-10-07T01:30:00Z');
  type FormProps = Parameters<typeof GoingForm>[0];
  const render = (over: Partial<FormProps> = {}) =>
    renderToStaticMarkup(createElement(GoingForm, { id: 'evt_1', going: 'going', visibility: 'public', mode: 'live', startAt: FAR, now: NOW, ...over }));
  const html = (going: string, visibility: string) => render({ going, visibility });
  const box = (out: string) => load(out)('input[type="checkbox"][name="alert"]');
  const hint = (out: string) => load(out)('#going-alert-hint').text();

  it('a public going / hosting / speaking shows the switch, ticked, with a hidden off before it', () => {
    for (const going of ['going', 'hosting', 'speaking']) {
      const $ = load(html(going, 'public'));
      const inputs = $('input[name="alert"]').map((_, el) => [[$(el).attr('type'), $(el).attr('value'), $(el).attr('checked') !== undefined]]).get();
      // Document order matters: FormData.getAll keeps it, and alertWanted reads off + on as on.
      expect(inputs).toEqual([['hidden', 'off', false], ['checkbox', 'on', true]]);
      expect($('label:has(input[type="checkbox"])').text()).toBe('Alert subscribers · 提醒订阅者');
      expect($('#going-alert-hint').text()).toBe(msg.ALERT_HINT);
      expect($('#going-alert-hint').text()).not.toMatch(/\d{1,2}:\d{2}|invit|邀请/i);
    }
  });

  it('the switch starts from the stored mark: a declined alert shows unticked, and its key changes with it', () => {
    expect(box(render({ alertOn: false })).attr('checked')).toBeUndefined();
    expect(box(render({ alertOn: false, going: 'hosting' })).attr('checked')).toBeUndefined();
    expect(box(render({ alertOn: true })).attr('checked')).toBeDefined();
    expect(box(render()).attr('checked')).toBeDefined(); // no mark yet: on
    // After a save that only flips the stored switch, the fields remount from the stored value.
    expect(goingFieldsKey('going', 'public', false)).not.toBe(goingFieldsKey('going', 'public', true));
  });

  it('sending paused: the switch stays (the mark is kept), and the hint and draft note say paused', () => {
    const out = render({ mode: 'off' });
    expect(out).toContain('name="alert"');
    expect(hint(out)).toBe(msg.ALERTS_PAUSED_HINT);
    expect(hint(out)).not.toMatch(/next morning|次日早上/);
    const draft = render({ mode: 'off', status: 'draft' });
    expect(draft).toContain(msg.DRAFT_NOTE_PAUSED);
    expect(draft).not.toContain(msg.DRAFT_NOTE);
  });

  it('an event too soon for the next run (tonight, tomorrow) or over: "too soon", never the next-morning promise', () => {
    // The day after tomorrow 00:00 PDT is the first start tomorrow's run can alert.
    for (const startAt of [SOON, new Date('2026-10-08T06:59:00Z'), new Date('2026-09-30T01:30:00Z')]) {
      const out = render({ startAt });
      expect(hint(out), startAt.toISOString()).toBe(msg.TOO_SOON);
      for (const mode of ['live', 'off'] as const) expect(render({ startAt, mode, status: 'draft' })).toContain('Too soon for an alert · 活动太近，不发提醒');
      expect(render({ startAt, status: 'draft' })).not.toContain('Publishing it alerts');
    }
    expect(hint(render({ startAt: new Date('2026-10-08T07:00:00Z') }))).toBe(msg.ALERT_HINT);
    // A draft without a start yet: the usual note (publishing needs a start anyway).
    expect(render({ startAt: null, status: 'draft' })).toContain(msg.DRAFT_NOTE);
  });

  it('no switch where no alert can follow: not going, interested, after the event, hidden', () => {
    for (const [going, vis] of [['none', 'public'], ['interested', 'public'], ['going', 'after_event'], ['hosting', 'hidden']]) {
      const out = html(going, vis);
      expect(out, `${going}/${vis}`).not.toContain('name="alert"');
      expect(out).not.toContain('提醒订阅者');
    }
  });

  it('a draft gets a note instead (publishing queues the alert); cancelled or archived events get neither', () => {
    const draft = render({ status: 'draft' });
    expect(draft).not.toContain('name="alert"');
    expect(draft).toContain('Publishing it alerts subscribers');
    for (const status of ['cancelled', 'archived']) {
      const out = render({ status });
      expect(out).not.toContain('name="alert"');
      expect(out).not.toContain('Publishing it alerts');
    }
    // Published (or not said): the switch.
    expect(render({ status: 'published' })).toContain('name="alert"');
  });

  it('keeps the stored values as the selects’ defaults and a polite status line', () => {
    const out = html('hosting', 'public');
    expect(out).toMatch(/<option value="hosting" selected="">/);
    expect(out).toMatch(/<option value="public" selected="">/);
    expect(out).toContain('role="status" aria-live="polite"');
  });
});

describe('editor page: the going form', () => {
  /** The GoingForm element the editor page hands EditorShell (client components stay unrendered). */
  async function goingFormProps(id: string) {
    const page = EditPage({ params: Promise.resolve({ id }), searchParams: Promise.resolve({}) } as never) as ReactElement<{ children: ReactElement }>;
    const editor = page.props.children;
    const tree = await (editor.type as (p: unknown) => Promise<ReactNode>)(editor.props);
    const find = (n: ReactNode): ReactElement<{ going: ReactElement<Parameters<typeof GoingForm>[0]> }> | null => {
      if (Array.isArray(n)) return n.map(find).find(Boolean) ?? null;
      if (!isValidElement(n)) return null;
      if (n.type === EditorShell) return n as never;
      return find((n as ReactElement<{ children?: ReactNode }>).props.children);
    };
    const going = find(tree)?.props.going;
    expect(going?.type).toBe(GoingForm);
    return going!.props;
  }

  it('passes the stored alert switch, the sending mode, the start and the clock', async () => {
    const id = await seed();
    expect(await goingFormProps(id)).toMatchObject({ id, going: 'none', visibility: 'public', status: 'published', alertOn: true, mode: 'dev' });
    await saveGoing(id, null, goingForm('going', 'public', false));
    const props = await goingFormProps(id);
    expect(props).toMatchObject({ going: 'going', alertOn: false });
    expect((props.startAt as Date).getTime()).toBe((await db().select().from(events).where(eq(events.id, id)))[0].startAt!.getTime());
    expect(Math.abs(props.now - Date.now())).toBeLessThan(60_000);
    await saveGoing(id, null, goingForm('going', 'public', true));
    expect((await goingFormProps(id)).alertOn).toBe(true);
    vi.stubEnv('ALERTS_SENDING', '0');
    expect((await goingFormProps(id)).mode).toBe('off');
  });
});

describe('QuickGoing', () => {
  it('the toggle reads 标为会去 / 会去 ✓ with aria-pressed, and its status line starts empty', () => {
    const off = renderToStaticMarkup(createElement(QuickGoing, { id: 'evt_1', going: 'interested' }));
    expect(off).toMatch(/aria-pressed="false"[^>]*>标为会去<\/button>/);
    expect(off).toMatch(/<span id="going-line-evt_1" role="status" aria-live="polite"[^>]*><\/span>/);
    const on = renderToStaticMarkup(createElement(QuickGoing, { id: 'evt_1', going: 'going' }));
    expect(on).toMatch(/aria-pressed="true"[^>]*>会去 ✓<\/button>/);
  });
});
