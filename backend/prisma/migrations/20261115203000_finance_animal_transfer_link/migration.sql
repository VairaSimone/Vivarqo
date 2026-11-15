ALTER TABLE "finance_entries" ADD COLUMN "source_transfer_id" UUID;
ALTER TABLE "finance_entries"
  ADD CONSTRAINT "finance_entries_source_transfer_fk"
  FOREIGN KEY ("source_transfer_id") REFERENCES "animal_transfers"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
CREATE UNIQUE INDEX "finance_entries_source_transfer_unique"
  ON "finance_entries"("source_transfer_id");
