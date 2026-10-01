CREATE TABLE "publications" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "publications_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"entry_id" integer NOT NULL,
	"actor_id" text NOT NULL,
	"inbox_url" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"queued_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "publications_entry_id_inbox_url_unique" UNIQUE("entry_id","inbox_url")
);
--> statement-breakpoint
ALTER TABLE "publications" ADD CONSTRAINT "publications_entry_id_feed_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."feed_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "publications_pending_idx" ON "publications" USING btree ("next_attempt_at") WHERE "publications"."queued_at" IS NULL AND "publications"."cancelled_at" IS NULL;