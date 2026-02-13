CREATE TYPE IF NOT EXISTS "public"."session_entry_kind" AS ENUM('message', 'action', 'result', 'summary', 'system');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "session_entries" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"run_id" text,
	"kind" "session_entry_kind" NOT NULL,
	"payload" jsonb NOT NULL,
	"search_text" text,
	"sequence" bigserial NOT NULL,
	"timestamp" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$
BEGIN
	IF EXISTS (
		SELECT 1
		FROM information_schema.tables
		WHERE table_schema = 'public' AND table_name = 'user_messages'
	) THEN
		INSERT INTO "session_entries" ("id", "session_id", "run_id", "kind", "payload", "search_text", "timestamp")
		SELECT
			"id",
			"session_id",
			"run_id",
			'message',
			jsonb_build_object(
				'role', CASE WHEN "kind" = 'user' THEN 'user' ELSE 'assistant' END,
				'content', jsonb_build_array(jsonb_build_object('type', 'text', 'text', "content")),
				'timestamp', (extract(epoch from "timestamp") * 1000)::bigint
			),
			"content",
			"timestamp"
		FROM "user_messages"
		ON CONFLICT ("id") DO NOTHING;
	END IF;
END $$;
--> statement-breakpoint
DROP TABLE IF EXISTS "user_messages" CASCADE;--> statement-breakpoint
DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1
		FROM pg_constraint
		WHERE conname = 'session_entries_session_id_workspace_sessions_id_fk'
			AND conrelid = 'public.session_entries'::regclass
	) THEN
		ALTER TABLE "session_entries"
			ADD CONSTRAINT "session_entries_session_id_workspace_sessions_id_fk"
			FOREIGN KEY ("session_id")
			REFERENCES "public"."workspace_sessions"("id")
			ON DELETE cascade ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1
		FROM pg_constraint
		WHERE conname = 'session_entries_run_id_runs_id_fk'
			AND conrelid = 'public.session_entries'::regclass
	) THEN
		ALTER TABLE "session_entries"
			ADD CONSTRAINT "session_entries_run_id_runs_id_fk"
			FOREIGN KEY ("run_id")
			REFERENCES "public"."runs"("id")
			ON DELETE cascade ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "session_entries_session_sequence_idx" ON "session_entries" USING btree ("session_id","sequence");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "session_entries_run_sequence_idx" ON "session_entries" USING btree ("run_id","sequence");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "session_entries_session_search_idx" ON "session_entries" USING btree ("session_id","search_text");--> statement-breakpoint
DROP TYPE IF EXISTS "public"."user_message_kind";
