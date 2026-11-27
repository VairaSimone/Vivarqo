ALTER TABLE "companion_care_records"
  ADD COLUMN "clinic" VARCHAR(160),
  ADD COLUMN "treatment_start_at" TIMESTAMPTZ(6),
  ADD COLUMN "treatment_end_at" TIMESTAMPTZ(6),
  ADD COLUMN "is_ongoing" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "companion_care_records"
  ADD CONSTRAINT "companion_care_records_treatment_dates_check"
  CHECK ("treatment_start_at" IS NULL OR "treatment_end_at" IS NULL OR "treatment_end_at" >= "treatment_start_at");

CREATE INDEX "companion_care_records_animal_ongoing_idx"
  ON "companion_care_records"("animal_id", "is_ongoing")
  WHERE "deleted_at" IS NULL AND "is_ongoing" = true;

ALTER TABLE "companion_care_records"
  ADD CONSTRAINT "companion_care_records_ongoing_medication_check"
  CHECK (NOT "is_ongoing" OR ("kind" = 'medication' AND "treatment_end_at" IS NULL));

ALTER TABLE "companion_care_records" ADD COLUMN "frequency" VARCHAR(120);
