CREATE TABLE IF NOT EXISTS "system_configs" (
	"id" text PRIMARY KEY NOT NULL,
	"key" varchar(200) NOT NULL,
	"value" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "system_configs_key_unique" ON "system_configs" USING btree ("key");
