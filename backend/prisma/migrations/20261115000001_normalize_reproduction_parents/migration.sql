-- Cycle parent A/B is now canonical: A = mother, B = father.
-- Normalize legacy pairings when both recorded sexes are known.
UPDATE "reproduction_cycles" AS cycle
SET
  "parent_a_animal_id" = cycle."parent_b_animal_id",
  "parent_b_animal_id" = cycle."parent_a_animal_id"
FROM "animals" AS parent_a, "animals" AS parent_b
WHERE cycle."parent_a_animal_id" = parent_a."id"
  AND cycle."parent_b_animal_id" = parent_b."id"
  AND parent_a."sex" = 'male'
  AND parent_b."sex" = 'female';
