ALTER TABLE "following" ADD COLUMN "status_changed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "relays" ADD COLUMN "status_changed_at" timestamp with time zone;