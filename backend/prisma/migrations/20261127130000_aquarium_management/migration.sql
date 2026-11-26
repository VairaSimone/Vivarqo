CREATE TABLE "aquarium_water_changes" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "aquarium_id" UUID NOT NULL,
  "occurred_at" TIMESTAMPTZ(6) NOT NULL, "volume_liters" DECIMAL(10,2) NOT NULL,
  "percentage" DECIMAL(5,2), "water_source" VARCHAR(120), "conditioner" VARCHAR(160),
  "temperature_c" DECIMAL(5,2), "notes" TEXT, "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "aquarium_water_changes_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "aquarium_water_changes_aquarium_fkey" FOREIGN KEY ("aquarium_id") REFERENCES "aquariums"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "aquarium_water_changes_volume_check" CHECK ("volume_liters" > 0),
  CONSTRAINT "aquarium_water_changes_percentage_check" CHECK ("percentage" IS NULL OR ("percentage" > 0 AND "percentage" <= 100))
);
CREATE INDEX "aquarium_water_changes_aquarium_occurred_idx" ON "aquarium_water_changes"("aquarium_id","occurred_at" DESC);

CREATE TABLE "aquarium_filter_maintenances" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "aquarium_id" UUID NOT NULL,
  "occurred_at" TIMESTAMPTZ(6) NOT NULL, "filter_name" VARCHAR(160) NOT NULL,
  "action" VARCHAR(32) NOT NULL, "material" VARCHAR(160), "material_changed" BOOLEAN NOT NULL DEFAULT FALSE,
  "next_due_at" TIMESTAMPTZ(6), "notes" TEXT, "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "aquarium_filter_maintenances_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "aquarium_filter_maintenances_aquarium_fkey" FOREIGN KEY ("aquarium_id") REFERENCES "aquariums"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "aquarium_filter_maintenances_action_check" CHECK ("action" IN ('cleaning','replacement','inspection','other'))
);
CREATE INDEX "aquarium_filter_maintenance_aquarium_occurred_idx" ON "aquarium_filter_maintenances"("aquarium_id","occurred_at" DESC);

CREATE TABLE "aquarium_product_dosages" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "aquarium_id" UUID NOT NULL,
  "occurred_at" TIMESTAMPTZ(6) NOT NULL, "product_name" VARCHAR(160) NOT NULL,
  "product_type" VARCHAR(32) NOT NULL, "dose_amount" DECIMAL(12,4) NOT NULL, "dose_unit" VARCHAR(32) NOT NULL,
  "target_volume_l" DECIMAL(10,2), "reason" VARCHAR(240), "notes" TEXT, "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "aquarium_product_dosages_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "aquarium_product_dosages_aquarium_fkey" FOREIGN KEY ("aquarium_id") REFERENCES "aquariums"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "aquarium_product_dosages_amount_check" CHECK ("dose_amount" > 0),
  CONSTRAINT "aquarium_product_dosages_type_check" CHECK ("product_type" IN ('fertilizer','conditioner','mineral','bacteria','other'))
);
CREATE INDEX "aquarium_product_dosing_aquarium_occurred_idx" ON "aquarium_product_dosages"("aquarium_id","occurred_at" DESC);

CREATE TABLE "aquarium_populations" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "aquarium_id" UUID NOT NULL,
  "species_key" VARCHAR(180) NOT NULL, "common_name" VARCHAR(160), "scientific_name" VARCHAR(180),
  "quantity" INTEGER NOT NULL DEFAULT 0, "notes" TEXT, "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "aquarium_populations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "aquarium_populations_aquarium_fkey" FOREIGN KEY ("aquarium_id") REFERENCES "aquariums"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "aquarium_populations_quantity_check" CHECK ("quantity" >= 0),
  CONSTRAINT "aquarium_population_aquarium_species_key" UNIQUE ("aquarium_id","species_key")
);
CREATE INDEX "aquarium_population_aquarium_quantity_idx" ON "aquarium_populations"("aquarium_id","quantity");

CREATE TABLE "aquarium_population_movements" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "from_aquarium_id" UUID, "to_aquarium_id" UUID,
  "species_key" VARCHAR(180) NOT NULL, "common_name" VARCHAR(160), "scientific_name" VARCHAR(180),
  "movement_type" VARCHAR(24) NOT NULL, "quantity" INTEGER NOT NULL, "occurred_at" TIMESTAMPTZ(6) NOT NULL,
  "reason" VARCHAR(240), "notes" TEXT, "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "aquarium_population_movements_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "aquarium_population_movements_from_fkey" FOREIGN KEY ("from_aquarium_id") REFERENCES "aquariums"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "aquarium_population_movements_to_fkey" FOREIGN KEY ("to_aquarium_id") REFERENCES "aquariums"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "aquarium_population_movements_quantity_check" CHECK ("quantity" > 0),
  CONSTRAINT "aquarium_population_movements_type_check" CHECK ("movement_type" IN ('introduction','removal','transfer','mortality')),
  CONSTRAINT "aquarium_population_movements_path_check" CHECK (
    ("movement_type" = 'introduction' AND "from_aquarium_id" IS NULL AND "to_aquarium_id" IS NOT NULL) OR
    ("movement_type" IN ('removal','mortality') AND "from_aquarium_id" IS NOT NULL AND "to_aquarium_id" IS NULL) OR
    ("movement_type" = 'transfer' AND "from_aquarium_id" IS NOT NULL AND "to_aquarium_id" IS NOT NULL AND "from_aquarium_id" <> "to_aquarium_id")
  )
);
CREATE INDEX "aquarium_population_movements_from_idx" ON "aquarium_population_movements"("from_aquarium_id","occurred_at" DESC);
CREATE INDEX "aquarium_population_movements_to_idx" ON "aquarium_population_movements"("to_aquarium_id","occurred_at" DESC);

