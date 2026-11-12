-- Run before starting code that reads TrainingJob. Existing jobs remain NULL/NULL.
BEGIN;
SELECT pg_advisory_xact_lock(728303);
ALTER TABLE training_jobs ADD COLUMN IF NOT EXISTS modalities JSON;
ALTER TABLE training_jobs ADD COLUMN IF NOT EXISTS training_policy JSON;
COMMIT;
