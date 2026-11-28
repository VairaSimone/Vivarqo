-- A hatchling created from an offspring batch can keep both independent
-- provenance links: the batch identifies the birth group and the clutch
-- identifies the specific laying that produced it. The original mutual-
-- exclusion check contradicted this model and the genealogy backfill migration.
ALTER TABLE "animals"
  DROP CONSTRAINT IF EXISTS "animals_single_origin_check";
