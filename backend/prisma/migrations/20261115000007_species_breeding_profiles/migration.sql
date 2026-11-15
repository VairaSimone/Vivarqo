CREATE TABLE "species_breeding_profiles" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id" UUID NOT NULL,
  "species" VARCHAR(160) NOT NULL,
  "female_min_age_months" INTEGER,
  "male_min_age_months" INTEGER,
  "female_min_weight_g" DECIMAL(10,2),
  "male_min_weight_g" DECIMAL(10,2),
  "notes" TEXT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "species_breeding_profiles_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "species_breeding_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "species_breeding_profiles_age_nonnegative" CHECK (
    ("female_min_age_months" IS NULL OR "female_min_age_months" >= 0) AND
    ("male_min_age_months" IS NULL OR "male_min_age_months" >= 0)
  ),
  CONSTRAINT "species_breeding_profiles_weight_positive" CHECK (
    ("female_min_weight_g" IS NULL OR "female_min_weight_g" > 0) AND
    ("male_min_weight_g" IS NULL OR "male_min_weight_g" > 0)
  )
);
CREATE UNIQUE INDEX "species_breeding_profiles_user_species_unique" ON "species_breeding_profiles"("user_id", "species");
CREATE INDEX "species_breeding_profiles_user_idx" ON "species_breeding_profiles"("user_id");
