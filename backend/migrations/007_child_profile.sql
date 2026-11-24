-- Additive, rerunnable. Apply AFTER 006 and BEFORE updating API/analysis worker.
BEGIN;
SET LOCAL lock_timeout = '10s';
SELECT pg_advisory_xact_lock(728307);
ALTER TABLE care_profiles ADD COLUMN IF NOT EXISTS child_name VARCHAR(100);
ALTER TABLE care_profiles ADD COLUMN IF NOT EXISTS child_age_months INTEGER;
ALTER TABLE care_profiles ADD COLUMN IF NOT EXISTS age_recorded_on DATE;
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='ck_care_profile_age' AND conrelid='care_profiles'::regclass) THEN
  ALTER TABLE care_profiles ADD CONSTRAINT ck_care_profile_age CHECK (
    (child_age_months IS NULL AND age_recorded_on IS NULL) OR
    (child_age_months IS NOT NULL AND child_age_months BETWEEN 0 AND 71 AND age_recorded_on IS NOT NULL));
 END IF;
END $$;
COMMIT;
