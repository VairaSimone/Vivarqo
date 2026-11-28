-- Preserve legacy bird ring identifiers in the dedicated BirdProfile record.
-- Duplicate or already-assigned numbers are retained in notes for manual review.
ALTER TABLE "bird_profiles" DROP CONSTRAINT IF EXISTS "bird_profiles_ring_type_check";
ALTER TABLE "bird_profiles"
  ADD CONSTRAINT "bird_profiles_ring_type_check"
  CHECK ("ring_type" IN ('none', 'unspecified', 'closed', 'open', 'microchip'));

WITH legacy AS (
  SELECT a."id", a."user_id", NULLIF(BTRIM(a."domain_profile"->>'ringNumber'), '') AS ring_number
  FROM "animals" a
  WHERE a."category" = 'birds'
    AND jsonb_typeof(a."domain_profile") = 'object'
    AND NULLIF(BTRIM(a."domain_profile"->>'ringNumber'), '') IS NOT NULL
),
ranked AS (
  SELECT legacy.*, COUNT(*) OVER (PARTITION BY "user_id", ring_number) AS duplicate_count
  FROM legacy
)
INSERT INTO "bird_profiles" ("user_id", "animal_id", "ring_type", "ring_number", "notes")
SELECT ranked."user_id", ranked."id", 'unspecified',
  CASE WHEN ranked.duplicate_count = 1 AND NOT EXISTS (
    SELECT 1 FROM "bird_profiles" existing
    WHERE existing."user_id" = ranked."user_id"
      AND existing."ring_number" = ranked.ring_number
      AND existing."animal_id" <> ranked."id"
  ) THEN ranked.ring_number ELSE NULL END,
  CASE
    WHEN ranked.duplicate_count > 1 THEN 'Numero anello legacy duplicato da verificare: ' || ranked.ring_number
    WHEN EXISTS (
      SELECT 1 FROM "bird_profiles" existing
      WHERE existing."user_id" = ranked."user_id"
        AND existing."ring_number" = ranked.ring_number
        AND existing."animal_id" <> ranked."id"
    ) THEN 'Numero anello legacy già assegnato a un altro uccello: ' || ranked.ring_number
    ELSE NULL
  END
FROM ranked
ON CONFLICT DO NOTHING;

-- Fill an existing empty BirdProfile if the legacy number is unique and available.
WITH legacy AS (
  SELECT a."id" AS animal_id, a."user_id", NULLIF(BTRIM(a."domain_profile"->>'ringNumber'), '') AS ring_number
  FROM "animals" a
  WHERE a."category" = 'birds'
    AND jsonb_typeof(a."domain_profile") = 'object'
    AND NULLIF(BTRIM(a."domain_profile"->>'ringNumber'), '') IS NOT NULL
),
ranked AS (
  SELECT legacy.*, COUNT(*) OVER (PARTITION BY "user_id", ring_number) AS duplicate_count
  FROM legacy
)
UPDATE "bird_profiles" bp
SET "ring_type" = 'unspecified', "ring_number" = ranked.ring_number
FROM ranked
WHERE bp."animal_id" = ranked.animal_id
  AND bp."ring_number" IS NULL
  AND ranked.duplicate_count = 1
  AND NOT EXISTS (
    SELECT 1 FROM "bird_profiles" other
    WHERE other."user_id" = bp."user_id"
      AND other."ring_number" = ranked.ring_number
      AND other."animal_id" <> bp."animal_id"
  );

-- If the dedicated profile already has a different number, keep both values.
UPDATE "bird_profiles" bp
SET "notes" = CONCAT_WS(E'\n', NULLIF(bp."notes", ''),
  'Numero anello precedentemente registrato nel profilo generale: ' || NULLIF(BTRIM(a."domain_profile"->>'ringNumber'), ''))
FROM "animals" a
WHERE a."id" = bp."animal_id"
  AND a."category" = 'birds'
  AND jsonb_typeof(a."domain_profile") = 'object'
  AND NULLIF(BTRIM(a."domain_profile"->>'ringNumber'), '') IS NOT NULL
  AND bp."ring_number" IS NOT NULL
  AND bp."ring_number" <> NULLIF(BTRIM(a."domain_profile"->>'ringNumber'), '');

