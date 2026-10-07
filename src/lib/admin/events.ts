import 'server-only';
import { and, asc, desc, eq, gte, inArray, lt, sql } from 'drizzle-orm';
import { z } from 'zod';
import { recordGoingMark } from '../alerts/marks';
import { templateCoverRow } from '../covers/template';
import { db as defaultDb, type DB } from '../db';
import { ACCESS, covers, EVENT_LANGUAGES, events, FORMATS, REGIONS } from '../db/schema';
import { goingDowngradeReason, hasEnded } from '../events/going';
import { zonedInstant } from '../format/calendar';
import { isoWithOffset } from '../format/date';
import { newId } from '../ids';
import { publicSafeUrl } from '../ingest/normalize';
import { regionFor } from '../ingest/pipeline';
import { CATEGORY_SLUGS, isCategory } from '../taxonomy';

// Admin model: everything the editor, drafts, live and publish buttons do, as plain functions
// over the database (Server Actions in app/admin call these after requireAdmin()).

export type AdminEvent = typeof events.$inferSelect & { cover: typeof covers.$inferSelect | null };

// ---- wall-clock time in the event's zone <-> instant ------------------------------------

/** Instant → "YYYY-MM-DDTHH:mm" in tz, for <input type="datetime-local">. */
export const toWallTime = (d: Date | null, tz: string) => (d ? isoWithOffset(d, tz).slice(0, 16) : '');

/** "YYYY-MM-DDTHH:mm" in tz → instant; null for empty or malformed input. */
export function fromWallTime(s: string | null | undefined, tz: string): Date | null {
  const m = s?.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if (!m) return null;
  const [y, mo, d, h, mi] = m.slice(1).map(Number);
  return zonedInstant(y, mo, d, h, mi, tz);
}

const isZone = (tz: string) => {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return tz.includes('/') || tz === 'UTC';
  } catch {
    return false;
  }
};

// ---- reads ---------------------------------------------------------------------------------

export async function getAdminEvent(id: string, db: DB = defaultDb): Promise<AdminEvent | null> {
  const [row] = await db.select().from(events).leftJoin(covers, eq(covers.id, events.coverId)).where(eq(events.id, id));
  return row ? { ...row.events, cover: row.covers } : null;
}

/** The event's F20 going mark, for the editor's alert switch (alerts/marks.ts). */
export { getGoingMark } from '../alerts/marks';

export async function listDrafts(db: DB = defaultDb) {
  const rows = await db
    .select()
    .from(events)
    .leftJoin(covers, eq(covers.id, events.coverId))
    .where(eq(events.status, 'draft'))
    .orderBy(desc(events.createdAt));
  return rows.map((r) => ({ ...r.events, cover: r.covers }));
}

/** Published and cancelled events: this week (from today PT, 7 days), later, and the last 60 days. */
export async function listLive(now: Date, db: DB = defaultDb) {
  const rows = await db
    .select()
    .from(events)
    .leftJoin(covers, eq(covers.id, events.coverId))
    .where(and(inArray(events.status, ['published', 'cancelled']), gte(events.startAt, new Date(now.getTime() - 60 * 864e5))))
    .orderBy(asc(events.startAt));
  const list = rows.map((r) => ({ ...r.events, cover: r.covers }));
  const weekEnd = now.getTime() + 7 * 864e5;
  // Same rule as the public 去过 seal: an all-day event stays in this week through its last day.
  const ended = (e: AdminEvent) => hasEnded({ startAt: e.startAt!, endAt: e.endAt, allDay: e.allDay }, now);
  return {
    week: list.filter((e) => !ended(e) && e.startAt!.getTime() < weekEnd),
    later: list.filter((e) => e.startAt!.getTime() >= weekEnd),
    past: list.filter(ended).reverse(),
  };
}

// ---- edits -----------------------------------------------------------------------------------

const text = (max: number) =>
  z
    .string()
    .max(max)
    .transform((s) => s.trim())
    .transform((s) => (s === '' ? null : s));

/** Editor form → column values. Absent keys are left alone. */
export const EventPatch = z
  .object({
    titleEn: text(300), titleZh: text(300), summaryEn: text(400), summaryZh: text(200), noteEn: text(2000), noteZh: text(2000),
    category: z.union([z.enum(CATEGORY_SLUGS), z.literal('')]).transform((v) => (v === '' ? null : v)),
    eventLanguage: z.enum(EVENT_LANGUAGES),
    tz: z.string().refine(isZone, 'unknown time zone'),
    start: z.string(), end: z.string(),
    allDay: z.boolean(),
    format: z.enum(FORMATS),
    venueName: text(200), city: text(120), neighborhood: text(120), address: text(300),
    region: z.union([z.enum(REGIONS), z.literal('')]).transform((v) => (v === '' ? null : v)),
    addressPublic: z.boolean(), privateVenue: z.boolean(),
    priceText: text(80), access: z.enum(ACCESS),
    hostName: text(200), hostUrl: text(500), sourceUrl: z.string().min(8).max(2048),
    featured: z.boolean(), coverPolicy: z.enum(['official', 'template']),
    tags: z.string().max(300).transform((s) => [...new Set(s.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean))].slice(0, 12)),
  })
  .partial();
