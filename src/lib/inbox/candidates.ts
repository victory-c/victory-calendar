import 'server-only';
import { and, asc, eq, inArray, lte, or, sql } from 'drizzle-orm';
import { db as defaultDb, type DB } from '../db';
import { candidates, candidateSightings, eventSources, events, PLATFORMS, syncState } from '../db/schema';
import { newId } from '../ids';
import { fuzzyKey, type SourceKind } from './keys';

// The candidate inbox's store (guide「去重键」「保留规则」). Candidates are private: nothing here
// is read by a public page, feed, sitemap or digest.

export type CandidateInput = {
  sourceKind: SourceKind;
  /** Feed UID (per occurrence for recurring entries), skill batch id. */
  sourceRef: string;
  providerKey: string | null;
  icalUid: string | null;
  title: string;
  startAt: Date;
  endAt: Date | null;
  location: string | null;
  links: string[];
  snippet: string | null;
  rsvp?: string | null;
  eventStatus?: string | null;
  suggestComment?: string | null;
  suggestGoing?: boolean;
};

export type Candidate = typeof candidates.$inferSelect;
export type UpsertResult = { id: string; created: boolean; eventId: string | null };

const DAY = 864e5;
export const EXPIRE_AFTER_END_MS = 7 * DAY;
export const DISMISS_HIDES_MS = 90 * DAY;

async function findCandidate(db: DB, input: CandidateInput, fk: string): Promise<Candidate | null> {
  // Guide order: platform id → iCalUID → fuzzy key. The first tier that hits wins.
  const tiers = [
    input.providerKey ? eq(candidates.providerKey, input.providerKey) : null,
    input.icalUid ? eq(candidates.icalUid, input.icalUid) : null,
    eq(candidates.fuzzyKey, fk),
  ];
  for (const where of tiers) {
    if (!where) continue;
    const [row] = await db.select().from(candidates).where(where).orderBy(asc(candidates.firstSeen)).limit(1);
    if (row) return row;
  }
  return null;
}

/** An event already in the site that this candidate is: platform id, iCalUID, or source link. */
export async function matchEvent(
  db: DB,
  c: Pick<CandidateInput, 'providerKey' | 'icalUid' | 'links'>,
): Promise<string | null> {
  const conds = [];
  if (c.providerKey) {
    const [platform, ...rest] = c.providerKey.split(':');
    if ((PLATFORMS as readonly string[]).includes(platform)) {
      conds.push(and(eq(eventSources.platform, platform as (typeof PLATFORMS)[number]), eq(eventSources.externalId, rest.join(':'))));
    }
  }
  if (c.icalUid) conds.push(eq(eventSources.icalUid, c.icalUid));
  if (c.links.length) conds.push(inArray(eventSources.url, c.links));
  if (conds.length) {
    const [hit] = await db.select({ id: eventSources.eventId }).from(eventSources).where(or(...conds)).limit(1);
    if (hit) return hit.id;
  }
  if (!c.links.length) return null;
  const [byUrl] = await db.select({ id: events.id }).from(events).where(inArray(events.sourceUrl, c.links)).limit(1);
  return byUrl?.id ?? null;
}

const union = (a: string[], b: string[]) => [...new Set([...a, ...b])];

/**
 * Insert or merge one sighting. A repeat only adds to source_kinds, links and sightings; triage
 * state (dismissed, snoozed, added) is never reset by a feed seeing the entry again.
 * `createIfMissing: false` updates a known row only (a cancelled entry never creates one).
 */
