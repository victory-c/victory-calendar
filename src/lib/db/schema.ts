// Drizzle schema. Mirrors IMPLEMENTATION_GUIDE.md「数据模型」SQL one-to-one:
// 14 business tables, plus going_marks and alert_sends for F20 going alerts (M4, migration 0004).
// Better Auth tables are generated separately in week 2
// (`pnpm dlx @better-auth/cli generate`) and live in ./auth-schema.ts.
import { getTableColumns, sql } from 'drizzle-orm';
import {
  bigserial,
  boolean,
  check,
  customType,
  index,
  inet,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  pgView,
  primaryKey,
  real,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { CATEGORY_SLUGS } from '../taxonomy';

const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => 'bytea' });
const tstz = (name: string) => timestamp(name, { withTimezone: true });
const inList = (col: string, values: readonly string[]) =>
  sql.raw(`${col} in (${values.map((v) => `'${v}'`).join(',')})`);

export const eventStatus = pgEnum('event_status', ['draft', 'published', 'cancelled', 'archived']);
export const goingStatus = pgEnum('going_status', ['none', 'interested', 'going', 'hosting', 'speaking']);
export const goingVis = pgEnum('going_vis', ['public', 'after_event', 'hidden']);

export const COVER_KINDS = ['official', 'host_composite', 'template', 'openverse', 'ai', 'brave', 'upload', 'url'] as const;
export const EVENT_LANGUAGES = ['en', 'zh', 'bilingual'] as const;
export const FORMATS = ['in_person', 'online', 'hybrid'] as const;
export const REGIONS = ['sf', 'east_bay', 'peninsula', 'south_bay', 'north_bay', 'online'] as const;
export const ACCESS = ['open', 'apply', 'waitlist', 'sold_out', 'unknown'] as const;
export const CREATED_VIA = ['admin', 'shortcut', 'share_target', 'skill', 'inbox'] as const;
export const PLATFORMS = ['luma', 'partiful', 'eventbrite', 'meetup', 'other'] as const;

export const covers = pgTable(
  'covers',
  {
    id: text('id').primaryKey(),
    kind: text('kind', { enum: COVER_KINDS }).notNull(),
    url1600: text('url_1600').notNull(),
    url800: text('url_800').notNull(),
    url400: text('url_400').notNull(),
    urlOgEn: text('url_og_en').notNull(),
    urlOgZh: text('url_og_zh').notNull(),
    thumbhash: text('thumbhash').notNull(),
    dominant: text('dominant').notNull(),
    bytes: integer('bytes').notNull(),
    letterboxed: boolean('letterboxed').notNull().default(false),
    sourceUrl: text('source_url'),
    sourcePageUrl: text('source_page_url'),
    license: text('license'),
    attribution: text('attribution'),
    createdAt: tstz('created_at').notNull().defaultNow(),
  },
  () => [check('covers_kind_check', inList('kind', COVER_KINDS))],
);