export type EventPatch = z.input<typeof EventPatch>;

// Columns whose change bumps the ICS SEQUENCE (guide: start/end, location, status).
const SEQUENCE_COLS = ['startAt', 'endAt', 'venueName', 'city', 'address', 'format'] as const;
// Editor field → auto_fields name, so editing a model-filled field confirms it.
const AUTO_NAME: Record<string, string> = {
  titleEn: 'title_en', titleZh: 'title_zh', summaryEn: 'summary_en', summaryZh: 'summary_zh', noteEn: 'note_en',
  noteZh: 'note_zh', category: 'category', eventLanguage: 'event_language', startAt: 'start_at', endAt: 'end_at',
  tz: 'tz', venueName: 'venue_name', city: 'city', format: 'format', priceText: 'price_text', access: 'access',
  privateVenue: 'private_venue',
};

export class AdminError extends Error {}

export async function saveEvent(id: string, raw: EventPatch, db: DB = defaultDb) {
  const ev = await getAdminEvent(id, db);
  if (!ev) throw new AdminError('not found');
  const p = EventPatch.parse(raw);
  const tz = p.tz ?? ev.tz;
  const next: Partial<typeof events.$inferInsert> = {};
  for (const [k, v] of Object.entries(p)) {
    if (k === 'start' || k === 'end' || k === 'hostUrl' || k === 'sourceUrl') continue;
    (next as Record<string, unknown>)[k] = v;
  }
  if (p.start !== undefined) next.startAt = fromWallTime(p.start, tz);
  if (p.end !== undefined) next.endAt = fromWallTime(p.end, tz);
  // Re-entering the same wall time in a new zone moves the instant; that's the intent of a tz edit.
  if (p.tz && p.start === undefined && ev.startAt) next.startAt = fromWallTime(toWallTime(ev.startAt, ev.tz), tz);
  if (p.tz && p.end === undefined && ev.endAt) next.endAt = fromWallTime(toWallTime(ev.endAt, ev.tz), tz);
  if (next.endAt && next.startAt !== undefined && next.startAt && next.endAt <= next.startAt) throw new AdminError('end_before_start');
  if (p.hostUrl !== undefined) next.hostUrl = p.hostUrl ? publicSafeUrl(p.hostUrl) : null;
  if (p.sourceUrl !== undefined) {
    const clean = publicSafeUrl(p.sourceUrl);
    if (!clean) throw new AdminError('source_url');
    next.sourceUrl = clean;
  }
  if (p.city !== undefined && p.region === undefined) next.region = regionFor(p.city, p.format ?? ev.format);
  if (ev.status === 'published' && (next.category === null || next.startAt === null)) throw new AdminError('published_needs_start_and_category');

  // Changed values: confirm their AI chips, and bump SEQUENCE for calendar-visible changes.
  const changed = Object.keys(next).filter((k) => {
    const a = (ev as Record<string, unknown>)[k];
    const b = (next as Record<string, unknown>)[k];
    return a instanceof Date || b instanceof Date ? (a as Date | null)?.getTime() !== (b as Date | null)?.getTime() : JSON.stringify(a) !== JSON.stringify(b);
  });
  if (changed.length === 0) return { changed: [] as string[], event: ev };
  const confirmed = new Set(changed.map((k) => AUTO_NAME[k]).filter(Boolean));
  next.autoFields = ev.autoFields.filter((f) => !confirmed.has(f));
  if (ev.status !== 'draft' && changed.some((k) => (SEQUENCE_COLS as readonly string[]).includes(k))) next.sequence = ev.sequence + 1;
  next.updatedAt = new Date();
  // A category change on a template cover re-points the template at the new colour and glyph.
  if (next.category && ev.cover?.kind === 'template' && next.category !== ev.category) {
    await db.update(covers).set(templateCoverRow(next.category, next.hostName ?? ev.hostName)).where(eq(covers.id, ev.cover.id));
  }
  await db.update(events).set(next).where(eq(events.id, id));
  return { changed, event: (await getAdminEvent(id, db))! };
}

/** Clear AI chips (all, or the named auto_fields). */
export async function confirmAi(id: string, fields?: string[], db: DB = defaultDb) {
  const ev = await getAdminEvent(id, db);
  if (!ev) throw new AdminError('not found');
  const keep = fields ? ev.autoFields.filter((f) => !fields.includes(f)) : [];
  await db.update(events).set({ autoFields: keep, updatedAt: new Date() }).where(eq(events.id, id));
}

// ---- status ------------------------------------------------------------------------------------

/** Guide「发布校验」: name, start, source, category, a note in either language, a cover. */
export function publishBlockers(e: Pick<AdminEvent, 'titleEn' | 'titleZh' | 'startAt' | 'category' | 'noteEn' | 'noteZh' | 'sourceUrl'>) {
  const out: string[] = [];
  if (!e.titleEn && !e.titleZh) out.push('title');
  if (!e.startAt) out.push('start_at');
  if (!e.category) out.push('category');
  if (!e.noteEn && !e.noteZh) out.push('note');
  if (!e.sourceUrl) out.push('source_url');
  return out;
}

