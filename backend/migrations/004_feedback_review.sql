-- Apply with ON_ERROR_STOP, before deploying API/analysis/notification/training.
-- Additive only. Never drop data or reset running/reserved jobs.
BEGIN;
SET LOCAL lock_timeout = '10s';
SELECT pg_advisory_xact_lock(728304);
ALTER TABLE inference_feedback ADD COLUMN IF NOT EXISTS learning_group VARCHAR(36);
CREATE INDEX IF NOT EXISTS ix_inference_feedback_learning_group ON inference_feedback(learning_group);
CREATE TABLE IF NOT EXISTS review_analyses (
 id SERIAL PRIMARY KEY, request_id VARCHAR(36) NOT NULL UNIQUE,
 user_id INTEGER NOT NULL REFERENCES app_users(id),
 emotion_event_id INTEGER NOT NULL REFERENCES emotion_events(id),
 camera_key INTEGER NOT NULL DEFAULT 0, state VARCHAR(100) NOT NULL,
 episode_key VARCHAR(36) NOT NULL, result JSON NOT NULL,
 captured_at TIMESTAMP NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_review_analyses_user_camera_time ON review_analyses(user_id, camera_key, captured_at, id);
CREATE INDEX IF NOT EXISTS ix_review_analyses_episode_key ON review_analyses(episode_key);
CREATE TABLE IF NOT EXISTS review_schedules (
 user_id INTEGER PRIMARY KEY REFERENCES app_users(id), enabled BOOLEAN NOT NULL DEFAULT FALSE,
 first_time VARCHAR(5) NOT NULL DEFAULT '10:00', timezone VARCHAR(100) NOT NULL DEFAULT 'Asia/Seoul',
 enabled_at TIMESTAMP NOT NULL DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Seoul')
);
CREATE TABLE IF NOT EXISTS review_actions (
 id VARCHAR(36) PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES app_users(id),
 payload_hash VARCHAR(64) NOT NULL, changes JSON NOT NULL, undone BOOLEAN NOT NULL DEFAULT FALSE,
 created_at TIMESTAMP NOT NULL DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Seoul')
);
CREATE INDEX IF NOT EXISTS ix_review_actions_user_id ON review_actions(user_id);
COMMIT;
