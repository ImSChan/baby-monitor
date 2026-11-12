-- Run after 001_push.sql. Additive: existing analysis/feedback/weights preserved.
BEGIN;
SELECT pg_advisory_xact_lock(728302);
ALTER TABLE notification_events ADD COLUMN IF NOT EXISTS read_at TIMESTAMP;
CREATE TABLE IF NOT EXISTS notification_preferences (
 user_id INTEGER PRIMARY KEY REFERENCES app_users(id),
 enabled BOOLEAN NOT NULL DEFAULT FALSE,
 enabled_at TIMESTAMP NOT NULL DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Seoul')
);
CREATE TABLE IF NOT EXISTS notification_observations (
 id SERIAL PRIMARY KEY, request_id VARCHAR(36) NOT NULL UNIQUE,
 user_id INTEGER NOT NULL REFERENCES app_users(id), camera_key INTEGER NOT NULL DEFAULT 0,
 state VARCHAR(100) NOT NULL,
 created_at TIMESTAMP NOT NULL DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Seoul')
);
CREATE INDEX IF NOT EXISTS ix_notification_observations_user_id ON notification_observations(user_id);
CREATE INDEX IF NOT EXISTS ix_notification_observations_sequence ON notification_observations(user_id, camera_key, id DESC);
COMMIT;
