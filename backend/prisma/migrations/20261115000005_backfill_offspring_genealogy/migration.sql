-- Existing converted hatchlings already carry origin_offspring_batch_id.
-- Backfill missing genealogy links from their normalized reproduction cycle.
UPDATE "animals" AS offspring
SET
  "mother_animal_id" = COALESCE(offspring."mother_animal_id", cycle."parent_a_animal_id"),
  "father_animal_id" = COALESCE(offspring."father_animal_id", cycle."parent_b_animal_id")
FROM "offspring_batches" AS batch
JOIN "reproduction_cycles" AS cycle ON cycle."id" = batch."cycle_id"
WHERE offspring."origin_offspring_batch_id" = batch."id"
  AND offspring."user_id" = cycle."user_id"
  AND (cycle."parent_a_animal_id" IS NULL OR offspring."id" <> cycle."parent_a_animal_id")
  AND (cycle."parent_b_animal_id" IS NULL OR offspring."id" <> cycle."parent_b_animal_id")
  AND (offspring."mother_animal_id" IS NULL OR offspring."father_animal_id" IS NULL);
