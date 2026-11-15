ALTER TABLE "incubators"
  ADD COLUMN "maintenance_interval_days" INTEGER,
  ADD COLUMN "next_maintenance_at" TIMESTAMPTZ(6);

ALTER TABLE "eggs"
  ADD COLUMN "incubator_id" UUID,
  ADD COLUMN "incubator_position" VARCHAR(80);

ALTER TABLE "eggs"
  ADD CONSTRAINT "eggs_incubator_id_fkey"
  FOREIGN KEY ("incubator_id") REFERENCES "incubators"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "eggs_incubator_position_idx"
  ON "eggs"("incubator_id", "incubator_position");

CREATE TABLE "egg_incubator_transfers" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "egg_id" UUID NOT NULL,
  "from_incubator_id" UUID,
  "to_incubator_id" UUID,
  "from_position" VARCHAR(80),
  "to_position" VARCHAR(80),
  "transferred_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "notes" TEXT,
  CONSTRAINT "egg_incubator_transfers_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "egg_incubator_transfers_egg_id_fkey" FOREIGN KEY ("egg_id")
    REFERENCES "eggs"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "egg_incubator_transfers_from_incubator_id_fkey" FOREIGN KEY ("from_incubator_id")
    REFERENCES "incubators"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "egg_incubator_transfers_to_incubator_id_fkey" FOREIGN KEY ("to_incubator_id")
    REFERENCES "incubators"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "egg_incubator_transfers_egg_date_idx"
  ON "egg_incubator_transfers"("egg_id", "transferred_at" DESC);

CREATE TABLE "clutch_history" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "clutch_id" UUID NOT NULL,
  "action" VARCHAR(40) NOT NULL,
  "occurred_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "details" JSONB,
  "notes" TEXT,
  CONSTRAINT "clutch_history_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "clutch_history_clutch_id_fkey" FOREIGN KEY ("clutch_id")
    REFERENCES "clutches"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "clutch_history_clutch_occurred_idx"
  ON "clutch_history"("clutch_id", "occurred_at" DESC);
