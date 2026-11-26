ALTER TABLE "companion_care_records"
  ADD COLUMN IF NOT EXISTS "completed_at" TIMESTAMPTZ(6);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tasks_companion_care_record_id_fkey'
  ) THEN
    ALTER TABLE "tasks"
      ADD CONSTRAINT "tasks_companion_care_record_id_fkey"
      FOREIGN KEY ("companion_care_record_id")
      REFERENCES "companion_care_records"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
