import 'server-only';
import { inArray } from 'drizzle-orm';
import { db as defaultDb, type DB } from '../db';
import { eventsPublic } from '../db/schema';
import { place } from '../events/display';
import { publicGoing } from '../events/going';
import { platformName } from '../events/platform';
import { publicEvents } from '../events/public-rows';
import type { PublicEvent } from '../events/types';
import { publicOrigin } from '../host';
import { readSetting, showAttendance } from '../settings';
import { emailCover, type EmailCoverOptions, isKeepableLumaCover } from './cover';
import type { DigestIssue } from './issues';
import type { DigestEvent, DigestSeal, DigestSnapshot } from './types';
import { coverage, sendAfterFor } from './week';

// Assembles one issue's content (guide「digest 组装」) into the DigestSnapshot every render uses.
// Reads the database uncached (never the site's 'use cache' queries: stale for up to 15 minutes,
// seed fixtures without a database, a frozen clock), and only public-safe data: events_public
// rows through redactForPublic, published only (cancelled events are left out of the email).
//
// The result depends on the issue and the database, never on the wall clock: "has it ended"
// decisions use the issue's send time, so assembling twice gives the same snapshot. The cron
// freezes it into digest_issues.snapshot when sending starts (run.ts); drafts are assembled live.

type Opts = {
  db?: DB;
  /** Accepted for symmetry with the other digest calls; deliberately unused (see above). */
  now?: Date;
};

type Ctx = { origin: string; covers: EmailCoverOptions; coverIds: Map<string, string | null>; at: Date; show: boolean };

export async function buildSnapshot(issue: DigestIssue, opts: Opts = {}): Promise<DigestSnapshot> {
  const db = opts.db ?? defaultDb;
  const cov = coverage(issue.isoWeek);
  const sendAfter = issue.sendAfter ?? sendAfterFor(issue.isoWeek);
  const [attendance, toTemplate, week, preview] = await Promise.all([
    showAttendance(),
    readSetting('official_covers_to_template'),
    publicEvents({ from: cov.from, to: cov.to, statuses: ['published'], db }),
    // The editor's preview list, re-checked: still published and still in the following week.
    publicEvents({ ids: issue.featuredIds, from: cov.to, to: cov.previewTo, statuses: ['published'], db }),
  ]);
  const show = attendance === true; // a malformed settings row hides attendance rather than showing it
  const ctx: Ctx = {
    origin: publicOrigin(),
    covers: { keep: new Set(issue.keepCoverIds), allToTemplate: Boolean(toTemplate?.on) },
    coverIds: await coverIdsOf(db, [...week, ...preview].map((e) => e.id)),
    at: sendAfter,
    show,
  };
  return {
    version: 1,
    issueId: issue.id,
    isoWeek: issue.isoWeek,
    from: cov.from.toISOString(),
    to: cov.to.toISOString(),
    previewWeek: cov.previewWeek,
    sendAfter: sendAfter.toISOString(),
    origin: ctx.origin,
    introEn: cleanText(issue.introEn),
    introZh: cleanText(issue.introZh),
    showAttendance: show,
    events: byStart(week).map((e) => toDigestEvent(e, ctx)),
    preview: byStart(preview).map((e) => toDigestEvent(e, ctx)),
  };
}

function toDigestEvent(e: PublicEvent, ctx: Ctx): DigestEvent {
  const cover = emailCover({ ...e, coverId: ctx.coverIds.get(e.id) ?? null }, ctx.origin, ctx.covers);
  return {
    id: e.id,
    slug: e.slug,
    category: e.category,
    startAt: e.startAt.toISOString(),
    endAt: e.endAt ? e.endAt.toISOString() : null,
    tz: e.tz,
    allDay: e.allDay,
    format: e.format,
    eventLanguage: e.eventLanguage,
    titleEn: e.titleEn,
    titleZh: e.titleZh,
    noteEn: cleanText(e.noteEn),
    noteZh: cleanText(e.noteZh),
    place: place(e) || null,
    priceText: e.priceText?.trim() || null,
    access: e.access,
    sourceUrl: e.sourceUrl,
    platform: platformName(e.sourceUrl),
    coverUrl: cover.url,
    coverCredit: cover.credit,
    // Only when there is one: snapshots of covers without links stay as they were.
    ...(cover.sourceUrl ? { coverSourceUrl: cover.sourceUrl } : {}),
    ...(cover.licenseUrl ? { coverLicenseUrl: cover.licenseUrl } : {}),
    seal: sealOf(e, ctx.at, ctx.show),
    featured: e.featured,
  };
}

/** going / hosting / speaking when publicGoing() would show that seal at send time; never "interested". */
function sealOf(e: PublicEvent, at: Date, show: boolean): DigestSeal | null {
  if (!show) return null;
  const g = publicGoing(e, at, show);
  return g.kind === 'seal' && g.seal !== 'went' ? g.seal : null;
}

/**
 * The editor's "keep official cover in this email" list: events of the covered week whose Luma
 * official cover falls back to the template unless kept; `kept` says whether this issue keeps it.
 * Only the covered week: the next-week preview shows no covers, so a toggle there would do nothing.
 * Empty while official_covers_to_template is on (nothing can be kept).
 */
export async function lumaCoverChoices(issue: DigestIssue, opts: Opts = {}) {
  const db = opts.db ?? defaultDb;
  const cov = coverage(issue.isoWeek);
  const [toTemplate, week] = await Promise.all([
    readSetting('official_covers_to_template'),
    publicEvents({ from: cov.from, to: cov.to, statuses: ['published'], db }),
  ]);
  const allToTemplate = Boolean(toTemplate?.on);
  const keep = new Set(issue.keepCoverIds);
  return byStart(week)
    .filter((e) => isKeepableLumaCover(e, allToTemplate))
    .map((e) => ({
      id: e.id,
      slug: e.slug,
      titleEn: e.titleEn,
      titleZh: e.titleZh,
      startAt: e.startAt.toISOString(),
      kept: keep.has(e.id),
    }));
}

/** covers.id per event (PublicEvent carries the cover but not its id; the email cover route needs it). */
async function coverIdsOf(db: DB, ids: string[]): Promise<Map<string, string | null>> {
  if (ids.length === 0) return new Map();
  const rows = await db
    .select({ id: eventsPublic.id, coverId: eventsPublic.coverId })
    .from(eventsPublic)
    .where(inArray(eventsPublic.id, [...new Set(ids)]));
  return new Map(rows.map((r) => [r.id, r.coverId]));
}

/** Start time, then id: a stable order for events starting together. */
function byStart(list: PublicEvent[]): PublicEvent[] {
  return [...list].sort((a, b) => a.startAt.getTime() - b.startAt.getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

const cleanText = (s: string | null | undefined) => s?.replace(/\r\n?/g, '\n').trim() || null;
