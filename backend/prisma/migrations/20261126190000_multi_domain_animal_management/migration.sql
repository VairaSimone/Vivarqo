ALTER TABLE "animals"
  ADD COLUMN "category" VARCHAR(24) NOT NULL DEFAULT 'reptiles',
  ADD COLUMN "domain_profile" JSONB;

CREATE INDEX "animals_user_category_status_idx"
  ON "animals"("user_id", "category", "status");

CREATE TABLE "aquariums" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id" UUID NOT NULL,
  "name" VARCHAR(120) NOT NULL,
  "water_type" VARCHAR(16) NOT NULL,
  "volume_liters" DECIMAL(10,2) NOT NULL,
  "setup_date" DATE,
  "location" VARCHAR(160),
  "notes" TEXT,
  "archived_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "aquariums_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "aquariums_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "aquariums_water_type_check" CHECK ("water_type" IN ('freshwater', 'saltwater', 'brackish')),
  CONSTRAINT "aquariums_volume_positive_check" CHECK ("volume_liters" > 0)
);
CREATE INDEX "aquariums_user_archived_name_idx" ON "aquariums"("user_id", "archived_at", "name");

CREATE TABLE "aquarium_water_readings" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "aquarium_id" UUID NOT NULL,
  "measured_at" TIMESTAMPTZ(6) NOT NULL,
  "temperature_c" DECIMAL(5,2),
  "ph" DECIMAL(4,2),
  "gh_dkh" DECIMAL(6,2),
  "kh_dkh" DECIMAL(6,2),
  "ammonia_mg_l" DECIMAL(8,4),
  "nitrite_mg_l" DECIMAL(8,4),
  "nitrate_mg_l" DECIMAL(8,3),
  "salinity_ppt" DECIMAL(7,3),
  "tds_ppm" INTEGER,
  "notes" TEXT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "aquarium_water_readings_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "aquarium_water_readings_aquarium_id_fkey" FOREIGN KEY ("aquarium_id") REFERENCES "aquariums"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "aquarium_water_readings_temperature_check" CHECK ("temperature_c" IS NULL OR "temperature_c" BETWEEN -5 AND 60),
  CONSTRAINT "aquarium_water_readings_ph_check" CHECK ("ph" IS NULL OR "ph" BETWEEN 0 AND 14),
  CONSTRAINT "aquarium_water_readings_gh_check" CHECK ("gh_dkh" IS NULL OR "gh_dkh" >= 0),
  CONSTRAINT "aquarium_water_readings_kh_check" CHECK ("kh_dkh" IS NULL OR "kh_dkh" >= 0),
  CONSTRAINT "aquarium_water_readings_ammonia_check" CHECK ("ammonia_mg_l" IS NULL OR "ammonia_mg_l" >= 0),
  CONSTRAINT "aquarium_water_readings_nitrite_check" CHECK ("nitrite_mg_l" IS NULL OR "nitrite_mg_l" >= 0),
  CONSTRAINT "aquarium_water_readings_nitrate_check" CHECK ("nitrate_mg_l" IS NULL OR "nitrate_mg_l" >= 0),
  CONSTRAINT "aquarium_water_readings_salinity_check" CHECK ("salinity_ppt" IS NULL OR "salinity_ppt" >= 0),
  CONSTRAINT "aquarium_water_readings_tds_check" CHECK ("tds_ppm" IS NULL OR "tds_ppm" >= 0)
);
CREATE INDEX "aquarium_water_readings_aquarium_measured_idx" ON "aquarium_water_readings"("aquarium_id", "measured_at" DESC);

CREATE TABLE "aviaries" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id" UUID NOT NULL,
  "name" VARCHAR(120) NOT NULL,
  "environment" VARCHAR(16) NOT NULL,
  "location" VARCHAR(160),
  "capacity" INTEGER,
  "notes" TEXT,
  "archived_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "aviaries_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "aviaries_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "aviaries_environment_check" CHECK ("environment" IN ('indoor', 'outdoor', 'mixed')),
  CONSTRAINT "aviaries_capacity_check" CHECK ("capacity" IS NULL OR "capacity" > 0)
);
CREATE INDEX "aviaries_user_archived_name_idx" ON "aviaries"("user_id", "archived_at", "name");

CREATE TABLE "aviary_birds" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "aviary_id" UUID NOT NULL,
  "animal_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "aviary_birds_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "aviary_birds_animal_id_key" UNIQUE ("animal_id"),
  CONSTRAINT "aviary_birds_aviary_id_fkey" FOREIGN KEY ("aviary_id") REFERENCES "aviaries"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "aviary_birds_animal_id_fkey" FOREIGN KEY ("animal_id") REFERENCES "animals"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "aviary_birds_aviary_idx" ON "aviary_birds"("aviary_id");
