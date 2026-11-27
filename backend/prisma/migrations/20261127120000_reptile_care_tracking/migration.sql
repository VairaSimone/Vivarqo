CREATE TABLE "reptile_fasting_periods" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "animal_id" UUID NOT NULL,
  "period_type" VARCHAR(16) NOT NULL DEFAULT 'fasting',
  "started_at" TIMESTAMPTZ(6) NOT NULL,
  "ended_at" TIMESTAMPTZ(6),
  "last_accepted_meal_at" TIMESTAMPTZ(6),
  "refused_meals_count" INTEGER NOT NULL DEFAULT 0,
  "reason" VARCHAR(240),
  "start_weight_g" DECIMAL(10,2),
  "end_weight_g" DECIMAL(10,2),
  "notes" TEXT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "reptile_fasting_periods_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "reptile_fasting_periods_animal_id_fkey" FOREIGN KEY ("animal_id") REFERENCES "animals"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "reptile_fasting_periods_type_check" CHECK ("period_type" IN ('fasting', 'refusal')),
  CONSTRAINT "reptile_fasting_periods_dates_check" CHECK ("ended_at" IS NULL OR "ended_at" >= "started_at"),
  CONSTRAINT "reptile_fasting_periods_refusals_check" CHECK ("refused_meals_count" >= 0),
  CONSTRAINT "reptile_fasting_periods_weights_check" CHECK (("start_weight_g" IS NULL OR "start_weight_g" > 0) AND ("end_weight_g" IS NULL OR "end_weight_g" > 0))
);
CREATE INDEX "reptile_fasting_animal_started_idx" ON "reptile_fasting_periods"("animal_id", "started_at" DESC);

CREATE TABLE "reptile_brumation_periods" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "animal_id" UUID NOT NULL,
  "started_at" TIMESTAMPTZ(6) NOT NULL,
  "ended_at" TIMESTAMPTZ(6),
  "start_weight_g" DECIMAL(10,2),
  "end_weight_g" DECIMAL(10,2),
  "temperature_c" DECIMAL(5,2),
  "humidity_pct" DECIMAL(5,2),
  "conditions" TEXT,
  "notes" TEXT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "reptile_brumation_periods_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "reptile_brumation_periods_animal_id_fkey" FOREIGN KEY ("animal_id") REFERENCES "animals"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "reptile_brumation_periods_dates_check" CHECK ("ended_at" IS NULL OR "ended_at" >= "started_at"),
  CONSTRAINT "reptile_brumation_periods_weights_check" CHECK (("start_weight_g" IS NULL OR "start_weight_g" > 0) AND ("end_weight_g" IS NULL OR "end_weight_g" > 0)),
  CONSTRAINT "reptile_brumation_periods_humidity_check" CHECK ("humidity_pct" IS NULL OR ("humidity_pct" >= 0 AND "humidity_pct" <= 100))
);
CREATE INDEX "reptile_brumation_animal_started_idx" ON "reptile_brumation_periods"("animal_id", "started_at" DESC);