export const events = pgTable(
  'events',
  {
    id: text('id').primaryKey(),
    slug: text('slug').notNull().unique(),
    status: eventStatus('status').notNull().default('draft'),
    titleEn: text('title_en'),
    titleZh: text('title_zh'),
    summaryEn: text('summary_en'),
    summaryZh: text('summary_zh'),
    noteEn: text('note_en'),
    noteZh: text('note_zh'),
    autoFields: text('auto_fields').array().notNull().default(sql`'{}'`),
    category: text('category', { enum: CATEGORY_SLUGS }),
    categoryConfidence: real('category_confidence'),
    tags: text('tags').array().notNull().default(sql`'{}'`),
    eventLanguage: text('event_language', { enum: EVENT_LANGUAGES }).notNull().default('en'),
    startAt: tstz('start_at'),
    endAt: tstz('end_at'),
    tz: text('tz').notNull().default('America/Los_Angeles'),
    allDay: boolean('all_day').notNull().default(false),
    format: text('format', { enum: FORMATS }).notNull().default('in_person'),
    venueName: text('venue_name'),
    city: text('city'),
    neighborhood: text('neighborhood'),
    region: text('region', { enum: REGIONS }),
    address: text('address'),
    addressPublic: boolean('address_public').notNull().default(false),
    privateVenue: boolean('private_venue').notNull().default(false),
    priceText: text('price_text'),
    access: text('access', { enum: ACCESS }).notNull().default('unknown'),
    hostName: text('host_name'),
    hostUrl: text('host_url'),
    sourceUrl: text('source_url').notNull(),
    going: goingStatus('going').notNull().default('interested'),
    goingVisibility: goingVis('going_visibility').notNull().default('public'),
    featured: boolean('featured').notNull().default(false),
    coverId: text('cover_id').references(() => covers.id),
    coverPolicy: text('cover_policy', { enum: ['official', 'template'] }).notNull().default('official'),
    sequence: integer('sequence').notNull().default(0),
    createdVia: text('created_via', { enum: CREATED_VIA }).notNull().default('admin'),
    createdAt: tstz('created_at').notNull().defaultNow(),
    updatedAt: tstz('updated_at').notNull().defaultNow(),
    publishedAt: tstz('published_at'),
  },
  (t) => [
    check('events_category_check', sql`${t.category} is null or ${inList('category', CATEGORY_SLUGS)}`),
    check('events_event_language_check', inList('event_language', EVENT_LANGUAGES)),
    check('events_format_check', inList('format', FORMATS)),
    check('events_region_check', sql`${t.region} is null or ${inList('region', REGIONS)}`),
    check('events_access_check', inList('access', ACCESS)),
    check('events_cover_policy_check', inList('cover_policy', ['official', 'template'])),
    check('events_created_via_check', inList('created_via', CREATED_VIA)),
    check(
      'events_published_complete',
      sql`${t.status} <> 'published' or (${t.startAt} is not null and ${t.category} is not null and ${t.coverId} is not null)`,
    ),
    index('events_pub_start').on(t.status, t.startAt).where(sql`${t.status} = 'published'`),
    index('events_category').on(t.category, t.startAt),
    index('events_source_url').on(t.sourceUrl), // ingest dedupe by canonical URL
  ],
);

