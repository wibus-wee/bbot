ALTER TABLE events ADD COLUMN session_id TEXT NOT NULL DEFAULT 'session:default';

CREATE INDEX IF NOT EXISTS events_session_idx ON events(session_id);
