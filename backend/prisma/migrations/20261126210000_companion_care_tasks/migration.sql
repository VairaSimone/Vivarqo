ALTER TABLE "companion_care_records"
  ADD COLUMN "completed_at" TIMESTAMPTZ(6);

ALTER TABLE "tasks"
  ADD COLUMN "companion_care_record_id" UUID;

CREATE UNIQUE INDEX "tasks_companion_care_record_id_key"
  ON "tasks"("companion_care_record_id");

ALTER TABLE "tasks"
  ADD CONSTRAINT "tasks_companion_care_record_id_fkey"
  FOREIGN KEY ("companion_care_record_id")
  REFERENCES "companion_care_records"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
