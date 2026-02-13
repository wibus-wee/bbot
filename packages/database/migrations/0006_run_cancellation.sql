ALTER TYPE "public"."run_status" ADD VALUE IF NOT EXISTS 'canceled';--> statement-breakpoint
ALTER TYPE "public"."run_event_type" ADD VALUE IF NOT EXISTS 'run.canceled';
