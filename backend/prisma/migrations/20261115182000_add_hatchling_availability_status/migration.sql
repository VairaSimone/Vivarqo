ALTER TABLE "hatchling_care"
  ADD COLUMN "availability_status" VARCHAR(24) NOT NULL DEFAULT 'not_available';

ALTER TABLE "hatchling_care"
  ADD CONSTRAINT "hatchling_care_availability_status_check"
  CHECK ("availability_status" IN ('not_available', 'available', 'reserved', 'transferred'));
