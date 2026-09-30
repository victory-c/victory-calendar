import 'server-only';
import type { LanguageModel } from 'ai';
import { and, eq, inArray, like, or, sql } from 'drizzle-orm';
import { db as defaultDb, type DB } from '../db';
import { covers, CREATED_VIA, eventSources, events, type NewEvent, REGIONS } from '../db/schema';
import { blobConfigured } from '../covers/blob';
import { templateCoverRow } from '../covers/template';
import { publicOrigin } from '../host';
import { newId } from '../ids';
import { type PageFacts, readFacts } from './adapters';
import { enrich, type EventDraft } from './extract';
import { isShortLink, normalizeUrl, NormalizeError, type PlatformRef, platformRef, publicSafeUrl } from './normalize';
import { safeFetch, SafeFetchError } from './safe-fetch';

// POST /api/ingest body → event row (guide「完整 ingest 顺序」):
// normalise → platform id → dedupe → hardened fetch → adapter facts → model → draft
// (publish mode: template cover first, then publish). Never drops a link: anything we
// can't read becomes a minimal draft with needs_manual.

export type CreatedVia = (typeof CREATED_VIA)[number];
export type IngestMode = 'draft' | 'publish';
export type IngestInput = {
  url: string;
  comment: string | null;
  mode: IngestMode;
  name: string | null;
  createdVia: CreatedVia;
};

export type CoverStatus = 'pending' | 'official' | 'template' | 'template_pending_official';

export type IngestResult =
  | {
      status: 201;
      body: {
        id: string; status: 'draft' | 'published'; title_en: string | null; title_zh: string | null;
        start_at: string | null; tz: string; category: string | null; category_confidence: number | null;
        cover_status: CoverStatus; admin_url: string; public_url: string | null; ai: boolean;
        /** Why a publish request was saved as a draft instead. */
        not_published?: string[];
      };
      /** Inputs for the cover chain, which the route runs in after(). */
      cover: { officialUrl: string | null; hostImages: string[]; sourcePageUrl: string };
    }
  | { status: 202; body: { id: string; needs_manual: true; reason: string; admin_url: string } }
  | { status: 409; body: { existing_id: string; admin_url: string } }
  | { status: 400; body: { error: string } };

export type IngestDeps = {
  db?: DB;
  fetchPage?: (url: URL) => Promise<{ url: string; text: string }>;
  model?: LanguageModel;
  now?: () => Date;
  /** Whether official covers can be stored (Blob configured); only changes the reported cover_status. */
  canStoreCovers?: boolean;
};

const adminUrl = (id: string) => `${publicOrigin()}/admin/e/${id}`;
const publicUrl = (slug: string) => `${publicOrigin()}/events/${slug}`;

const REGION_BY_CITY: Record<string, (typeof REGIONS)[number]> = {
  'san francisco': 'sf',
  oakland: 'east_bay', berkeley: 'east_bay', emeryville: 'east_bay', alameda: 'east_bay', richmond: 'east_bay',
  'walnut creek': 'east_bay', hayward: 'east_bay', fremont: 'east_bay', albany: 'east_bay', 'san leandro': 'east_bay',
  'palo alto': 'peninsula', 'menlo park': 'peninsula', 'redwood city': 'peninsula', 'san mateo': 'peninsula',
  burlingame: 'peninsula', 'foster city': 'peninsula', 'south san francisco': 'peninsula', 'daly city': 'peninsula',
  stanford: 'peninsula', 'san carlos': 'peninsula', 'half moon bay': 'peninsula',
  'mountain view': 'south_bay', 'san jose': 'south_bay', 'santa clara': 'south_bay', sunnyvale: 'south_bay',
  cupertino: 'south_bay', milpitas: 'south_bay', 'los gatos': 'south_bay', campbell: 'south_bay', 'los altos': 'south_bay',
  'san rafael': 'north_bay', sausalito: 'north_bay', 'mill valley': 'north_bay', 'santa rosa': 'north_bay',
  napa: 'north_bay', novato: 'north_bay', petaluma: 'north_bay', 'corte madera': 'north_bay',
};

export function regionFor(city: string | null, format: string): (typeof REGIONS)[number] | null {
  if (format === 'online') return 'online';
  return city ? REGION_BY_CITY[city.trim().toLowerCase()] ?? null : null;
}

export function slugify(title: string) {
  return title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/, '');
}