CREATE TABLE "aquarium_quarantines" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "aquarium_id" UUID NOT NULL,
  "species_key" VARCHAR(180) NOT NULL, "common_name" VARCHAR(160), "scientific_name" VARCHAR(180),
  "quantity" INTEGER NOT NULL, "started_at" TIMESTAMPTZ(6) NOT NULL, "ended_at" TIMESTAMPTZ(6),
  "source" VARCHAR(180), "status" VARCHAR(24) NOT NULL DEFAULT 'quarantine', "observations" TEXT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "aquarium_quarantines_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "aquarium_quarantines_aquarium_fkey" FOREIGN KEY ("aquarium_id") REFERENCES "aquariums"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "aquarium_quarantines_quantity_check" CHECK ("quantity" > 0),
  CONSTRAINT "aquarium_quarantines_status_check" CHECK ("status" IN ('quarantine','released','isolated','lost')),
  CONSTRAINT "aquarium_quarantines_dates_check" CHECK ("ended_at" IS NULL OR "ended_at" >= "started_at")
);
CREATE INDEX "aquarium_quarantine_aquarium_started_idx" ON "aquarium_quarantines"("aquarium_id","started_at" DESC);

CREATE TABLE "aquarium_treatments" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "aquarium_id" UUID NOT NULL,
  "started_at" TIMESTAMPTZ(6) NOT NULL, "ended_at" TIMESTAMPTZ(6), "treatment_type" VARCHAR(32) NOT NULL,
  "product_name" VARCHAR(160) NOT NULL, "active_ingredient" VARCHAR(160), "dose_amount" DECIMAL(12,4),
  "dose_unit" VARCHAR(32), "target_species" VARCHAR(180), "instructions" TEXT, "outcome" TEXT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "aquarium_treatments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "aquarium_treatments_aquarium_fkey" FOREIGN KEY ("aquarium_id") REFERENCES "aquariums"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "aquarium_treatments_dates_check" CHECK ("ended_at" IS NULL OR "ended_at" >= "started_at"),
  CONSTRAINT "aquarium_treatments_type_check" CHECK ("treatment_type" IN ('medication','antiparasitic','other'))
);
CREATE INDEX "aquarium_treatments_aquarium_started_idx" ON "aquarium_treatments"("aquarium_id","started_at" DESC);

CREATE TABLE "aquarium_reproductions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "aquarium_id" UUID NOT NULL,
  "species_key" VARCHAR(180) NOT NULL, "common_name" VARCHAR(160), "started_at" TIMESTAMPTZ(6) NOT NULL,
  "spawned_at" TIMESTAMPTZ(6), "hatched_at" TIMESTAMPTZ(6), "eggs_count" INTEGER,
  "hatched_count" INTEGER, "surviving_count" INTEGER, "notes" TEXT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "aquarium_reproductions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "aquarium_reproductions_aquarium_fkey" FOREIGN KEY ("aquarium_id") REFERENCES "aquariums"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "aquarium_reproductions_counts_check" CHECK (
    ("eggs_count" IS NULL OR "eggs_count" >= 0) AND ("hatched_count" IS NULL OR "hatched_count" >= 0) AND
    ("surviving_count" IS NULL OR "surviving_count" >= 0) AND
    ("hatched_count" IS NULL OR "eggs_count" IS NULL OR "hatched_count" <= "eggs_count") AND
    ("surviving_count" IS NULL OR "hatched_count" IS NULL OR "surviving_count" <= "hatched_count")
  )
);
CREATE INDEX "aquarium_reproduction_aquarium_started_idx" ON "aquarium_reproductions"("aquarium_id","started_at" DESC);

CREATE TABLE "aquarium_compatibility_rules" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "user_id" UUID NOT NULL,
  "species_a_key" VARCHAR(180) NOT NULL, "species_b_key" VARCHAR(180) NOT NULL,
  "compatibility" VARCHAR(16) NOT NULL, "notes" TEXT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "aquarium_compatibility_rules_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "aquarium_compatibility_rules_user_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "aquarium_compatibility_rules_status_check" CHECK ("compatibility" IN ('compatible','caution','incompatible')),
  CONSTRAINT "aquarium_compatibility_rules_pair_check" CHECK ("species_a_key" < "species_b_key"),
  CONSTRAINT "aquarium_compatibility_user_species_key" UNIQUE ("user_id","species_a_key","species_b_key")
);
CREATE INDEX "aquarium_compatibility_user_status_idx" ON "aquarium_compatibility_rules"("user_id","compatibility");
