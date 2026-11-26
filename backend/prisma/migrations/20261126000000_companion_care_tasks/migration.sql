ALTER TABLE "tasks"
  ADD COLUMN "companion_care_record_id" UUID;

CREATE UNIQUE INDEX "tasks_companion_care_record_id_key"
  ON "tasks"("companion_care_record_id");

-- This migration sorts before companion_care_records is created on a clean database.
-- Keep it safe for databases where that table already exists; the deferred migration
-- adds the column and relation after 20261126200000_companion_care_management.
DO $$
BEGIN
  IF to_regclass('public.companion_care_records') IS NOT NULL THEN
    ALTER TABLE "companion_care_records"
      ADD COLUMN IF NOT EXISTS "completed_at" TIMESTAMPTZ(6);
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint WHERE conname = 'tasks_companion_care_record_id_fkey'
    ) THEN
      ALTER TABLE "tasks"
        ADD CONSTRAINT "tasks_companion_care_record_id_fkey"
        FOREIGN KEY ("companion_care_record_id")
        REFERENCES "companion_care_records"("id")
        ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
  END IF;
END $$;
