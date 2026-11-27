ALTER TABLE "user_preferences"
ADD COLUMN "dashboard_layout" JSONB NOT NULL DEFAULT '{}'::jsonb;
