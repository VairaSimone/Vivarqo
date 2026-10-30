CREATE TABLE "user_preferences" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "weight_unit" VARCHAR(8) NOT NULL DEFAULT 'g',
    "temperature_unit" VARCHAR(8) NOT NULL DEFAULT 'c',
    "date_format" VARCHAR(16) NOT NULL DEFAULT 'locale',
    "default_landing_page" VARCHAR(40) NOT NULL DEFAULT 'today',
    "compact_tables" BOOLEAN NOT NULL DEFAULT false,
    "theme" VARCHAR(16) NOT NULL DEFAULT 'system',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "user_preferences_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "user_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "user_preferences_user_id_key" ON "user_preferences"("user_id");
