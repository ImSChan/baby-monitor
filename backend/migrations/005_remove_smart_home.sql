-- Destructive retirement: back up PostgreSQL before applying manually.
-- No CASCADE: unexpected dependencies must abort the whole transaction.
BEGIN;
SET LOCAL lock_timeout = '10s';
SELECT pg_advisory_xact_lock(728305);
DROP TABLE IF EXISTS device_states;
DROP TABLE IF EXISTS environment_states;
COMMIT;
