BEGIN TRANSACTION;

CREATE TABLE kernel_config_new (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  heartbeat_ms INTEGER NOT NULL,
  model_provider TEXT,
  model_name TEXT,
  model_base_url TEXT,
  updated_at TEXT NOT NULL
);

INSERT INTO kernel_config_new (id, heartbeat_ms, model_provider, model_name, model_base_url, updated_at)
SELECT id, heartbeat_ms, model_provider, model_name, model_base_url, updated_at
FROM kernel_config;

DROP TABLE kernel_config;
ALTER TABLE kernel_config_new RENAME TO kernel_config;

COMMIT;
