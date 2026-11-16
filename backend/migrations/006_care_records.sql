-- Additive only; apply before API and analysis-worker update.
BEGIN;
SET LOCAL lock_timeout = '10s';
SELECT pg_advisory_xact_lock(728306);
ALTER TABLE emotion_events ADD COLUMN IF NOT EXISTS care_context JSON;
CREATE TABLE IF NOT EXISTS care_profiles (
 user_id INTEGER PRIMARY KEY REFERENCES app_users(id), context_enabled BOOLEAN NOT NULL DEFAULT TRUE
);
CREATE TABLE IF NOT EXISTS care_records (
 id VARCHAR(36) PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES app_users(id),
 kind VARCHAR(10) NOT NULL CHECK (kind IN ('feeding','sleep')),
 meal_type VARCHAR(10), started_at TIMESTAMP NOT NULL, ended_at TIMESTAMP,
 revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
 created_at TIMESTAMP NOT NULL DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Seoul'),
 updated_at TIMESTAMP NOT NULL DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Seoul'), deleted_at TIMESTAMP,
 CHECK ((kind='feeding' AND meal_type IS NOT NULL AND meal_type IN ('milk','meal','snack') AND ended_at IS NULL)
     OR (kind='sleep' AND meal_type IS NULL AND ended_at IS NOT NULL AND ended_at > started_at AND ended_at <= started_at + INTERVAL '24 hours'))
);
CREATE INDEX IF NOT EXISTS ix_care_records_user_time ON care_records(user_id, started_at);
COMMIT;
