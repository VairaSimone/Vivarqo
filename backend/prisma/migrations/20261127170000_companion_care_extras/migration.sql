CREATE TABLE "companion_care_logs" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id" UUID NOT NULL,
  "animal_id" UUID NOT NULL,
  "kind" VARCHAR(16) NOT NULL,
  "occurred_at" TIMESTAMPTZ(6) NOT NULL,
  "title" VARCHAR(160) NOT NULL,
  "food_type" VARCHAR(120),
  "quantity" DECIMAL(10,2),
  "quantity_unit" VARCHAR(16),
  "duration_minutes" INTEGER,
  "distance_km" DECIMAL(8,2),
  "mood" VARCHAR(40),
  "notes" TEXT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "companion_care_logs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "companion_care_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "companion_care_logs_animal_id_fkey" FOREIGN KEY ("animal_id") REFERENCES "animals"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "companion_care_logs_kind_check" CHECK ("kind" IN ('feeding','behavior','walk')),
  CONSTRAINT "companion_care_logs_quantity_check" CHECK ("quantity" IS NULL OR "quantity" > 0),
  CONSTRAINT "companion_care_logs_duration_check" CHECK ("duration_minutes" IS NULL OR "duration_minutes" BETWEEN 1 AND 1440),
  CONSTRAINT "companion_care_logs_distance_check" CHECK ("distance_km" IS NULL OR "distance_km" > 0)
);
CREATE INDEX "companion_care_logs_user_animal_kind_occurred_idx" ON "companion_care_logs"("user_id","animal_id","kind","occurred_at" DESC);

CREATE TABLE "companion_policies" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id" UUID NOT NULL,
  "animal_id" UUID NOT NULL,
  "kind" VARCHAR(20) NOT NULL,
  "title" VARCHAR(160) NOT NULL,
  "provider" VARCHAR(160),
  "reference" VARCHAR(120),
  "starts_at" DATE,
  "expires_at" DATE NOT NULL,
  "reminder_days" INTEGER NOT NULL DEFAULT 30,
  "reminder_rule_id" UUID,
  "task_id" UUID,
  "notes" TEXT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "companion_policies_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "companion_policies_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "companion_policies_animal_id_fkey" FOREIGN KEY ("animal_id") REFERENCES "animals"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "companion_policies_reminder_rule_id_fkey" FOREIGN KEY ("reminder_rule_id") REFERENCES "reminder_rules"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "companion_policies_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "companion_policies_kind_check" CHECK ("kind" IN ('insurance','document')),
  CONSTRAINT "companion_policies_reminder_days_check" CHECK ("reminder_days" BETWEEN 0 AND 365),
  CONSTRAINT "companion_policies_dates_check" CHECK ("starts_at" IS NULL OR "starts_at" <= "expires_at")
);
CREATE UNIQUE INDEX "companion_policies_reminder_rule_id_key" ON "companion_policies"("reminder_rule_id");
CREATE UNIQUE INDEX "companion_policies_task_id_key" ON "companion_policies"("task_id");
CREATE INDEX "companion_policies_user_animal_expires_idx" ON "companion_policies"("user_id","animal_id","expires_at");
