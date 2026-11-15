CREATE UNIQUE INDEX "genetic_alleles_one_reference_per_locus_idx" ON "genetic_alleles"("locus_id") WHERE "is_reference" = true;
