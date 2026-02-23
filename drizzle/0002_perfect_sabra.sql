CREATE TABLE "following" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "following_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"bot_username" text NOT NULL,
	"handle" text NOT NULL,
	"target_actor_id" text,
	"follow_activity_id" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "following_bot_username_handle_unique" UNIQUE("bot_username","handle")
);