-- Existing profiles involved in duplicate or conflicting legacy numbers get a review note.
WITH legacy AS (
  SELECT a."id" AS animal_id, a."user_id", NULLIF(BTRIM(a."domain_profile"->>'ringNumber'), '') AS ring_number
  FROM "animals" a
  WHERE a."category" = 'birds'
    AND jsonb_typeof(a."domain_profile") = 'object'
    AND NULLIF(BTRIM(a."domain_profile"->>'ringNumber'), '') IS NOT NULL
),
ranked AS (
  SELECT legacy.*, COUNT(*) OVER (PARTITION BY "user_id", ring_number) AS duplicate_count
  FROM legacy
)
UPDATE "bird_profiles" bp
SET "notes" = CONCAT_WS(E'\n', NULLIF(bp."notes", ''),
  'Numero anello legacy duplicato o già assegnato da verificare: ' || ranked.ring_number)
FROM ranked
WHERE bp."animal_id" = ranked.animal_id
  AND (
    ranked.duplicate_count > 1
    OR EXISTS (
      SELECT 1 FROM "bird_profiles" existing
      WHERE existing."user_id" = bp."user_id"
        AND existing."ring_number" = ranked.ring_number
        AND existing."animal_id" <> bp."animal_id"
    )
  )
  AND COALESCE(bp."notes", '') NOT LIKE '%Numero anello legacy duplicato o già assegnato da verificare:%';

-- Bring existing dedicated identifiers into a consistent state when a number exists.
UPDATE "bird_profiles"
SET "ring_type" = 'unspecified'
WHERE "ring_number" IS NOT NULL AND "ring_type" = 'none';

-- Remove the deprecated duplicate field after all values have been migrated or annotated.
UPDATE "animals"
SET "domain_profile" = "domain_profile" - 'ringNumber'
WHERE "category" = 'birds'
  AND jsonb_typeof("domain_profile") = 'object'
  AND "domain_profile" ? 'ringNumber';

-- Dedicated mating, pregnancy and litter records for dogs and cats.
CREATE TABLE "companion_reproductions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id" UUID NOT NULL,
  "female_animal_id" UUID NOT NULL,
  "male_animal_id" UUID NOT NULL,
  "mated_at" DATE NOT NULL,
  "pregnancy_confirmed_at" DATE,
  "expected_due_at" DATE,
  "delivered_at" DATE,
  "status" VARCHAR(16) NOT NULL DEFAULT 'mated',
  "total_born" INTEGER,
  "live_born" INTEGER,
  "stillborn" INTEGER,
  "notes" TEXT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "companion_reproductions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "companion_reproductions_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "companion_reproductions_female_animal_id_fkey"
    FOREIGN KEY ("female_animal_id") REFERENCES "animals"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "companion_reproductions_male_animal_id_fkey"
    FOREIGN KEY ("male_animal_id") REFERENCES "animals"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "companion_reproductions_distinct_parents_check"
    CHECK ("female_animal_id" <> "male_animal_id"),
  CONSTRAINT "companion_reproductions_status_check"
    CHECK ("status" IN ('mated', 'pregnant', 'delivered', 'unsuccessful', 'cancelled')),
  CONSTRAINT "companion_reproductions_counts_check"
    CHECK (
      ("total_born" IS NULL OR "total_born" BETWEEN 0 AND 100)
      AND ("live_born" IS NULL OR "live_born" BETWEEN 0 AND 100)
      AND ("stillborn" IS NULL OR "stillborn" BETWEEN 0 AND 100)
      AND ("total_born" IS NOT NULL OR ("live_born" IS NULL AND "stillborn" IS NULL))
      AND ("total_born" IS NULL OR COALESCE("live_born", 0) + COALESCE("stillborn", 0) <= "total_born")
    ),
  CONSTRAINT "companion_reproductions_chronology_check"
    CHECK (
      ("pregnancy_confirmed_at" IS NULL OR "pregnancy_confirmed_at" >= "mated_at")
      AND ("expected_due_at" IS NULL OR "expected_due_at" >= COALESCE("pregnancy_confirmed_at", "mated_at"))
      AND ("delivered_at" IS NULL OR "delivered_at" >= "mated_at")
      AND ("status" <> 'pregnant' OR "pregnancy_confirmed_at" IS NOT NULL)
      AND ("status" <> 'delivered' OR "delivered_at" IS NOT NULL)
    )
);

CREATE INDEX "companion_reproductions_user_status_mated_idx"
  ON "companion_reproductions"("user_id", "status", "mated_at" DESC);
CREATE INDEX "companion_reproductions_female_mated_idx"
  ON "companion_reproductions"("female_animal_id", "mated_at" DESC);
CREATE INDEX "companion_reproductions_male_mated_idx"
  ON "companion_reproductions"("male_animal_id", "mated_at" DESC);
