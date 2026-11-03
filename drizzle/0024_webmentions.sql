CREATE TABLE "remote_actors" (
	"actor_id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"profile_url" text NOT NULL,
	"icon_url" text,
	"excluded_reason" text,
	"fetched_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "feed_entries" ADD COLUMN "webmention_target" text;--> statement-breakpoint
ALTER TABLE "reactions" ADD COLUMN "page_id" text;--> statement-breakpoint
ALTER TABLE "reactions" ADD COLUMN "created_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "reactions_page_id_unique" ON "reactions" USING btree ("page_id");--> statement-breakpoint
CREATE INDEX "reactions_entry_id_idx" ON "reactions" USING btree ("entry_id");