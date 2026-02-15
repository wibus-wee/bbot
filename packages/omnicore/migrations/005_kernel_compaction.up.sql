ALTER TABLE kernel_config
ADD COLUMN compaction_enabled INTEGER;

ALTER TABLE kernel_config
ADD COLUMN compaction_reserve_tokens INTEGER;

ALTER TABLE kernel_config
ADD COLUMN compaction_keep_recent_tokens INTEGER;

ALTER TABLE kernel_config
ADD COLUMN compaction_auto_compact_token_limit INTEGER;
