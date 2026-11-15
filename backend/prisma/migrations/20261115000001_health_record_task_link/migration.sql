ALTER TABLE "tasks" ADD COLUMN "health_record_id" UUID;
CREATE UNIQUE INDEX "tasks_health_record_id_key" ON "tasks"("health_record_id");
ALTER TABLE "tasks"
  ADD CONSTRAINT "tasks_health_record_id_fkey"
  FOREIGN KEY ("health_record_id") REFERENCES "health_records"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
