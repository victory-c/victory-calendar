CREATE TYPE "public"."event_status" AS ENUM('draft', 'published', 'cancelled', 'archived');--> statement-breakpoint
CREATE TYPE "public"."going_status" AS ENUM('none', 'interested', 'going', 'hosting', 'speaking');--> statement-breakpoint
CREATE TYPE "public"."going_vis" AS ENUM('public', 'after_event', 'hidden');--> statement-breakpoint
CREATE TABLE "api_tokens" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"token_hash" text NOT NULL,
	"scopes" text[] DEFAULT '{ingest}' NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "api_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "candidate_sightings" (
	"candidate_id" text NOT NULL,
	"source_kind" text NOT NULL,
	"source_ref" text NOT NULL,
	"seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "candidate_sightings_candidate_id_source_kind_source_ref_pk" PRIMARY KEY("candidate_id","source_kind","source_ref")
);
--> statement-breakpoint
CREATE TABLE "candidates" (
	"id" text PRIMARY KEY NOT NULL,
	"provider_key" text,
	"ical_uid" text,
	"fuzzy_key" text NOT NULL,
	"title" text NOT NULL,
	"start_at" timestamp with time zone NOT NULL,
	"end_at" timestamp with time zone,
	"location" text,
	"links" text[] DEFAULT '{}' NOT NULL,
	"snippet" text,
	"rsvp" text,
	"event_status" text,
	"kind" text DEFAULT 'event' NOT NULL,
	"source_kinds" text[] DEFAULT '{}' NOT NULL,
	"suggest_comment" text,
	"suggest_going" boolean DEFAULT false NOT NULL,
	"state" text DEFAULT 'inbox' NOT NULL,
	"snoozed_until" timestamp with time zone,
	"dismissed_at" timestamp with time zone,
	"event_id" text,
	"first_seen" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "candidates_provider_key_unique" UNIQUE("provider_key"),
	CONSTRAINT "candidates_snippet_len" CHECK (char_length("candidates"."snippet") <= 300),
	CONSTRAINT "candidates_kind_check" CHECK (kind in ('event','roundup')),
	CONSTRAINT "candidates_state_check" CHECK (state in ('inbox','snoozed','dismissed','added'))
);
--> statement-breakpoint
CREATE TABLE "covers" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"url_1600" text NOT NULL,
	"url_800" text NOT NULL,
	"url_400" text NOT NULL,
	"url_og_en" text NOT NULL,
	"url_og_zh" text NOT NULL,
	"thumbhash" text NOT NULL,
	"dominant" text NOT NULL,
	"bytes" integer NOT NULL,
	"letterboxed" boolean DEFAULT false NOT NULL,
	"source_url" text,
	"source_page_url" text,
	"license" text,
	"attribution" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "covers_kind_check" CHECK (kind in ('official','host_composite','template','openverse','ai','brave','upload','url'))
);
--> statement-breakpoint
CREATE TABLE "digest_issues" (
	"id" text PRIMARY KEY NOT NULL,
	"iso_week" text NOT NULL,
	"intro_en" text,
	"intro_zh" text,
	"featured_ids" text[] DEFAULT '{}' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"send_after" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "digest_issues_iso_week_unique" UNIQUE("iso_week"),
	CONSTRAINT "digest_issues_status_check" CHECK (status in ('draft','scheduled','sending','sent'))
);
--> statement-breakpoint
CREATE TABLE "digest_sends" (
	"issue_id" text NOT NULL,
	"subscriber_id" text NOT NULL,
	"variant_key" text NOT NULL,
	"claimed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resend_id" text,
	"sent_at" timestamp with time zone,
	CONSTRAINT "digest_sends_issue_id_subscriber_id_pk" PRIMARY KEY("issue_id","subscriber_id")
);
--> statement-breakpoint
CREATE TABLE "event_sources" (
	"event_id" text NOT NULL,
	"platform" text NOT NULL,
	"external_id" text NOT NULL,
	"url" text NOT NULL,
	"ical_uid" text,
	CONSTRAINT "event_sources_event_id_platform_external_id_pk" PRIMARY KEY("event_id","platform","external_id"),
	CONSTRAINT "event_sources_platform_external_id" UNIQUE("platform","external_id"),
	CONSTRAINT "event_sources_platform_check" CHECK (platform in ('luma','partiful','eventbrite','meetup','other'))
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"status" "event_status" DEFAULT 'draft' NOT NULL,
	"title_en" text,
	"title_zh" text,
	"summary_en" text,
	"summary_zh" text,
	"note_en" text,
	"note_zh" text,
	"auto_fields" text[] DEFAULT '{}' NOT NULL,
	"category" text,
	"category_confidence" real,
	"tags" text[] DEFAULT '{}' NOT NULL,
	"event_language" text DEFAULT 'en' NOT NULL,
	"start_at" timestamp with time zone,
	"end_at" timestamp with time zone,
	"tz" text DEFAULT 'America/Los_Angeles' NOT NULL,
	"all_day" boolean DEFAULT false NOT NULL,
	"format" text DEFAULT 'in_person' NOT NULL,
	"venue_name" text,
	"city" text,
	"neighborhood" text,
	"region" text,
	"address" text,
	"address_public" boolean DEFAULT false NOT NULL,
	"private_venue" boolean DEFAULT false NOT NULL,
	"price_text" text,
	"access" text DEFAULT 'unknown' NOT NULL,
	"host_name" text,
	"host_url" text,
	"source_url" text NOT NULL,
	"going" "going_status" DEFAULT 'interested' NOT NULL,
	"going_visibility" "going_vis" DEFAULT 'public' NOT NULL,
	"featured" boolean DEFAULT false NOT NULL,
	"cover_id" text,
	"cover_policy" text DEFAULT 'official' NOT NULL,
	"sequence" integer DEFAULT 0 NOT NULL,
	"created_via" text DEFAULT 'admin' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone,
	CONSTRAINT "events_slug_unique" UNIQUE("slug"),
	CONSTRAINT "events_category_check" CHECK ("events"."category" is null or category in ('ai','hackathon','vc','campus','conference','cycling','social')),
	CONSTRAINT "events_event_language_check" CHECK (event_language in ('en','zh','bilingual')),
	CONSTRAINT "events_format_check" CHECK (format in ('in_person','online','hybrid')),
	CONSTRAINT "events_region_check" CHECK ("events"."region" is null or region in ('sf','east_bay','peninsula','south_bay','north_bay','online')),
	CONSTRAINT "events_access_check" CHECK (access in ('open','apply','waitlist','sold_out','unknown')),
	CONSTRAINT "events_cover_policy_check" CHECK (cover_policy in ('official','template')),
	CONSTRAINT "events_created_via_check" CHECK (created_via in ('admin','shortcut','share_target','skill','inbox')),
	CONSTRAINT "events_published_complete" CHECK ("events"."status" <> 'published' or ("events"."start_at" is not null and "events"."category" is not null and "events"."cover_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "google_connection" (
	"id" text PRIMARY KEY DEFAULT 'victor' NOT NULL,
	"refresh_token_enc" "bytea" NOT NULL,
	"scopes" text[] NOT NULL,
	"connected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_sync_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "jobs_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"job" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"ok" boolean,
	"detail" jsonb
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subscribers" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"locale" text DEFAULT 'en' NOT NULL,
	"categories" text[] DEFAULT '{}' NOT NULL,
	"going_alerts" boolean DEFAULT false NOT NULL,
	"ev_lang_pref" text[],
	"online_only" boolean,
	"token_version" integer DEFAULT 1 NOT NULL,
	"consent_at" timestamp with time zone,
	"consent_ip" "inet",
	"consent_ua" text,
	"consent_source" text,
	"confirmed_at" timestamp with time zone,
	"paused_until" timestamp with time zone,
	"unsubscribed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subscribers_email_unique" UNIQUE("email"),
	CONSTRAINT "subscribers_status_check" CHECK (status in ('pending','active','paused','unsubscribed','suppressed')),
	CONSTRAINT "subscribers_locale_check" CHECK (locale in ('en','zh'))
);
--> statement-breakpoint
CREATE TABLE "sync_state" (
	"source" text PRIMARY KEY NOT NULL,
	"last_run_at" timestamp with time zone,
	"last_ok_at" timestamp with time zone,
	"cursor" text,
	"error" text
);
--> statement-breakpoint
ALTER TABLE "candidate_sightings" ADD CONSTRAINT "candidate_sightings_candidate_id_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."candidates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidates" ADD CONSTRAINT "candidates_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "digest_sends" ADD CONSTRAINT "digest_sends_issue_id_digest_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."digest_issues"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "digest_sends" ADD CONSTRAINT "digest_sends_subscriber_id_subscribers_id_fk" FOREIGN KEY ("subscriber_id") REFERENCES "public"."subscribers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_sources" ADD CONSTRAINT "event_sources_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_cover_id_covers_id_fk" FOREIGN KEY ("cover_id") REFERENCES "public"."covers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "candidates_fuzzy" ON "candidates" USING btree ("fuzzy_key") WHERE "candidates"."provider_key" is null;--> statement-breakpoint
CREATE INDEX "event_sources_ical" ON "event_sources" USING btree ("ical_uid");--> statement-breakpoint
CREATE INDEX "events_pub_start" ON "events" USING btree ("status","start_at") WHERE "events"."status" = 'published';--> statement-breakpoint
CREATE INDEX "events_category" ON "events" USING btree ("category","start_at");--> statement-breakpoint
CREATE INDEX "subscribers_active" ON "subscribers" USING btree ("status","locale") WHERE "subscribers"."status" = 'active';--> statement-breakpoint
CREATE VIEW "public"."events_public" AS (select "id", "slug", "status", "title_en", "title_zh", "summary_en", "summary_zh", "note_en", "note_zh", "category", "category_confidence", "tags", "event_language", "start_at", "end_at", "tz", "all_day", "format", "venue_name", "city", "neighborhood", "region", "address_public", "private_venue", "price_text", "access", "host_name", "host_url", "source_url", "going", "going_visibility", "featured", "cover_id", "cover_policy", "sequence", "created_at", "updated_at", "published_at", case when "address_public" then "address" end as "address" from "events");