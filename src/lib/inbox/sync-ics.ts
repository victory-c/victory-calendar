import 'server-only';
import ical, { type VEvent } from 'node-ical';
import { eq } from 'drizzle-orm';
import { db as defaultDb, type DB } from '../db';
import { jobsLog, syncState } from '../db/schema';
import { safeFetch, SafeFetchError } from '../ingest/safe-fetch';
import { type CandidateInput, claimSyncRun, expireCandidates, upsertCandidate } from './candidates';
import { extractLinks, partstatFor, providerKeyFrom } from './keys';

// The three private ICS feeds → candidates (guide「已选路线的搭建步骤」). The feed URLs are
// secrets: they are read from env, fetched through safeFetch (lint bans fetch here), and never
// logged or stored; errors keep only a short code.

export const FEED_KINDS = ['gcal', 'luma', 'partiful'] as const;
export type FeedKind = (typeof FEED_KINDS)[number];

const FEED_ENV: Record<FeedKind, string> = {
  gcal: 'GCAL_SECRET_ICS_URL',
  luma: 'LUMA_PERSONAL_ICS_URL',
  partiful: 'PARTIFUL_ICS_URL',
};

export const WINDOW_DAYS = 14;
/** Opening the inbox pulls at most every 10 minutes; the refresh button and the cron use 1. */
export const PAGE_COOLDOWN_MS = 10 * 60_000;
export const FORCE_COOLDOWN_MS = 60_000;
/** A Google calendar with years of history can be large; the parse only keeps the window. */
const MAX_FEED_BYTES = 15_000_000;

export function feedEnvName(kind: FeedKind) {
  return FEED_ENV[kind];
}

