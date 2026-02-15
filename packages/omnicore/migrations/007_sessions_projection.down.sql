BEGIN TRANSACTION;

DROP TABLE IF EXISTS sessions;
DELETE FROM projections WHERE name = 'sessions_projection';

COMMIT;