export async function upsertCandidate(
  input: CandidateInput,
  opts: { db?: DB; now?: Date; createIfMissing?: boolean } = {},
): Promise<UpsertResult | null> {
  const db = opts.db ?? defaultDb;
  const now = opts.now ?? new Date();
  const fk = fuzzyKey(input.title, input.startAt, input.location);
  const snippet = input.snippet ? input.snippet.slice(0, 300) : null;

  let row = await findCandidate(db, input, fk);
  let created = false;
  if (!row) {
    if (opts.createIfMissing === false) return null;
    const id = newId('cand');
    const inserted = await db
      .insert(candidates)
      .values({
        id,
        providerKey: input.providerKey,
        icalUid: input.icalUid,
        fuzzyKey: fk,
        title: input.title.slice(0, 300),
        startAt: input.startAt,
        endAt: input.endAt,
        location: input.location?.slice(0, 200) ?? null,
        links: input.links,
        snippet,
        rsvp: input.rsvp ?? null,
        eventStatus: input.eventStatus ?? null,
        sourceKinds: [input.sourceKind],
        suggestComment: input.suggestComment ?? null,
        suggestGoing: input.suggestGoing ?? false,
        firstSeen: now,
        lastSeen: now,
      })
      .onConflictDoNothing()
      .returning();
    row = inserted[0] ?? (await findCandidate(db, input, fk));
    if (!row) throw new Error('candidate upsert lost a race twice');
    created = inserted.length > 0;
  }

  if (!created) {
    const patch = {
      providerKey: row.providerKey ?? input.providerKey,
      icalUid: row.icalUid ?? input.icalUid,
      title: input.title.slice(0, 300),
      startAt: input.startAt,
      endAt: input.endAt,
      location: input.location?.slice(0, 200) ?? row.location,
      links: union(row.links, input.links),
      snippet: snippet ?? row.snippet,
      rsvp: input.rsvp ?? row.rsvp,
      eventStatus: input.eventStatus ?? row.eventStatus,
      sourceKinds: union(row.sourceKinds, [input.sourceKind]),
      suggestComment: input.suggestComment ?? row.suggestComment,
      suggestGoing: row.suggestGoing || Boolean(input.suggestGoing),
      lastSeen: now,
    };
    try {
      await db.update(candidates).set({ ...patch, fuzzyKey: fk }).where(eq(candidates.id, row.id));
    } catch {
      // The new fuzzy key (or platform id) belongs to another row: keep this row's own keys.
      await db
        .update(candidates)
        .set({ ...patch, providerKey: row.providerKey, fuzzyKey: row.fuzzyKey })
        .where(eq(candidates.id, row.id));
    }
  }

  await db
    .insert(candidateSightings)
    .values({ candidateId: row.id, sourceKind: input.sourceKind, sourceRef: input.sourceRef.slice(0, 500), seenAt: now })
    .onConflictDoUpdate({ target: [candidateSightings.candidateId, candidateSightings.sourceKind, candidateSightings.sourceRef], set: { seenAt: now } });

  let eventId = row.eventId;
  if (!eventId) {
    eventId = await matchEvent(db, { providerKey: row.providerKey ?? input.providerKey, icalUid: row.icalUid ?? input.icalUid, links: union(row.links, input.links) });
    if (eventId) await markAdded(row.id, eventId, db);
  }
  return { id: row.id, created, eventId };
}

export async function markAdded(id: string, eventId: string, db: DB = defaultDb) {
  await db.update(candidates).set({ eventId, state: 'added', snoozedUntil: null }).where(eq(candidates.id, id));
  // Let /api/index and future syncs find the event by this calendar UID too.
  const [c] = await db.select({ uid: candidates.icalUid }).from(candidates).where(eq(candidates.id, id));
  if (c?.uid) {
    await db
      .update(eventSources)
      .set({ icalUid: c.uid })
      .where(and(eq(eventSources.eventId, eventId), sql`${eventSources.icalUid} is null`));
  }
}

// ---- triage ------------------------------------------------------------------------------------

export async function dismissCandidates(ids: string[], now = new Date(), db: DB = defaultDb) {
  if (!ids.length) return;
  await db.update(candidates).set({ state: 'dismissed', dismissedAt: now, snoozedUntil: null }).where(inArray(candidates.id, ids));
}

export async function snoozeCandidates(ids: string[], until: Date, db: DB = defaultDb) {
  if (!ids.length) return;
  await db
    .update(candidates)
    .set({ state: 'snoozed', snoozedUntil: until })
    .where(and(inArray(candidates.id, ids), sql`${candidates.state} <> 'added'`));
}