async function uniqueSlug(db: DB, title: string | null, id: string) {
  const base = (title && slugify(title)) || `event-${id.slice(-6)}`;
  const taken = new Set(
    (await db.select({ slug: events.slug }).from(events).where(or(eq(events.slug, base), like(events.slug, `${base}-%`)))).map(
      (r) => r.slug,
    ),
  );
  if (!taken.has(base)) return base;
  for (let n = 2; n < 100; n++) if (!taken.has(`${base}-${n}`)) return `${base}-${n}`;
  return `${base}-${id.slice(-6)}`;
}

async function findExisting(db: DB, refs: PlatformRef[], url: string) {
  const conds = [eq(eventSources.url, url)];
  for (const r of refs) conds.push(and(eq(eventSources.platform, r.platform), eq(eventSources.externalId, r.externalId))!);
  const [hit] = await db.select({ id: eventSources.eventId }).from(eventSources).where(or(...conds)).limit(1);
  if (hit) return hit.id;
  const [byUrl] = await db.select({ id: events.id }).from(events).where(eq(events.sourceUrl, url)).limit(1);
  return byUrl?.id ?? null;
}

async function recordSources(db: DB, eventId: string, refs: PlatformRef[], url: string) {
  if (refs.length === 0) return;
  await db
    .insert(eventSources)
    .values(refs.map((r) => ({ eventId, platform: r.platform, externalId: r.externalId, url })))
    .onConflictDoNothing();
}

const CJK = /[㐀-鿿]/;

/** Publish gate (guide「发布校验」): name, start, source, category, a note, a cover. */
export function publishBlockers(d: EventDraft) {
  const out: string[] = [];
  if (!d.title_en && !d.title_zh) out.push('title');
  if (!d.start_at) out.push('start_at');
  if (!d.category) out.push('category');
  if (!d.note_en && !d.note_zh) out.push('note');
  return out;
}

async function minimalDraft(db: DB, input: IngestInput, url: URL, refs: PlatformRef[], reason: string): Promise<IngestResult> {
  const id = newId('evt');
  const note = input.comment?.trim() || null;
  const title = input.name?.trim() || null;
  await db.insert(events).values({
    id,
    slug: await uniqueSlug(db, title, id),
    status: 'draft',
    titleEn: title && !CJK.test(title) ? title : null,
    titleZh: title && CJK.test(title) ? title : null,
    noteEn: note && !CJK.test(note) ? note : null,
    noteZh: note && CJK.test(note) ? note : null,
    sourceUrl: url.toString(),
    createdVia: input.createdVia,
  });
  await recordSources(db, id, refs, url.toString());
  return { status: 202, body: { id, needs_manual: true, reason, admin_url: adminUrl(id) } };
}

const defaultFetch = async (url: URL) => {
  const r = await safeFetch(url);
  return { url: r.url, text: r.text };
};

