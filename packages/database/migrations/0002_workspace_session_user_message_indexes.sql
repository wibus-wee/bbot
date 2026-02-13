CREATE INDEX IF NOT EXISTS "user_messages_session_kind_idx" ON "user_messages" USING btree ("session_id","kind");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_messages_run_time_idx" ON "user_messages" USING btree ("run_id","timestamp");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workspace_sessions_chat_user_idx" ON "workspace_sessions" USING btree ("telegram_chat_id","telegram_user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workspace_sessions_forked_from_idx" ON "workspace_sessions" USING btree ("forked_from_session_id");
