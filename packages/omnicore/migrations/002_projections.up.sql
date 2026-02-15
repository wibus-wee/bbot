CREATE TABLE IF NOT EXISTS projections (
  name TEXT PRIMARY KEY,
  cursor_seq INTEGER NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS context_views (
  name TEXT PRIMARY KEY,
  payload_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
