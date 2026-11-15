CREATE TABLE IF NOT EXISTS "hatchling_care" (
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
CREATE UNIQUE INDEX IF NOT EXISTS "hatchling_care_animal_id_key" ON "hatchling_care"("animal_id");
