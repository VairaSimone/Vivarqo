ALTER TABLE "finance_entries"
  ADD COLUMN "reproduction_cycle_id" UUID,
  ADD COLUMN "clutch_id" UUID,
  ADD COLUMN "offspring_batch_id" UUID,
  ADD COLUMN "recurrence_id" UUID;

ALTER TABLE "finance_entries"
  ADD CONSTRAINT "finance_entries_cycle_fk" FOREIGN KEY ("reproduction_cycle_id") REFERENCES "reproduction_cycles"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "finance_entries_clutch_fk" FOREIGN KEY ("clutch_id") REFERENCES "clutches"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "finance_entries_offspring_batch_fk" FOREIGN KEY ("offspring_batch_id") REFERENCES "offspring_batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "finance_budgets" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id" UUID NOT NULL,
  "period" VARCHAR(8) NOT NULL,
  "period_start" DATE NOT NULL,
  "category" VARCHAR(80) NOT NULL DEFAULT 'all',
  "amount_cents" BIGINT NOT NULL,
  "currency" CHAR(3) NOT NULL DEFAULT 'EUR',
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "finance_budgets_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "finance_budgets_period_check" CHECK ("period" IN ('month', 'year')),
  CONSTRAINT "finance_budgets_amount_check" CHECK ("amount_cents" > 0),
  CONSTRAINT "finance_budgets_user_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "finance_budgets_scope_unique" ON "finance_budgets"("user_id","period","period_start","category","currency");
CREATE INDEX "finance_budgets_user_period_idx" ON "finance_budgets"("user_id","period_start");

CREATE TABLE "finance_recurrences" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id" UUID NOT NULL,
  "entry_type" VARCHAR(12) NOT NULL,
  "amount_cents" BIGINT NOT NULL,
  "currency" CHAR(3) NOT NULL DEFAULT 'EUR',
  "category" VARCHAR(80) NOT NULL,
  "description" VARCHAR(240) NOT NULL,
  "animal_id" UUID,
  "document_id" UUID,
  "frequency" VARCHAR(12) NOT NULL,
  "next_occurrence_on" DATE NOT NULL,
  "end_on" DATE,
  "is_active" BOOLEAN NOT NULL DEFAULT TRUE,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "finance_recurrences_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "finance_recurrences_entry_type_check" CHECK ("entry_type" IN ('income', 'expense')),
  CONSTRAINT "finance_recurrences_frequency_check" CHECK ("frequency" IN ('monthly', 'yearly')),
  CONSTRAINT "finance_recurrences_amount_check" CHECK ("amount_cents" > 0),
  CONSTRAINT "finance_recurrences_user_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "finance_recurrences_animal_fk" FOREIGN KEY ("animal_id") REFERENCES "animals"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "finance_recurrences_document_fk" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "finance_recurrences_due_idx" ON "finance_recurrences"("user_id","is_active","next_occurrence_on");
ALTER TABLE "finance_entries"
  ADD CONSTRAINT "finance_entries_recurrence_fk" FOREIGN KEY ("recurrence_id") REFERENCES "finance_recurrences"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE UNIQUE INDEX "finance_entries_recurrence_date_unique" ON "finance_entries"("recurrence_id","occurred_on");
CREATE INDEX "finance_entries_cycle_idx" ON "finance_entries"("reproduction_cycle_id");
CREATE INDEX "finance_entries_clutch_idx" ON "finance_entries"("clutch_id");
CREATE INDEX "finance_entries_offspring_batch_idx" ON "finance_entries"("offspring_batch_id");
CREATE INDEX "finance_entries_recurrence_idx" ON "finance_entries"("recurrence_id");