export async function ingest(input: IngestInput, deps: IngestDeps = {}): Promise<IngestResult> {
  const db = deps.db ?? defaultDb;
  const now = deps.now ?? (() => new Date());
  const fetchPage = deps.fetchPage ?? defaultFetch;

  let url: URL;
  try {
    url = normalizeUrl(input.url);
  } catch (e) {
    return { status: 400, body: { error: e instanceof NormalizeError ? e.message : 'bad url' } };
  }

  // 1. Dedupe on what the URL alone tells us (short links need the hop first).
  let ref = isShortLink(url) ? null : platformRef(url);
  if (!isShortLink(url)) {
    const existing = await findExisting(db, ref ? [ref] : [], url.toString());
    if (existing) return { status: 409, body: { existing_id: existing, admin_url: adminUrl(existing) } };
  }

  // 2. Hardened fetch. Anything unreadable becomes a minimal draft, never an error.
  let page: { url: string; text: string };
  try {
    page = await fetchPage(url);
  } catch (e) {
    const reason = e instanceof SafeFetchError ? `fetch_${e.code}` : 'fetch_failed';
    return minimalDraft(db, input, url, ref ? [ref] : [], reason);
  }
  let finalUrl = url;
  try {
    finalUrl = normalizeUrl(page.url);
  } catch {
    // A redirect target we wouldn't accept as input: keep the (already clean) requested URL.
  }
  if (finalUrl.toString() !== url.toString()) {
    url = finalUrl;
    ref = platformRef(url);
  }

  // 3. Facts, then dedupe again on every id the page revealed (Luma evt- ids, redirects).
  const facts: PageFacts = readFacts(page.text, url, ref);
  const existing = await findExisting(db, facts.refs, url.toString());
  if (existing) return { status: 409, body: { existing_id: existing, admin_url: adminUrl(existing) } };
  if (facts.kind !== 'event') return minimalDraft(db, input, url, facts.refs, facts.kind);

  // 4. Model step (facts win) and Victor's name override.
  const { draft, autoFields, ai } = await enrich(facts, input.comment, { model: deps.model });
  const auto = new Set(autoFields);
  const name = input.name?.trim();
  if (name) {
    if (CJK.test(name)) draft.title_zh = name;
    else draft.title_en = name;
    auto.delete(CJK.test(name) ? 'title_zh' : 'title_en');
  }

  // 5. Publish gate. publish mode with gaps saves a draft and says why.
  const blockers = input.mode === 'publish' ? [...publishBlockers(draft), ...(facts.cancelled ? ['cancelled'] : [])] : [];
  const publishing = input.mode === 'publish' && blockers.length === 0;
  const id = newId('evt');
  const slug = await uniqueSlug(db, draft.title_en || null, id);

  // Template cover first (guide: publish mode makes it synchronously so the cover check always
  // passes); the cover chain in after() swaps in the official one when there is one.
  let coverId: string | null = null;
  if (publishing && draft.category) {
    coverId = newId('cov');
    await db.insert(covers).values({ id: coverId, ...templateCoverRow(draft.category, facts.hostName) });
  }

  const row: NewEvent = {
    id,
    slug,
    status: publishing ? 'published' : 'draft',
    titleEn: draft.title_en || null,
    titleZh: draft.title_zh || null,
    summaryEn: draft.summary_en || null,
    summaryZh: draft.summary_zh || null,
    noteEn: draft.note_en,
    noteZh: draft.note_zh,
    autoFields: [...auto],
    category: draft.category,
    categoryConfidence: draft.category ? draft.category_confidence : null,
    eventLanguage: draft.event_language,
    startAt: draft.start_at ? new Date(draft.start_at) : null,
    endAt: draft.end_at ? new Date(draft.end_at) : null,
    tz: draft.tz,
    format: draft.format,
    venueName: draft.private_venue ? null : draft.venue_name,
    city: draft.city,
    neighborhood: draft.private_venue ? null : facts.neighborhood,
    region: regionFor(draft.city, draft.format),
    address: facts.address,
    addressPublic: false,
    privateVenue: draft.private_venue,
    priceText: draft.price_text,
    access: draft.access,
    hostName: facts.hostName,
    hostUrl: publicSafeUrl(facts.hostUrl),
    sourceUrl: url.toString(),
    coverId,
    createdVia: input.createdVia,
    publishedAt: publishing ? now() : null,
  };
  if (row.startAt && Number.isNaN(+row.startAt)) row.startAt = null;
  if (row.endAt && Number.isNaN(+row.endAt)) row.endAt = null;

  await db.insert(events).values(row);
  await recordSources(db, id, facts.refs, url.toString());

  const official = Boolean(facts.coverUrl) && (deps.canStoreCovers ?? blobConfigured());
  const coverStatus: CoverStatus = coverId
    ? official ? 'template_pending_official' : 'template'
    : official ? 'pending' : 'template';

  return {
    status: 201,
    body: {
      id,
      status: row.status === 'published' ? 'published' : 'draft',
      title_en: row.titleEn ?? null,
      title_zh: row.titleZh ?? null,
      start_at: row.startAt?.toISOString() ?? null,
      tz: draft.tz,
      category: draft.category,
      category_confidence: row.categoryConfidence ?? null,
      cover_status: coverStatus,
      admin_url: adminUrl(id),
      public_url: row.status === 'published' ? publicUrl(slug) : null,
      ai,
      ...(blockers.length ? { not_published: blockers } : {}),
    },
    cover: { officialUrl: facts.coverUrl, hostImages: facts.hostImages, sourcePageUrl: url.toString() },
  };
}

/** GET /api/index: what the weekly-events skill needs to skip already-published events. */
export async function publishedIndex(db: DB = defaultDb) {
  const rows = await db
    .select({ id: events.id, url: events.sourceUrl, platform: eventSources.platform, externalId: eventSources.externalId, icalUid: eventSources.icalUid })
    .from(events)
    .leftJoin(eventSources, eq(eventSources.eventId, events.id))
    .where(inArray(events.status, ['published', 'cancelled']))
    .orderBy(sql`${events.startAt} desc nulls last`);
  const byId = new Map<string, { id: string; url: string; external_ids: string[]; ical_uids: string[] }>();
  for (const r of rows) {
    const e = byId.get(r.id) ?? { id: r.id, url: r.url, external_ids: [], ical_uids: [] };
    if (r.platform && r.externalId) e.external_ids.push(`${r.platform}:${r.externalId}`);
    if (r.icalUid) e.ical_uids.push(r.icalUid);
    byId.set(r.id, e);
  }
  return [...byId.values()];
}
