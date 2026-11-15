ALTER TABLE "hatchling_care"
  ADD COLUMN "health_status" VARCHAR(24) NOT NULL DEFAULT 'unknown',
  ADD COLUMN "health_notes" TEXT;