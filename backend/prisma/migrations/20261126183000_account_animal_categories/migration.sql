CREATE TABLE "account_configurations" (
  "user_id" UUID NOT NULL,
  "animal_categories" VARCHAR(24)[] NOT NULL DEFAULT ARRAY[]::VARCHAR(24)[],
  "configured_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "account_configurations_pkey" PRIMARY KEY ("user_id"),
  CONSTRAINT "account_configurations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- Preserve the existing reptile-first experience for every account created before
-- this feature. Newly registered accounts intentionally have no row and are sent
-- through the category selector on their first authenticated visit.
INSERT INTO "account_configurations" ("user_id", "animal_categories", "configured_at")
SELECT "id", ARRAY['reptiles']::VARCHAR(24)[], CURRENT_TIMESTAMP
FROM "users";

CREATE INDEX "account_configurations_configured_at_idx" ON "account_configurations"("configured_at");
