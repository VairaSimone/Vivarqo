CREATE TABLE IF NOT EXISTS "aquarium_parameter_ranges" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "aquarium_id" UUID NOT NULL,
  "parameter" VARCHAR(32) NOT NULL,
  "min_value" DECIMAL(12,4),
  "max_value" DECIMAL(12,4),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "aquarium_parameter_ranges_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "aquarium_parameter_ranges_aquarium_id_fkey" FOREIGN KEY ("aquarium_id") REFERENCES "aquariums"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "aquarium_parameter_ranges_bounds_check" CHECK ("min_value" IS NULL OR "max_value" IS NULL OR "min_value" <= "max_value"),
  CONSTRAINT "aquarium_parameter_ranges_has_bound_check" CHECK ("min_value" IS NOT NULL OR "max_value" IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS "aquarium_parameter_ranges_aquarium_parameter_key" ON "aquarium_parameter_ranges"("aquarium_id","parameter");

CREATE TABLE IF NOT EXISTS "aviary_movements" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "animal_id" UUID NOT NULL,
  "from_aviary_id" UUID,
  "to_aviary_id" UUID,
  "occurred_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "notes" TEXT,
  CONSTRAINT "aviary_movements_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "aviary_movements_animal_id_fkey" FOREIGN KEY ("animal_id") REFERENCES "animals"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "aviary_movements_from_aviary_id_fkey" FOREIGN KEY ("from_aviary_id") REFERENCES "aviaries"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "aviary_movements_to_aviary_id_fkey" FOREIGN KEY ("to_aviary_id") REFERENCES "aviaries"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "aviary_movements_animal_occurred_idx" ON "aviary_movements"("animal_id","occurred_at" DESC);
CREATE INDEX IF NOT EXISTS "aviary_movements_from_occurred_idx" ON "aviary_movements"("from_aviary_id","occurred_at" DESC);
CREATE INDEX IF NOT EXISTS "aviary_movements_to_occurred_idx" ON "aviary_movements"("to_aviary_id","occurred_at" DESC);

CREATE TABLE IF NOT EXISTS "aviary_notes" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "aviary_id" UUID NOT NULL,
  "title" VARCHAR(160),
  "body" TEXT NOT NULL,
  "occurred_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "aviary_notes_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "aviary_notes_aviary_id_fkey" FOREIGN KEY ("aviary_id") REFERENCES "aviaries"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "aviary_notes_aviary_occurred_idx" ON "aviary_notes"("aviary_id","occurred_at" DESC);

-- Preserve the current placement as the first known event without duplicating
-- movements if the historical migration had already run in an existing database.
INSERT INTO "aviary_movements" ("animal_id","from_aviary_id","to_aviary_id","occurred_at")
SELECT ab."animal_id", NULL, ab."aviary_id", ab."created_at"
FROM "aviary_birds" ab
WHERE NOT EXISTS (
  SELECT 1 FROM "aviary_movements" m
  WHERE m."animal_id" = ab."animal_id"
    AND m."from_aviary_id" IS NULL
    AND m."to_aviary_id" = ab."aviary_id"
    AND m."occurred_at" = ab."created_at"
);
