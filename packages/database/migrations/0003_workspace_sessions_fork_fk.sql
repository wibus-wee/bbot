DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'workspace_sessions_forked_from_session_id_workspace_sessions_id_fk'
  ) THEN
    ALTER TABLE "workspace_sessions"
      ADD CONSTRAINT "workspace_sessions_forked_from_session_id_workspace_sessions_id_fk"
      FOREIGN KEY ("forked_from_session_id")
      REFERENCES "public"."workspace_sessions"("id")
      ON DELETE set null
      ON UPDATE no action;
  END IF;
END $$;
