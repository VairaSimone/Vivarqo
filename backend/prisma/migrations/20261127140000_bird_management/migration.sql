CREATE TABLE "bird_profiles" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id" UUID NOT NULL,
  "animal_id" UUID NOT NULL,
  "ring_type" VARCHAR(16) NOT NULL DEFAULT 'none',
  "ring_number" VARCHAR(80),
  "ring_year" INTEGER,
  "cites_number" VARCHAR(120),
  "cites_annex" VARCHAR(24),
  "cites_authority" VARCHAR(160),
  "cites_issued_at" DATE,
  "cites_expires_at" DATE,
  "notes" TEXT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "bird_profiles_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "bird_profiles_user_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "bird_profiles_animal_fkey" FOREIGN KEY ("animal_id") REFERENCES "animals"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "bird_profiles_ring_type_check" CHECK ("ring_type" IN ('none','closed','open','microchip')),
  CONSTRAINT "bird_profiles_ring_year_check" CHECK ("ring_year" IS NULL OR ("ring_year" BETWEEN 1900 AND 2200)),
  CONSTRAINT "bird_profiles_cites_dates_check" CHECK ("cites_expires_at" IS NULL OR "cites_issued_at" IS NULL OR "cites_expires_at" >= "cites_issued_at")
);
CREATE UNIQUE INDEX "bird_profiles_animal_id_key" ON "bird_profiles"("animal_id");
CREATE UNIQUE INDEX "bird_profiles_user_ring_unique" ON "bird_profiles"("user_id","ring_number");
CREATE UNIQUE INDEX "bird_profiles_user_cites_unique" ON "bird_profiles"("user_id","cites_number");
CREATE INDEX "bird_profiles_user_updated_idx" ON "bird_profiles"("user_id","updated_at" DESC);

CREATE TABLE "bird_breeding_pairs" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id" UUID NOT NULL,
  "female_animal_id" UUID NOT NULL,
  "male_animal_id" UUID NOT NULL,
  "cycle_id" UUID NOT NULL,
  "paired_at" DATE NOT NULL,
  "separated_at" DATE,
  "status" VARCHAR(16) NOT NULL DEFAULT 'active',
  "notes" TEXT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "bird_breeding_pairs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "bird_breeding_pairs_user_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "bird_breeding_pairs_female_fkey" FOREIGN KEY ("female_animal_id") REFERENCES "animals"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "bird_breeding_pairs_male_fkey" FOREIGN KEY ("male_animal_id") REFERENCES "animals"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "bird_breeding_pairs_cycle_fkey" FOREIGN KEY ("cycle_id") REFERENCES "reproduction_cycles"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "bird_breeding_pairs_different_birds_check" CHECK ("female_animal_id" <> "male_animal_id"),
  CONSTRAINT "bird_breeding_pairs_status_check" CHECK ("status" IN ('active','paused','completed','cancelled')),
  CONSTRAINT "bird_breeding_pairs_dates_check" CHECK ("separated_at" IS NULL OR "separated_at" >= "paired_at")
);
CREATE UNIQUE INDEX "bird_breeding_pairs_cycle_id_key" ON "bird_breeding_pairs"("cycle_id");
CREATE INDEX "bird_pairs_user_status_date_idx" ON "bird_breeding_pairs"("user_id","status","paired_at" DESC);
CREATE INDEX "bird_pairs_animals_idx" ON "bird_breeding_pairs"("female_animal_id","male_animal_id");

CREATE TABLE "aviary_maintenance" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "aviary_id" UUID NOT NULL,
  "occurred_at" TIMESTAMPTZ(6) NOT NULL,
  "action" VARCHAR(24) NOT NULL,
  "area" VARCHAR(160),
  "products" VARCHAR(240),
  "next_due_at" TIMESTAMPTZ(6),
  "notes" TEXT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "aviary_maintenance_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "aviary_maintenance_aviary_fkey" FOREIGN KEY ("aviary_id") REFERENCES "aviaries"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "aviary_maintenance_action_check" CHECK ("action" IN ('cleaning','disinfection','inspection','repair','other')),
  CONSTRAINT "aviary_maintenance_due_check" CHECK ("next_due_at" IS NULL OR "next_due_at" >= "occurred_at")
);
CREATE INDEX "aviary_maintenance_aviary_occurred_idx" ON "aviary_maintenance"("aviary_id","occurred_at" DESC);
CREATE INDEX "aviary_maintenance_aviary_due_idx" ON "aviary_maintenance"("aviary_id","next_due_at");
