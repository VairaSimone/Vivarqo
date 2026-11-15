ALTER TABLE "animal_genetic_traits"
  ADD COLUMN "locus_id" UUID,
  ADD COLUMN "theoretical_genotype" VARCHAR(64),
  ADD COLUMN "observed_phenotype" VARCHAR(240),
  ADD COLUMN "confirmed_genotype" VARCHAR(64);

CREATE TABLE "genetic_genes" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id" UUID NOT NULL,
  "species" VARCHAR(160) NOT NULL,
  "symbol" VARCHAR(40) NOT NULL,
  "name" VARCHAR(160) NOT NULL,
  "description" TEXT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "genetic_genes_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "genetic_genes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "genetic_genes_user_species_symbol_key" ON "genetic_genes"("user_id","species","symbol");
CREATE INDEX "genetic_genes_user_species_idx" ON "genetic_genes"("user_id","species");

CREATE TABLE "genetic_loci" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "gene_id" UUID NOT NULL,
  "symbol" VARCHAR(40) NOT NULL,
  "name" VARCHAR(160) NOT NULL,
  "inheritance_mode" VARCHAR(32) NOT NULL,
  "description" TEXT,
  CONSTRAINT "genetic_loci_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "genetic_loci_gene_id_fkey" FOREIGN KEY ("gene_id") REFERENCES "genetic_genes"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "genetic_loci_gene_symbol_key" ON "genetic_loci"("gene_id","symbol");
CREATE INDEX "genetic_loci_gene_idx" ON "genetic_loci"("gene_id");

CREATE TABLE "genetic_alleles" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "locus_id" UUID NOT NULL,
  "symbol" VARCHAR(24) NOT NULL,
  "name" VARCHAR(120) NOT NULL,
  "description" TEXT,
  "is_reference" BOOLEAN NOT NULL DEFAULT false,
  CONSTRAINT "genetic_alleles_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "genetic_alleles_locus_id_fkey" FOREIGN KEY ("locus_id") REFERENCES "genetic_loci"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "genetic_alleles_locus_symbol_key" ON "genetic_alleles"("locus_id","symbol");
CREATE INDEX "genetic_alleles_locus_idx" ON "genetic_alleles"("locus_id");

ALTER TABLE "animal_genetic_traits"
  ADD CONSTRAINT "animal_genetic_traits_locus_id_fkey" FOREIGN KEY ("locus_id") REFERENCES "genetic_loci"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "animal_genetic_traits_locus_idx" ON "animal_genetic_traits"("locus_id");

CREATE TABLE "animal_genetic_trait_history" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "trait_id" UUID NOT NULL,
  "animal_id" UUID NOT NULL,
  "changed_by" UUID NOT NULL,
  "snapshot" JSONB NOT NULL,
  "changed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "animal_genetic_trait_history_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "animal_genetic_trait_history_trait_id_fkey" FOREIGN KEY ("trait_id") REFERENCES "animal_genetic_traits"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "animal_genetic_trait_history_animal_id_fkey" FOREIGN KEY ("animal_id") REFERENCES "animals"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "animal_genetic_trait_history_changed_by_fkey" FOREIGN KEY ("changed_by") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "animal_genetic_history_animal_changed_idx" ON "animal_genetic_trait_history"("animal_id","changed_at" DESC);
CREATE INDEX "animal_genetic_history_trait_changed_idx" ON "animal_genetic_trait_history"("trait_id","changed_at" DESC);
