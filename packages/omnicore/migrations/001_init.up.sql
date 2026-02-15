CREATE TABLE IF NOT EXISTS schema_migrations (
  id TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS events (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL,
  timestamp TEXT NOT NULL,
  actor_id TEXT,
  trace_id TEXT NOT NULL,
  causation_id TEXT,
  schema_version INTEGER NOT NULL DEFAULT 1,
  payload_json TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS events_type_idx ON events(type);
CREATE INDEX IF NOT EXISTS events_trace_idx ON events(trace_id);
CREATE INDEX IF NOT EXISTS events_timestamp_idx ON events(timestamp);

CREATE TABLE IF NOT EXISTS kernel_config (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  heartbeat_ms INTEGER NOT NULL,
  model_provider TEXT,
  model_name TEXT,
  updated_at TEXT NOT NULL
);

INSERT OR IGNORE INTO kernel_config (id, heartbeat_ms, model_provider, model_name, updated_at)
VALUES (1, 60000, NULL, NULL, datetime('now'));

CREATE TABLE IF NOT EXISTS secrets (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS kv_store (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
