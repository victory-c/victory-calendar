CREATE TABLE "alert_sends" (
	"alert_day" text NOT NULL,
	"subscriber_id" text NOT NULL,
	"event_ids" text[] NOT NULL,
	"variant_key" text NOT NULL,
	"claimed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"batch_key" text,
	"resend_id" text,
	"sent_at" timestamp with time zone,
	"error" text,
	CONSTRAINT "alert_sends_alert_day_subscriber_id_pk" PRIMARY KEY("alert_day","subscriber_id"),
	CONSTRAINT "alert_sends_day_check" CHECK ("alert_sends"."alert_day" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
	CONSTRAINT "alert_sends_event_ids_check" CHECK (cardinality("alert_sends"."event_ids") between 1 and 20)
);
--> statement-breakpoint
CREATE TABLE "going_marks" (
	"event_id" text PRIMARY KEY NOT NULL,
	"marked_at" timestamp with time zone NOT NULL,
	"alert" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
ALTER TABLE "subscribers" ADD COLUMN "going_alerts_since" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "alert_sends" ADD CONSTRAINT "alert_sends_subscriber_id_subscribers_id_fk" FOREIGN KEY ("subscriber_id") REFERENCES "public"."subscribers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "going_marks" ADD CONSTRAINT "going_marks_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "alert_sends_pending" ON "alert_sends" USING btree ("alert_day","batch_key") WHERE "alert_sends"."resend_id" is null and "alert_sends"."error" is null;--> statement-breakpoint
CREATE INDEX "alert_sends_events" ON "alert_sends" USING gin ("event_ids");