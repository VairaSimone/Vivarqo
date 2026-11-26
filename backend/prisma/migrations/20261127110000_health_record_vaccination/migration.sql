ALTER TABLE "health_records"
  DROP CONSTRAINT "health_records_type_check";

ALTER TABLE "health_records"
  ADD CONSTRAINT "health_records_type_check"
  CHECK ("record_type" IN ('symptom','visit','diagnosis','suspicion','treatment','checkup','vaccination'));
