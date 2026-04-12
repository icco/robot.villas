CREATE TABLE "feed_poll_status" (
	"bot_username" text PRIMARY KEY NOT NULL,
	"last_checked_at" timestamp with time zone NOT NULL,
	"last_http_status" integer,
	"last_error" text
);
