ALTER TYPE "public"."user_message_kind" ADD VALUE IF NOT EXISTS 'user';--> statement-breakpoint
ALTER TABLE "workspace_sessions" ADD COLUMN IF NOT EXISTS "telegram_chat_id" text;--> statement-breakpoint
ALTER TABLE "workspace_sessions" ADD COLUMN IF NOT EXISTS "telegram_user_id" text;--> statement-breakpoint
ALTER TABLE "workspace_sessions" ADD COLUMN IF NOT EXISTS "forked_from_session_id" text;
