-- Targeted indexes for worker lookups and large reproductive-history lists.
-- The case-insensitive egg-code constraint is enforced in PostgreSQL as well
-- as in the API, including concurrent requests and non-API writers.
CREATE INDEX IF NOT EXISTS "notifications_user_category_target_idx"
  ON "notifications" ("user_id", "category", "target_path");

CREATE INDEX IF NOT EXISTS "tasks_open_due_worker_idx"
  ON "tasks" ("due_at", "id")
  WHERE "status" = 'open';

CREATE INDEX IF NOT EXISTS "eggs_clutch_created_idx"
  ON "eggs" ("clutch_id", "created_at");

CREATE INDEX IF NOT EXISTS "offspring_batches_cycle_born_idx"
  ON "offspring_batches" ("cycle_id", "born_on" DESC);

CREATE INDEX IF NOT EXISTS "animal_genetic_traits_history_idx"
  ON "animal_genetic_traits" ("animal_id", "trait_name", "created_at");

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "eggs"
    WHERE "code" IS NOT NULL
    GROUP BY "clutch_id", lower("code")
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Cannot create case-insensitive egg code uniqueness: resolve duplicate codes per clutch first';
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "eggs_clutch_code_ci_unique"
  ON "eggs" ("clutch_id", lower("code"))
  WHERE "code" IS NOT NULL;