export function configuredFeeds(): { kind: FeedKind; url: string }[] {
  return FEED_KINDS.flatMap((kind) => {
    const url = process.env[FEED_ENV[kind]]?.trim();
    return url ? [{ kind, url: url.replace(/^webcals?:\/\//i, 'https://') }] : [];
  });
}

const text = (v: unknown): string => {
  if (typeof v === 'string') return v;
  if (v && typeof v === 'object' && 'val' in v) return String((v as { val: unknown }).val ?? '');
  return '';
};

/** Description → plain text for the ≤300-char snippet: no tags, no e-mail addresses. */
export function snippetOf(description: string) {
  const plain = description
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email]')
    .replace(/\s+/g, ' ')
    .trim();
  return plain ? plain.slice(0, 300) : null;
}

export type ParsedEntry = CandidateInput & { cancelled: boolean };

/**
 * One feed's VEVENTs inside [now, now + 14 days] as candidate inputs. Recurring entries are
 * expanded (one row per occurrence). Google Calendar also holds Victor's private life, so a gcal
 * entry only counts when it points at something (a link, or a Luma UID); Luma and Partiful feeds
 * only ever hold events.
 */
export function parseFeed(body: string, kind: FeedKind, now: Date, emails: string[] = []): ParsedEntry[] {
  const until = new Date(now.getTime() + WINDOW_DAYS * 864e5);
  const data = ical.sync.parseICS(body);
  const out: ParsedEntry[] = [];
  for (const comp of Object.values(data)) {
    if (!comp || comp.type !== 'VEVENT' || !comp.start) continue;
    const ev = comp as VEvent;
    const instances = ev.rrule
      ? ical.expandRecurringEvent(ev, { from: now, to: until, expandOngoing: true }).map((i) => ({ start: i.start, end: i.end, ev: i.event }))
      : [{ start: ev.start, end: ev.end ?? null, ev }];
    for (const inst of instances) {
      const start = new Date(inst.start);
      const end = inst.end ? new Date(inst.end) : null;
      if (Number.isNaN(+start) || start > until || (end ?? start) < now) continue;
      const title = text(inst.ev.summary).trim();
      if (!title) continue;
      const description = text(inst.ev.description);
      const location = text(inst.ev.location).trim() || null;
      const links = extractLinks(typeof inst.ev.url === 'string' ? inst.ev.url : text(inst.ev.url), description, location);
      const baseUid = String(ev.uid ?? '');
      const uid = ev.rrule ? `${baseUid}:${start.toISOString()}` : baseUid;
      const platformKey = providerKeyFrom(links, baseUid);
      if (kind === 'gcal' && links.length === 0 && !platformKey) continue;
      // Every occurrence of a recurring entry shares its link; the platform id would fold them
      // into one row, so occurrences dedupe on their per-occurrence UID and fuzzy key instead.
      const providerKey = ev.rrule ? null : platformKey;
      const status = inst.ev.status ? String(inst.ev.status).toUpperCase() : null;
      out.push({
        sourceKind: kind,
        sourceRef: uid || `${kind}:${start.toISOString()}:${title}`,
        providerKey,
        icalUid: uid || null,
        title,
        startAt: start,
        endAt: end && !Number.isNaN(+end) ? end : null,
        location: location && /^https?:\/\//i.test(location) ? null : location,
        links,
        snippet: snippetOf(description),
        rsvp: partstatFor(inst.ev.attendee as never, emails),
        eventStatus: status,
        cancelled: status === 'CANCELLED',
      });
    }
  }
  return out;
}

export type FeedResult = { kind: FeedKind; ok: boolean; seen: number; created: number; error?: string };
export type SyncResult =
  | { ran: false; reason: 'cooldown' | 'no_feeds' }
  | { ran: true; feeds: FeedResult[]; expired: number };

type Deps = { db?: DB; now?: Date; fetchText?: (url: string) => Promise<string>; cooldownMs?: number };

const defaultFetchText = async (url: string) => (await safeFetch(url, { maxBytes: MAX_FEED_BYTES })).text;

function errorCode(e: unknown) {
  if (e instanceof SafeFetchError) return e.status ? `${e.code}_${e.status}` : e.code;
  return 'parse_failed';
}

/** Pull every configured feed once (unless another run is inside the cooldown), then expire old rows. */
export async function syncIcsFeeds(deps: Deps = {}): Promise<SyncResult> {
  const db = deps.db ?? defaultDb;
  const now = deps.now ?? new Date();
  const feeds = configuredFeeds();
  if (feeds.length === 0) return { ran: false, reason: 'no_feeds' };
  if (!(await claimSyncRun(deps.cooldownMs ?? PAGE_COOLDOWN_MS, now, db))) return { ran: false, reason: 'cooldown' };

  const fetchText = deps.fetchText ?? defaultFetchText;
  const emails = (process.env.INBOX_EMAILS ?? process.env.ADMIN_EMAIL ?? '').split(',');
  const [job] = await db.insert(jobsLog).values({ job: 'inbox_sync', startedAt: now }).returning({ id: jobsLog.id });

  const results = await Promise.all(
    feeds.map(async ({ kind, url }): Promise<FeedResult> => {
      try {
        const entries = parseFeed(await fetchText(url), kind, now, emails);
        let created = 0;
        for (const { cancelled, ...entry } of entries) {
          const r = await upsertCandidate(entry, { db, now, createIfMissing: !cancelled });
          if (r?.created) created++;
        }
        await recordFeed(db, kind, now, null);
        return { kind, ok: true, seen: entries.length, created };
      } catch (e) {
        const error = errorCode(e);
        console.error(`[inbox] ${kind} feed failed: ${error}`);
        await recordFeed(db, kind, now, error);
        return { kind, ok: false, seen: 0, created: 0, error };
      }
    }),
  );
  const expired = await expireCandidates(now, db);
  await db
    .update(jobsLog)
    .set({ finishedAt: new Date(), ok: results.every((r) => r.ok), detail: { feeds: results, expired } })
    .where(eq(jobsLog.id, job.id));
  return { ran: true, feeds: results, expired };
}

async function recordFeed(db: DB, kind: FeedKind, now: Date, error: string | null) {
  const set = error ? { lastRunAt: now, error } : { lastRunAt: now, lastOkAt: now, error: null };
  await db.insert(syncState).values({ source: kind, ...set }).onConflictDoUpdate({ target: syncState.source, set });
}