export async function restoreCandidates(ids: string[], db: DB = defaultDb) {
  if (!ids.length) return;
  await db
    .update(candidates)
    .set({ state: sql`case when ${candidates.eventId} is null then 'inbox' else 'added' end`, snoozedUntil: null, dismissedAt: null })
    .where(inArray(candidates.id, ids));
}

export async function getCandidates(ids: string[], db: DB = defaultDb) {
  return ids.length ? db.select().from(candidates).where(inArray(candidates.id, ids)) : [];
}

// ---- reading -----------------------------------------------------------------------------------

export type InboxRow = Candidate & {
  event: { id: string; slug: string; status: string; going: string } | null;
  /** Effective state after snooze and dismiss windows run out. */
  view: 'inbox' | 'added' | 'snoozed' | 'dismissed';
};

const endOf = sql`coalesce(${candidates.endAt}, ${candidates.startAt})`;

/** Rows still inside their retention window (end + 7 days), soonest first. */
export async function listInbox(now = new Date(), db: DB = defaultDb): Promise<InboxRow[]> {
  const rows = await db
    .select({ c: candidates, e: { id: events.id, slug: events.slug, status: events.status, going: events.going } })
    .from(candidates)
    .leftJoin(events, eq(events.id, candidates.eventId))
    .where(sql`${endOf} >= ${new Date(now.getTime() - EXPIRE_AFTER_END_MS)}`)
    .orderBy(asc(candidates.startAt), asc(candidates.title));
  return rows.map(({ c, e }) => ({ ...c, event: e?.id ? e : null, view: viewOf(c, now) }));
}

export function viewOf(c: Pick<Candidate, 'state' | 'snoozedUntil' | 'dismissedAt' | 'eventId'>, now: Date): InboxRow['view'] {
  if (c.state === 'snoozed' && c.snoozedUntil && c.snoozedUntil > now) return 'snoozed';
  if (c.state === 'dismissed' && c.dismissedAt && now.getTime() - c.dismissedAt.getTime() < DISMISS_HIDES_MS) return 'dismissed';
  return c.eventId ? 'added' : 'inbox';
}

// ---- housekeeping ------------------------------------------------------------------------------

/** Guide: rows expire 7 days after they end (sightings cascade). */
export async function expireCandidates(now = new Date(), db: DB = defaultDb) {
  const gone = await db
    .delete(candidates)
    .where(sql`${endOf} < ${new Date(now.getTime() - EXPIRE_AFTER_END_MS)}`)
    .returning({ id: candidates.id });
  return gone.length;
}

export const INBOX_LOCK = 'inbox';

/** Settings「清空收件箱数据」: every candidate, sighting and feed status row. */
export async function clearInbox(db: DB = defaultDb) {
  await db.delete(candidates);
  await db.delete(syncState).where(inArray(syncState.source, [INBOX_LOCK, 'gcal', 'luma', 'partiful']));
}

/**
 * Cooldown and lock in one statement: only the caller whose conditional UPDATE matches runs the
 * sync, so two tabs (or the page and the cron) never pull the feeds at the same time.
 */
export async function claimSyncRun(cooldownMs: number, now = new Date(), db: DB = defaultDb) {
  await db.insert(syncState).values({ source: INBOX_LOCK }).onConflictDoNothing();
  const won = await db
    .update(syncState)
    .set({ lastRunAt: now })
    .where(
      and(
        eq(syncState.source, INBOX_LOCK),
        or(sql`${syncState.lastRunAt} is null`, lte(syncState.lastRunAt, new Date(now.getTime() - cooldownMs))),
      ),
    )
    .returning({ source: syncState.source });
  return won.length > 0;
}

export async function feedStatus(db: DB = defaultDb) {
  return db
    .select()
    .from(syncState)
    .where(inArray(syncState.source, [INBOX_LOCK, 'gcal', 'luma', 'partiful']));
}
