DROP INDEX IF EXISTS "companion_care_records_animal_ongoing_idx";

CREATE INDEX "companion_care_records_animal_ongoing_idx"
  ON "companion_care_records"("animal_id", "is_ongoing")
  WHERE "deleted_at" IS NULL AND "is_ongoing";
