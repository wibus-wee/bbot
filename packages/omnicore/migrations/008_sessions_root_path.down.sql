BEGIN TRANSACTION;

CREATE TABLE sessions_new (
  id TEXT PRIMARY KEY,
  title TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_event_seq INTEGER NOT NULL DEFAULT 0,
  last_event_at TEXT NOT NULL,
  summary TEXT,
  archived_at TEXT
);

INSERT INTO sessions_new (
  id,
  title,
  status,
  created_at,
  updated_at,
  last_event_seq,
  last_event_at,
  summary,
  archived_at
)
SELECT
  id,
  title,
  status,
  created_at,
  updated_at,
  last_event_seq,
  last_event_at,
  summary,
  archived_at
FROM sessions;

DROP TABLE sessions;
ALTER TABLE sessions_new RENAME TO sessions;

CREATE INDEX IF NOT EXISTS sessions_status_idx ON sessions(status);
CREATE INDEX IF NOT EXISTS sessions_updated_idx ON sessions(updated_at);

COMMIT;
