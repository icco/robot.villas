CREATE TYPE "public"."relay_status" AS ENUM('pending', 'accepted', 'rejected');--> statement-breakpoint
CREATE TABLE "relays" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "relays_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"url" text NOT NULL,
	"inbox_url" text,
	"actor_id" text,
	"status" "relay_status" DEFAULT 'pending' NOT NULL,
	"follow_activity_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "relays_url_unique" UNIQUE("url")
);
