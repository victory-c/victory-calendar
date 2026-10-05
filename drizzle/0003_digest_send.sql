ALTER TABLE "digest_issues" ADD COLUMN "auto_fields" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "digest_issues" ADD COLUMN "keep_cover_ids" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "digest_issues" ADD COLUMN "snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "digest_sends" ADD COLUMN "kind" text DEFAULT 'digest' NOT NULL;--> statement-breakpoint
ALTER TABLE "digest_sends" ADD COLUMN "batch_key" text;--> statement-breakpoint
ALTER TABLE "digest_sends" ADD COLUMN "error" text;--> statement-breakpoint
CREATE INDEX "digest_sends_pending" ON "digest_sends" USING btree ("issue_id","batch_key") WHERE "digest_sends"."resend_id" is null and "digest_sends"."error" is null;--> statement-breakpoint
ALTER TABLE "digest_sends" ADD CONSTRAINT "digest_sends_kind_check" CHECK (kind in ('digest','empty'));