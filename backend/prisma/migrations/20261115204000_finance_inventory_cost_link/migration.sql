ALTER TABLE "finance_entries" ADD COLUMN "source_stock_movement_id" UUID;
ALTER TABLE "finance_entries"
  ADD CONSTRAINT "finance_entries_source_stock_movement_fk"
  FOREIGN KEY ("source_stock_movement_id") REFERENCES "stock_movements"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
CREATE UNIQUE INDEX "finance_entries_source_stock_movement_unique"
  ON "finance_entries"("source_stock_movement_id");
