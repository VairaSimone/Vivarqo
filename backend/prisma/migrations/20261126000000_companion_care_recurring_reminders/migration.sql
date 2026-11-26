ALTER TABLE "companion_care_records"
  ADD COLUMN "reminder_rule_id" UUID;

ALTER TABLE "companion_care_records"
  ADD CONSTRAINT "companion_care_records_reminder_rule_id_fkey"
  FOREIGN KEY ("reminder_rule_id") REFERENCES "reminder_rules"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE UNIQUE INDEX "companion_care_records_reminder_rule_id_key"
  ON "companion_care_records"("reminder_rule_id");