export const eventSources = pgTable(
  'event_sources',
  {
    eventId: text('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    platform: text('platform', { enum: PLATFORMS }).notNull(),
    externalId: text('external_id').notNull(),
    url: text('url').notNull(),
    icalUid: text('ical_uid'),
  },
  (t) => [
    primaryKey({ columns: [t.eventId, t.platform, t.externalId] }),
    unique('event_sources_platform_external_id').on(t.platform, t.externalId), // 全站去重键
    check('event_sources_platform_check', inList('platform', PLATFORMS)),
    index('event_sources_ical').on(t.icalUid),
    index('event_sources_url').on(t.url), // ingest dedupe by canonical URL
  ],
);

export const SUBSCRIBER_STATUS = ['pending', 'active', 'paused', 'unsubscribed', 'suppressed'] as const;

export const subscribers = pgTable(
  'subscribers',
  {
    id: text('id').primaryKey(),
    email: text('email').notNull().unique(),
    status: text('status', { enum: SUBSCRIBER_STATUS }).notNull().default('pending'),
    locale: text('locale', { enum: ['en', 'zh'] }).notNull().default('en'),
    categories: text('categories').array().notNull().default(sql`'{}'`),
    goingAlerts: boolean('going_alerts').notNull().default(false),
    // F20: when going alerts were last switched on. Only marks made after it (or after confirmed_at
    // when unset) are alerted, so a new opt-in never gets a backlog (alerts/claim.ts).
    goingAlertsSince: tstz('going_alerts_since'),
    evLangPref: text('ev_lang_pref').array(),
    onlineOnly: boolean('online_only'),
    tokenVersion: integer('token_version').notNull().default(1),
    consentAt: tstz('consent_at'),
    consentIp: inet('consent_ip'),
    consentUa: text('consent_ua'),
    consentSource: text('consent_source'),
    confirmedAt: tstz('confirmed_at'),
    pausedUntil: tstz('paused_until'),
    unsubscribedAt: tstz('unsubscribed_at'),
    createdAt: tstz('created_at').notNull().defaultNow(),
  },
  (t) => [
    check('subscribers_status_check', inList('status', SUBSCRIBER_STATUS)),
    check('subscribers_locale_check', inList('locale', ['en', 'zh'])),
    index('subscribers_active').on(t.status, t.locale).where(sql`${t.status} = 'active'`),
  ],
);

export const digestIssues = pgTable(
  'digest_issues',
  {
    id: text('id').primaryKey(),
    isoWeek: text('iso_week').notNull().unique(),
    introEn: text('intro_en'),
    introZh: text('intro_zh'),
    featuredIds: text('featured_ids').array().notNull().default(sql`'{}'`),
    status: text('status', { enum: ['draft', 'scheduled', 'sending', 'sent'] }).notNull().default('draft'),
    sendAfter: tstz('send_after'),
    sentAt: tstz('sent_at'),
    createdAt: tstz('created_at').notNull().defaultNow(),
    // Week 14 (PROGRESS 文档冲突): which intro the model drafted and Victor hasn't approved yet;
    // Luma official covers Victor chose to keep in this issue (otherwise the email uses the template);
    // the assembled content frozen at scheduled → sending, so a retry renders byte-identical mail.
    autoFields: text('auto_fields').array().notNull().default(sql`'{}'`),
    keepCoverIds: text('keep_cover_ids').array().notNull().default(sql`'{}'`),
    snapshot: jsonb('snapshot'),
  },
  () => [check('digest_issues_status_check', inList('status', ['draft', 'scheduled', 'sending', 'sent']))],
);

export const digestSends = pgTable(
  'digest_sends',
  {
    issueId: text('issue_id')
      .notNull()
      .references(() => digestIssues.id),
    subscriberId: text('subscriber_id')
      .notNull()
      .references(() => subscribers.id),
    variantKey: text('variant_key').notNull(),
    claimedAt: tstz('claimed_at').notNull().defaultNow(),
    resendId: text('resend_id'),
    sentAt: tstz('sent_at'),
    // 'empty' = the at-most-monthly "nothing I'd recommend this week" notice.
    kind: text('kind', { enum: ['digest', 'empty'] }).notNull().default('digest'),
    // Rows claimed together are retried together, so the Resend idempotency key repeats.
    batchKey: text('batch_key'),
    // Final, never retried: invalid | ineligible | idem_conflict | id_mismatch | expired | window_closed |
    // render_failed | too_large | no_picks (replay_… on a replay) | failed:<reason>.
    error: text('error'),
  },
  (t) => [
    primaryKey({ columns: [t.issueId, t.subscriberId] }),
    check('digest_sends_kind_check', inList('kind', ['digest', 'empty'])),
    index('digest_sends_pending').on(t.issueId, t.batchKey).where(sql`${t.resendId} is null and ${t.error} is null`),
  ],
);

/**
 * F20 going alerts: when an event last became publicly going (going / hosting / speaking, public,
 * published). Written by setGoing() and publish() on that transition only (alerts/marks.ts); the
 * alert cron re-checks the event live before anything is sent, so unmarking needs no write here.
 * `alert` is Victor's per-mark switch ("Alert subscribers"). A separate table, so events_public is
 * untouched; the row goes with its event.
 */
export const goingMarks = pgTable('going_marks', {
  eventId: text('event_id')
    .primaryKey()
    .references(() => events.id, { onDelete: 'cascade' }),
  markedAt: tstz('marked_at').notNull(),
  alert: boolean('alert').notNull().default(true),
});

/**
 * F20: one alert email per subscriber per Pacific day (the primary key), claimed before anything is
 * sent like digest_sends. event_ids are the events it carries, sorted; an event in a row that may
 * have been delivered is never alerted to that subscriber again. Same lifecycle columns as
 * digest_sends (batch_key groups a Resend call, error is final).
 */
export const alertSends = pgTable(
  'alert_sends',
  {
    alertDay: text('alert_day').notNull(),
    subscriberId: text('subscriber_id')
      .notNull()
      .references(() => subscribers.id),
    eventIds: text('event_ids').array().notNull(),
    variantKey: text('variant_key').notNull(),
    claimedAt: tstz('claimed_at').notNull().defaultNow(),
    batchKey: text('batch_key'),
    resendId: text('resend_id'),
    sentAt: tstz('sent_at'),
    // Final, never retried: invalid | ineligible | unmarked | idem_conflict | id_mismatch | expired |
    // render_failed | too_large (replay_… on a replay) | failed:<reason> | refused:<name> (Resend
    // refused a first attempt outright; its events merge into the next day's alert).
    error: text('error'),
  },
  (t) => [
    primaryKey({ columns: [t.alertDay, t.subscriberId] }),
    check('alert_sends_day_check', sql`${t.alertDay} ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'`),
    check('alert_sends_event_ids_check', sql`cardinality(${t.eventIds}) between 1 and 20`),
    index('alert_sends_pending').on(t.alertDay, t.batchKey).where(sql`${t.resendId} is null and ${t.error} is null`),
    index('alert_sends_events').using('gin', t.eventIds),
  ],
);

export const settings = pgTable('settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  updatedAt: tstz('updated_at').notNull().defaultNow(),
});

