-- Preserve a usable hatch date for legacy eggs already marked as hatched.
UPDATE "eggs"
SET "hatched_at" = "updated_at"::date
WHERE "status" = 'hatched' AND "hatched_at" IS NULL;
