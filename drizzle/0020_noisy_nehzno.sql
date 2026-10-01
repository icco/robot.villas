CREATE TABLE "maintenance_runs" (
	"deployment" text NOT NULL,
	"job" text NOT NULL,
	"enqueued_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "maintenance_runs_deployment_job_unique" UNIQUE("deployment","job")
);
--> statement-breakpoint
ALTER TABLE "feed_poll_status" ADD COLUMN "claim_token" text;--> statement-breakpoint
CREATE INDEX "publications_queued_at_idx" ON "publications" USING btree ("queued_at") WHERE "publications"."queued_at" IS NOT NULL;