export const CANDIDATE_STATES = ['inbox', 'snoozed', 'dismissed', 'added'] as const;

export const candidates = pgTable(
  'candidates',
  {
    id: text('id').primaryKey(),
    providerKey: text('provider_key').unique(),
    icalUid: text('ical_uid'),
    fuzzyKey: text('fuzzy_key').notNull(),
    title: text('title').notNull(),
    startAt: tstz('start_at').notNull(),
    endAt: tstz('end_at'),
    location: text('location'),
    links: text('links').array().notNull().default(sql`'{}'`),
    snippet: text('snippet'),
    rsvp: text('rsvp'),
    eventStatus: text('event_status'),
    kind: text('kind', { enum: ['event', 'roundup'] }).notNull().default('event'),
    sourceKinds: text('source_kinds').array().notNull().default(sql`'{}'`),
    suggestComment: text('suggest_comment'),
    suggestGoing: boolean('suggest_going').notNull().default(false),
    state: text('state', { enum: CANDIDATE_STATES }).notNull().default('inbox'),
    snoozedUntil: tstz('snoozed_until'),
    dismissedAt: tstz('dismissed_at'),
    eventId: text('event_id').references(() => events.id),
    firstSeen: tstz('first_seen').notNull().defaultNow(),
    lastSeen: tstz('last_seen').notNull().defaultNow(),
  },
  (t) => [
    check('candidates_snippet_len', sql`char_length(${t.snippet}) <= 300`),
    check('candidates_kind_check', inList('kind', ['event', 'roundup'])),
    check('candidates_state_check', inList('state', CANDIDATE_STATES)),
    uniqueIndex('candidates_fuzzy').on(t.fuzzyKey).where(sql`${t.providerKey} is null`),
  ],
);

export const candidateSightings = pgTable(
  'candidate_sightings',
  {
    candidateId: text('candidate_id')
      .notNull()
      .references(() => candidates.id, { onDelete: 'cascade' }),
    sourceKind: text('source_kind').notNull(),
    sourceRef: text('source_ref').notNull(),
    seenAt: tstz('seen_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.candidateId, t.sourceKind, t.sourceRef] })],
);

export const apiTokens = pgTable('api_tokens', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  tokenHash: text('token_hash').notNull().unique(), // vp_ + 32 random bytes, SHA-256
  scopes: text('scopes').array().notNull().default(sql`'{ingest}'`),
  lastUsedAt: tstz('last_used_at'),
  revokedAt: tstz('revoked_at'),
  createdAt: tstz('created_at').notNull().defaultNow(),
});

export const syncState = pgTable('sync_state', {
  source: text('source').primaryKey(),
  lastRunAt: tstz('last_run_at'),
  lastOkAt: tstz('last_ok_at'),
  cursor: text('cursor'),
  error: text('error'),
});

export const jobsLog = pgTable('jobs_log', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  job: text('job').notNull(),
  startedAt: tstz('started_at').notNull().defaultNow(),
  finishedAt: tstz('finished_at'),
  ok: boolean('ok'),
  detail: jsonb('detail'),
});

// P2 — kept so the schema matches the guide; unused until M5.
export const googleConnection = pgTable('google_connection', {
  id: text('id').primaryKey().default('victor'),
  refreshTokenEnc: bytea('refresh_token_enc').notNull(),
  scopes: text('scopes').array().notNull(),
  connectedAt: tstz('connected_at').notNull().defaultNow(),
  lastSyncAt: tstz('last_sync_at'),
});

// Public read model (guide「约束与索引说明」): strips created_via and auto_fields;
// address only surfaces when address_public = true.
const { address: _address, createdVia: _createdVia, autoFields: _autoFields, ...publicEventColumns } =
  getTableColumns(events);
export const eventsPublic = pgView('events_public').as((qb) =>
  qb
    .select({
      ...publicEventColumns,
      address: sql<string | null>`case when ${events.addressPublic} then ${events.address} end`.as('address'),
    })
    .from(events),
);

export type EventRow = typeof events.$inferSelect;
export type NewEvent = typeof events.$inferInsert;
export type CoverRow = typeof covers.$inferSelect;
