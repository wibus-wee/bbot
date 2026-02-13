CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
DROP INDEX IF EXISTS "session_entries_session_search_idx";--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "session_entries_message_search_trgm_idx"
ON "session_entries"
USING gin ("search_text" gin_trgm_ops)
WHERE "kind" = 'message' AND "search_text" IS NOT NULL;
