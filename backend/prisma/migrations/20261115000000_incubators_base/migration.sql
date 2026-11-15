CREATE TABLE IF NOT EXISTS "incubators" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id" UUID NOT NULL,
  "name" VARCHAR(120) NOT NULL,
  "identifier" VARCHAR(80),
  "capacity" INTEGER,
  "notes" TEXT,
  "is_active" BOOLEAN NOT NULL DEFAULT TRUE,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "incubators_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "incubators_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "incubators_capacity_positive" CHECK ("capacity" IS NULL OR "capacity" > 0)
);
CREATE UNIQUE INDEX IF NOT EXISTS "incubators_user_name_unique" ON "incubators"("user_id", "name");
CREATE INDEX IF NOT EXISTS "incubators_user_active_idx" ON "incubators"("user_id", "is_active");
