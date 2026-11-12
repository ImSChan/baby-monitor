-- Additive and rerunnable. Existing feedback, PostgreSQL data and weights untouched.
BEGIN;
SELECT pg_advisory_xact_lock(728302);
CREATE TABLE IF NOT EXISTS push_devices (
 id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES app_users(id),
 token VARCHAR(4096) NOT NULL UNIQUE, installation_id VARCHAR(36) NOT NULL UNIQUE,
 platform VARCHAR(20) NOT NULL DEFAULT 'android', active BOOLEAN NOT NULL DEFAULT TRUE,
 updated_at TIMESTAMP NOT NULL DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Seoul')
);
CREATE INDEX IF NOT EXISTS ix_push_devices_user_id ON push_devices(user_id);
CREATE TABLE IF NOT EXISTS notification_events (
 id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES app_users(id),
 request_id VARCHAR(36) NOT NULL UNIQUE, emotion_event_id INTEGER NOT NULL REFERENCES emotion_events(id),
 result JSON NOT NULL, status VARCHAR(20) NOT NULL DEFAULT 'pending',
 created_at TIMESTAMP NOT NULL DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Seoul'),
 available_at TIMESTAMP NOT NULL DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Seoul'),
 expires_at TIMESTAMP NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_notification_events_user_id ON notification_events(user_id);
CREATE INDEX IF NOT EXISTS ix_notification_events_available_at ON notification_events(available_at);
CREATE INDEX IF NOT EXISTS ix_notification_events_status ON notification_events(status);
CREATE TABLE IF NOT EXISTS push_deliveries (
 id SERIAL PRIMARY KEY, event_id INTEGER NOT NULL REFERENCES notification_events(id),
 device_id INTEGER NOT NULL REFERENCES push_devices(id), token VARCHAR(4096) NOT NULL,
 status VARCHAR(20) NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0,
 next_attempt_at TIMESTAMP NOT NULL DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Seoul'),
 error_code VARCHAR(100), message_id VARCHAR(255), UNIQUE(event_id, device_id)
);
CREATE INDEX IF NOT EXISTS ix_push_deliveries_event_id ON push_deliveries(event_id);
CREATE INDEX IF NOT EXISTS ix_push_deliveries_status ON push_deliveries(status);
CREATE INDEX IF NOT EXISTS ix_push_deliveries_next_attempt_at ON push_deliveries(next_attempt_at);
COMMIT;