/**
 * Publishing an event that is already marked going (public, not downgraded) makes it publicly
 * going now: that records an F20 going mark, with the alert on for a first mark. Restoring a
 * cancelled or archived event keeps the mark's stored choice: an alert Victor declined stays off
 * (publish shows no switch). `alert` is the verdict (alerts/marks.ts GoingAlertVerdict).
 */
export async function publish(id: string, now = new Date(), db: DB = defaultDb) {
  const ev = await getAdminEvent(id, db);
  if (!ev) throw new AdminError('not found');
  const blockers = publishBlockers(ev);
  if (blockers.length) return { ok: false as const, blockers };
  let coverId = ev.coverId;
  if (!coverId && isCategory(ev.category)) {
    // Cover check always passes: the template is there until something better replaces it.
    coverId = newId('cov');
    await db.insert(covers).values({ id: coverId, ...templateCoverRow(ev.category, ev.hostName) });
  }
  await db
    .update(events)
    .set({
      status: 'published', coverId, publishedAt: ev.publishedAt ?? now, updatedAt: now,
      sequence: ev.status === 'cancelled' ? ev.sequence + 1 : ev.sequence,
    })
    .where(eq(events.id, id));
  const alert = await recordGoingMark(db, ev, { ...ev, status: 'published' }, now, { alert: true, keepStored: true });
  return { ok: true as const, blockers: [] as string[], alert };
}

/** 下架: off the site and feeds, row and cover kept (archived). */
export async function unpublish(id: string, db: DB = defaultDb) {
  await db.update(events).set({ status: 'archived', updatedAt: new Date() }).where(and(eq(events.id, id), inArray(events.status, ['published', 'cancelled'])));
}

/** Cancelled stays visible (struck through, STATUS:CANCELLED in ICS) so subscribers find out. */
export async function cancelEvent(id: string, db: DB = defaultDb) {
  await db
    .update(events)
    .set({ status: 'cancelled', sequence: sql`${events.sequence} + 1`, updatedAt: new Date() })
    .where(and(eq(events.id, id), eq(events.status, 'published')));
}

/** Drafts Victor doesn't want: archived, never deleted (the link stays deduped). */
export async function dismissDraft(id: string, db: DB = defaultDb) {
  await db.update(events).set({ status: 'archived', updatedAt: new Date() }).where(and(eq(events.id, id), eq(events.status, 'draft')));
}

// ---- going -------------------------------------------------------------------------------------

export const GOING = ['none', 'interested', 'going', 'hosting', 'speaking'] as const;
export const GOING_VIS = ['public', 'after_event', 'hidden'] as const;

/**
 * Guide「Going 状态安全规则」: a public `going` needs a listed platform, a non-private venue (or
 * online), a non-cycling category. Otherwise it is stored as after_event and the reason returned.
 *
 * F20: when this makes a published event publicly going (going / hosting / speaking), a going mark
 * is recorded for the next morning's alert; `opts.alert` is Victor's "Alert subscribers" switch
 * (default on). On an event that already is publicly going, `alert: false` cancels a pending
 * alert and an explicit `alert: true` turns a declined one back on (left out, a decline stays).
 * `alert` in the result is the verdict: 'queued', 'digest' or 'none' (alerts/marks.ts).
 * The event is written first: if the mark then fails, the error surfaces and no alert is sent.
 */
export async function setGoing(
  id: string,
  going: (typeof GOING)[number],
  visibility: (typeof GOING_VIS)[number],
  db: DB = defaultDb,
  opts: { alert?: boolean; now?: Date } = {},
) {
  const now = opts.now ?? new Date();
  const ev = await getAdminEvent(id, db);
  if (!ev) throw new AdminError('not found');
  let vis = visibility;
  let reason: string | null = null;
  if (going === 'going' && vis === 'public') {
    reason = goingDowngradeReason({ ...ev, going, goingVisibility: vis, recurring: await isRecurring(ev, db) } as never);
    if (reason) vis = 'after_event';
  }
  await db.update(events).set({ going, goingVisibility: vis, updatedAt: now }).where(eq(events.id, id));
  const alert = await recordGoingMark(db, ev, { ...ev, going, goingVisibility: vis }, now, {
    alert: opts.alert ?? true,
    explicit: opts.alert !== undefined,
  });
  return { going, visibility: vis, reason, alert, startAt: ev.startAt };
}

/** Guide: same host and same venue at least twice within 4 weeks counts as recurring. */
async function isRecurring(ev: AdminEvent, db: DB) {
  if (!ev.hostName || !ev.venueName || !ev.startAt) return false;
  const span = 28 * 864e5;
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(events)
    .where(
      and(
        eq(events.hostName, ev.hostName),
        eq(events.venueName, ev.venueName),
        sql`${events.id} <> ${ev.id}`,
        inArray(events.status, ['published', 'cancelled', 'draft']),
        gte(events.startAt, new Date(ev.startAt.getTime() - span)),
        lt(events.startAt, new Date(ev.startAt.getTime() + span)),
      ),
    );
  return (row?.n ?? 0) >= 1;
}

