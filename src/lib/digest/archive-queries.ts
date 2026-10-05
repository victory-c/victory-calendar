import 'server-only';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { cacheLife, cacheTag } from 'next/cache';
import { db as defaultDb, type DB, hasDatabase } from '../db';
import { digestIssues } from '../db/schema';
import { publicEvents } from '../events/public-rows';
import { isoWeekBounds } from '../format/calendar';
import { showAttendance } from '../settings';
import { type ArchiveIssue, isArchivable } from './archive';
import { archivable } from './archive-sql'; // isArchivable() in SQL, so a listed issue never links to a 404
import { coverage } from './week';

// Reads behind the public /weekly archive, its index and the sitemap (DESIGN D7/D8). Pages call the
// cached functions: tagged 'digest' (the send cron and "Send now" revalidate it when a run freezes,
// finishes or closes an issue) and, for an issue page, 'events' too, so unpublishing, cancelling,
// the attendance kill switch and cover changes reach the archive like every other public page.
// Same lifetimes as the site's event queries. The uncached read* functions take a db for tests.

type Opts = { db?: DB; now?: Date };

export type SentIssue = { isoWeek: string; sentAt: Date | null; introEn: string | null; introZh: string | null };

/** Issues an archive page may show (D7); the index and sitemap list 'sent' only. */
const PUBLIC = ['sending', 'sent'] as const;
/** Two years of Sundays: the index and sitemap length. */
const MAX_SENT = 104;

const snapshot = digestIssues.snapshot;

/** One issue's public archive data, or null when /weekly/[week] should 404. */
export async function getArchiveIssue(isoWeek: string): Promise<ArchiveIssue | null> {
  'use cache';
  cacheTag('digest', 'events');
  cacheLife({ stale: 300, revalidate: 900, expire: 86_400 });
  if (!hasDatabase() || !isoWeekBounds(isoWeek)) return null;
  return readArchiveIssue(isoWeek);
}

/** Sent issues with events, newest first (the /weekly index, the sitemap, prerendered weeks). */
export async function listSentIssues(): Promise<SentIssue[]> {
  'use cache';
  cacheTag('digest');
  cacheLife({ stale: 300, revalidate: 900, expire: 86_400 });
  if (!hasDatabase()) return [];
  return readSentIssues();
}

export async function readArchiveIssue(isoWeek: string, opts: Opts = {}): Promise<ArchiveIssue | null> {
  const db = opts.db ?? defaultDb;
  const [row] = await db
    .select({ snapshot })
    .from(digestIssues)
    .where(and(eq(digestIssues.isoWeek, isoWeek), inArray(digestIssues.status, PUBLIC)));
  const snap = row?.snapshot;
  if (!isArchivable(snap, isoWeek)) return null;
  const ids = [...new Set([...snap.events, ...snap.preview].map((e) => e?.id).filter((id): id is string => typeof id === 'string'))];
  const [live, attendance, nextIssue] = await Promise.all([
    publicEvents({ ids, db }),
    showAttendance(),
    isPublicIssue(coverage(isoWeek).previewWeek, db),
  ]);
  return {
    now: (opts.now ?? new Date()).toISOString(),
    snap,
    live,
    showAttendance: attendance === true, // a malformed settings row hides attendance rather than showing it
    nextIssue,
  };
}

export async function readSentIssues(opts: Opts = {}): Promise<SentIssue[]> {
  const db = opts.db ?? defaultDb;
  return db
    .select({
      isoWeek: digestIssues.isoWeek,
      sentAt: digestIssues.sentAt,
      introEn: sql<string | null>`${snapshot} ->> 'introEn'`,
      introZh: sql<string | null>`${snapshot} ->> 'introZh'`,
    })
    .from(digestIssues)
    .where(and(eq(digestIssues.status, 'sent'), archivable))
    .orderBy(desc(digestIssues.isoWeek))
    .limit(MAX_SENT);
}

async function isPublicIssue(isoWeek: string, db: DB) {
  const [row] = await db
    .select({ isoWeek: digestIssues.isoWeek })
    .from(digestIssues)
    .where(and(eq(digestIssues.isoWeek, isoWeek), inArray(digestIssues.status, PUBLIC), archivable));
  return Boolean(row);
}
