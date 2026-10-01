CREATE TABLE "reactions" (
	"activity_id" text PRIMARY KEY NOT NULL,
	"actor_id" text NOT NULL,
	"entry_id" integer NOT NULL,
	"kind" text NOT NULL,
	"content" text DEFAULT '' NOT NULL,
	"undone_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "reactions" ADD CONSTRAINT "reactions_entry_id_feed_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."feed_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "reactions_active_unique" ON "reactions" USING btree ("actor_id","entry_id","kind","content") WHERE "reactions"."undone_at" IS NULL;