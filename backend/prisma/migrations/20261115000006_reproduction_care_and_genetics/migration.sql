ALTER TABLE "eggs"
  ADD COLUMN "laid_at" TIMESTAMPTZ(6),
  ADD COLUMN "expected_hatch_at" DATE;

ALTER TABLE "animal_genetic_traits"
  ADD COLUMN "inheritance_mode" VARCHAR(32),
  ADD COLUMN "genotype" VARCHAR(32),
  ADD COLUMN "certainty" VARCHAR(24) NOT NULL DEFAULT 'unverified';

CREATE TABLE "egg_measurements" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "egg_id" UUID NOT NULL,
  "measured_at" TIMESTAMPTZ(6) NOT NULL,
  "weight_g" DECIMAL(10,2) NOT NULL,
  "notes" TEXT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "egg_measurements_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "egg_measurements_egg_id_fkey" FOREIGN KEY ("egg_id") REFERENCES "eggs"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "egg_measurements_weight_positive" CHECK ("weight_g" > 0)
);
CREATE INDEX "egg_measurements_egg_measured_idx" ON "egg_measurements"("egg_id", "measured_at" DESC);

CREATE TABLE "incubators" (
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
CREATE UNIQUE INDEX "incubators_user_name_unique" ON "incubators"("user_id", "name");
CREATE INDEX "incubators_user_active_idx" ON "incubators"("user_id", "is_active");
ALTER TABLE "clutches" ADD COLUMN "incubator_id" UUID;
ALTER TABLE "clutches" ADD CONSTRAINT "clutches_incubator_id_fkey" FOREIGN KEY ("incubator_id") REFERENCES "incubators"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "clutches_incubator_idx" ON "clutches"("incubator_id");

CREATE TABLE "incubator_maintenance" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "incubator_id" UUID NOT NULL,
  "occurred_at" TIMESTAMPTZ(6) NOT NULL,
  "event_type" VARCHAR(32) NOT NULL,
  "notes" TEXT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "incubator_maintenance_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "incubator_maintenance_incubator_id_fkey" FOREIGN KEY ("incubator_id") REFERENCES "incubators"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "incubator_maintenance_incubator_date_idx" ON "incubator_maintenance"("incubator_id", "occurred_at" DESC);

CREATE TABLE "hatchling_care" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "animal_id" UUID NOT NULL,
  "first_feeding_at" TIMESTAMPTZ(6),
  "first_feeding_accepted" BOOLEAN,
  "first_shed_at" TIMESTAMPTZ(6),
  "ready_for_rehoming_at" TIMESTAMPTZ(6),
  "notes" TEXT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "hatchling_care_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "hatchling_care_animal_id_fkey" FOREIGN KEY ("animal_id") REFERENCES "animals"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "hatchling_care_animal_id_key" ON "hatchling_care"("animal_id");
