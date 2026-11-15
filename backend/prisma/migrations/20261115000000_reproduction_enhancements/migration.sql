ALTER TABLE "clutches"
  ADD COLUMN "target_temperature_min_c" DECIMAL(5,2),
  ADD COLUMN "target_temperature_max_c" DECIMAL(5,2),
  ADD COLUMN "target_humidity_min_pct" DECIMAL(5,2),
  ADD COLUMN "target_humidity_max_pct" DECIMAL(5,2),
  ADD COLUMN "check_interval_hours" INTEGER;

ALTER TABLE "clutches"
  ADD CONSTRAINT "clutches_temperature_range_check"
    CHECK ("target_temperature_min_c" IS NULL OR "target_temperature_max_c" IS NULL OR "target_temperature_min_c" <= "target_temperature_max_c"),
  ADD CONSTRAINT "clutches_humidity_range_check"
    CHECK ("target_humidity_min_pct" IS NULL OR "target_humidity_max_pct" IS NULL OR "target_humidity_min_pct" <= "target_humidity_max_pct"),
  ADD CONSTRAINT "clutches_check_interval_hours_check"
    CHECK ("check_interval_hours" IS NULL OR "check_interval_hours" BETWEEN 1 AND 720);

ALTER TABLE "eggs"
  ADD COLUMN "hatched_at" DATE,
  ADD COLUMN "offspring_animal_id" UUID;

ALTER TABLE "eggs"
  ADD CONSTRAINT "eggs_offspring_animal_id_fkey"
    FOREIGN KEY ("offspring_animal_id") REFERENCES "animals"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE UNIQUE INDEX "eggs_offspring_animal_id_key" ON "eggs"("offspring_animal_id");
CREATE INDEX "eggs_status_idx" ON "eggs"("status");

CREATE TABLE "egg_history" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "egg_id" UUID NOT NULL,
  "status" VARCHAR(20) NOT NULL,
  "occurred_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "notes" TEXT,
  CONSTRAINT "egg_history_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "egg_history_egg_id_fkey"
    FOREIGN KEY ("egg_id") REFERENCES "eggs"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "egg_history_egg_occurred_idx" ON "egg_history"("egg_id", "occurred_at" DESC);

INSERT INTO "egg_history" ("egg_id", "status", "occurred_at", "notes")
SELECT "id", "status", "updated_at", "notes" FROM "eggs";
