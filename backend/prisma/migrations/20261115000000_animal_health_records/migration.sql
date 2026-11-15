CREATE TABLE "health_records" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "animal_id" UUID NOT NULL,
  "record_type" VARCHAR(20) NOT NULL,
  "status" VARCHAR(16) NOT NULL DEFAULT 'ongoing',
  "occurred_at" TIMESTAMPTZ(6) NOT NULL,
  "title" VARCHAR(160) NOT NULL,
  "symptoms" TEXT,
  "diagnosis" TEXT,
  "suspected_condition" TEXT,
  "veterinarian" VARCHAR(160),
  "clinic" VARCHAR(160),
  "medication" VARCHAR(160),
  "dosage" VARCHAR(120),
  "frequency" VARCHAR(120),
  "treatment_start_at" TIMESTAMPTZ(6),
  "treatment_end_at" TIMESTAMPTZ(6),
  "next_due_at" TIMESTAMPTZ(6),
  "notes" TEXT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "health_records_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "health_records_animal_id_fkey" FOREIGN KEY ("animal_id") REFERENCES "animals"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "health_records_type_check" CHECK ("record_type" IN ('symptom','visit','diagnosis','suspicion','treatment','checkup')),
  CONSTRAINT "health_records_status_check" CHECK ("status" IN ('ongoing','resolved','chronic')),
  CONSTRAINT "health_records_treatment_dates_check" CHECK ("treatment_end_at" IS NULL OR "treatment_start_at" IS NULL OR "treatment_end_at" >= "treatment_start_at")
);
CREATE INDEX "health_records_animal_occurred_idx" ON "health_records"("animal_id","occurred_at" DESC);
CREATE INDEX "health_records_animal_status_idx" ON "health_records"("animal_id","status");
