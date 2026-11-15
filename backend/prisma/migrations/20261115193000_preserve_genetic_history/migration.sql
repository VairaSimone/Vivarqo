ALTER TABLE "animal_genetic_trait_history" DROP CONSTRAINT "animal_genetic_trait_history_trait_id_fkey";
ALTER TABLE "animal_genetic_trait_history" ALTER COLUMN "trait_id" DROP NOT NULL;
ALTER TABLE "animal_genetic_trait_history" ADD CONSTRAINT "animal_genetic_trait_history_trait_id_fkey" FOREIGN KEY ("trait_id") REFERENCES "animal_genetic_traits"("id") ON DELETE SET NULL ON UPDATE CASCADE;
