CREATE TABLE "companion_care_records" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id" UUID NOT NULL,
  "animal_id" UUID NOT NULL,
  "kind" VARCHAR(32) NOT NULL,
  "title" VARCHAR(160) NOT NULL,
  "occurred_at" TIMESTAMPTZ(6) NOT NULL,
  "next_due_at" TIMESTAMPTZ(6),
  "provider" VARCHAR(160),
  "dosage" VARCHAR(120),
  "notes" TEXT,
  "deleted_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "companion_care_records_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "companion_care_records_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "companion_care_records_animal_id_fkey" FOREIGN KEY ("animal_id") REFERENCES "animals"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "companion_care_records_kind_check" CHECK ("kind" IN ('vaccination','medication','vet_visit','parasite_prevention','surgery','grooming','other'))
);
CREATE INDEX "companion_care_user_due_idx" ON "companion_care_records"("user_id", "deleted_at", "next_due_at");
CREATE INDEX "companion_care_animal_occurred_idx" ON "companion_care_records"("animal_id", "occurred_at" DESC);
