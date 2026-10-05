import 'server-only';
import { and, asc, eq, gte, inArray, lt } from 'drizzle-orm';
import { db as defaultDb, type DB } from '../db';
import { covers, eventsPublic } from '../db/schema';
import { isCategory } from '../taxonomy';
import { redactForPublic } from './redact';
import type { PublicCover, PublicEvent } from './types';

// Public events straight from the database: the events_public view (no private address,
// created_via or auto_fields), their cover, then redactForPublic. Uncached on purpose: the site's
// cached queries (queries.ts) wrap it, and the digest calls it directly at send time.

export type PublicStatus = 'published' | 'cancelled';

export async function publicEvents(opts: {
  from?: Date;
  to?: Date;
  slug?: string;
  ids?: string[];
  statuses?: PublicStatus[];
  db?: DB;
}): Promise<PublicEvent[]> {
  const db = opts.db ?? defaultDb;
  const statuses = opts.statuses ?? ['published', 'cancelled'];
  const where = [inArray(eventsPublic.status, statuses)];
  if (opts.slug !== undefined) where.push(eq(eventsPublic.slug, opts.slug));
  if (opts.ids) {
    if (opts.ids.length === 0) return [];
    where.push(inArray(eventsPublic.id, opts.ids));
  }
  if (opts.from) where.push(gte(eventsPublic.startAt, opts.from));
  if (opts.to) where.push(lt(eventsPublic.startAt, opts.to));
  const rows = await db
    .select()
    .from(eventsPublic)
    .leftJoin(covers, eq(covers.id, eventsPublic.coverId))
    .where(and(...where))
    .orderBy(asc(eventsPublic.startAt));
  return rows.flatMap(({ events_public: e, covers: c }): PublicEvent[] => {
    if (!e.startAt || !isCategory(e.category)) return [];
    const cover: PublicCover | null = c
      ? {
          kind: c.kind, url400: c.url400, url800: c.url800, url1600: c.url1600, thumbhash: c.thumbhash,
          dominant: c.dominant, letterboxed: c.letterboxed, attribution: c.attribution, license: c.license,
          sourcePageUrl: c.sourcePageUrl,
        }
      : null;
    return [
      {
        id: e.id, slug: e.slug, status: e.status === 'cancelled' ? 'cancelled' : 'published',
        titleEn: e.titleEn ?? e.titleZh ?? '', titleZh: e.titleZh ?? e.titleEn ?? '',
        summaryEn: e.summaryEn, summaryZh: e.summaryZh, noteEn: e.noteEn, noteZh: e.noteZh,
        category: e.category, tags: e.tags, eventLanguage: e.eventLanguage, startAt: e.startAt, endAt: e.endAt,
        tz: e.tz, allDay: e.allDay, format: e.format, venueName: e.venueName, city: e.city,
        neighborhood: e.neighborhood, region: e.region, address: e.address, privateVenue: e.privateVenue,
        priceText: e.priceText, access: e.access, hostName: e.hostName, hostUrl: e.hostUrl, sourceUrl: e.sourceUrl,
        going: e.going, goingVisibility: e.goingVisibility, featured: e.featured, sequence: e.sequence,
        publishedAt: e.publishedAt, cover,
      } satisfies PublicEvent,
    ].map(redactForPublic);
  });
}
