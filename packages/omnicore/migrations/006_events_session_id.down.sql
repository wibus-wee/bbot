BEGIN TRANSACTION;

CREATE TABLE events_new (
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

INSERT INTO events_new (seq, id, type, timestamp, actor_id, trace_id, causation_id, schema_version, payload_json)
SELECT seq, id, type, timestamp, actor_id, trace_id, causation_id, schema_version, payload_json
FROM events;

DROP TABLE events;
ALTER TABLE events_new RENAME TO events;

CREATE INDEX IF NOT EXISTS events_type_idx ON events(type);
CREATE INDEX IF NOT EXISTS events_trace_idx ON events(trace_id);
CREATE INDEX IF NOT EXISTS events_timestamp_idx ON events(timestamp);

COMMIT;
