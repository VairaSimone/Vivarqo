import { Router } from "express";
import { z } from "zod";
import { AppError } from "../../errors/app-error.js";
import { prisma } from "../../db/prisma.js";
import { requireSession, type AuthContext } from "../auth/session.js";
import { calculateGenetics, calculateInbreeding, type GeneticLocusInput } from "./genetic-engine.js";

function parseBody<T extends z.ZodType>(schema: T, value: unknown): z.output<T> {
  const result = schema.safeParse(value);
  if (!result.success) throw new AppError(400, "VALIDATION_ERROR", "Request validation failed", {
    issues: result.error.issues.map((issue) => ({ path: issue.path.map(String).join("."), message: issue.message })),
  });
  return result.data;
}
function uuid(value: string | string[] | undefined, label: string): string {
  const id = Array.isArray(value) ? value[0] : value;
  if (!id || !z.string().uuid().safeParse(id).success) throw new AppError(400, "INVALID_ID", `Invalid ${label}`);
  return id;
}
const traitCreate = z.object({
  traitName: z.string().trim().min(1).max(160),
  traitValue: z.string().trim().min(1).max(240),
  sourceAnimalId: z.string().uuid().nullable().optional(),
  confidenceNote: z.string().trim().max(10_000).nullable().optional(),
  inheritanceMode: z.enum(["autosomal_recessive", "incomplete_dominant", "dominant", "codominant"]).nullable().optional(),
  genotype: z.string().max(32).regex(/^(?:[A-Za-z]{2}|(?:[A-Za-z][A-Za-z0-9_-]{0,11}|\?)\|(?:[A-Za-z][A-Za-z0-9_-]{0,11}|\?))$/).nullable().optional(),
  phenotypeRules: z.record(z.string(), z.string().trim().min(1).max(240)).nullable().optional(),
  certainty: z.enum(["confirmed", "visual", "possible", "carrier", "unverified"]).optional(),
  locusId: z.string().uuid().nullable().optional(),
  theoreticalGenotype: z.string().max(64).nullable().optional(),
  observedPhenotype: z.string().trim().max(240).nullable().optional(),
  confirmedGenotype: z.string().max(64).nullable().optional(),
}).strict();
const traitPatch = z.object({
  traitName: z.string().trim().min(1).max(160).optional(),
  traitValue: z.string().trim().min(1).max(240).optional(),
  sourceAnimalId: z.string().uuid().nullable().optional(),
  confidenceNote: z.string().trim().max(10_000).nullable().optional(),
  inheritanceMode: z.enum(["autosomal_recessive", "incomplete_dominant", "dominant", "codominant"]).nullable().optional(),
  genotype: z.string().max(32).regex(/^(?:[A-Za-z]{2}|(?:[A-Za-z][A-Za-z0-9_-]{0,11}|\?)\|(?:[A-Za-z][A-Za-z0-9_-]{0,11}|\?))$/).nullable().optional(),
  phenotypeRules: z.record(z.string(), z.string().trim().min(1).max(240)).nullable().optional(),
  certainty: z.enum(["confirmed", "visual", "possible", "carrier", "unverified"]).optional(),
  locusId: z.string().uuid().nullable().optional(),
  theoreticalGenotype: z.string().max(64).nullable().optional(),
  observedPhenotype: z.string().trim().max(240).nullable().optional(),
  confirmedGenotype: z.string().max(64).nullable().optional(),
}).strict().refine((v) => Object.keys(v).length > 0, "At least one field is required");

const traitListQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(100),
});

async function ownedAnimal(userId: string, animalId: string) {
  const animal = await prisma.animal.findFirst({ where: { id: animalId, userId }, select: { id: true, species: true } });
  if (!animal) throw new AppError(404, "ANIMAL_NOT_FOUND", "Animal not found");
  return animal;
}
async function ownedLocus(userId: string, locusId: string | null | undefined) {
  if (!locusId) return [];
  const locus = await prisma.geneticLocus.findFirst({
    where: { id: locusId, gene: { is: { userId } } },
    include: { alleles: { select: { symbol: true } }, gene: { select: { species: true } } },
  });
  if (!locus) throw new AppError(404, "GENETIC_LOCUS_NOT_FOUND", "Genetic locus not found");
  return { alleles: locus.alleles.map((allele) => allele.symbol), species: locus.gene.species };
}
function validateGenotypes(genotypes: Array<string | null | undefined>, allowedAlleles: string[]) {
  if (!allowedAlleles.length) return; // Existing records remain usable until the breeder completes the catalog.
  const allowed = new Set(allowedAlleles);
  for (const value of genotypes) {
    if (!value) continue;
    const parts = value.includes("|") ? value.split("|").map((part) => part.trim()) : value.length === 2 ? [...value] : [];
    if (parts.length !== 2 || parts.some((part) => !part || (part !== "?" && !allowed.has(part)))) {
      throw new AppError(400, "GENOTYPE_ALLELE_INVALID", "Genotype contains an allele not defined for this locus");
    }
  }
}
async function ownedSource(userId: string, sourceAnimalId: string | null | undefined, animalId: string) {
  if (!sourceAnimalId) return;
  if (sourceAnimalId === animalId) throw new AppError(400, "GENETIC_SOURCE_SELF_REFERENCE", "An animal cannot be its own genetic source");
  await ownedAnimal(userId, sourceAnimalId);
}

export function createGeneticTraitsRouter() {
  const router = Router();

  router.get("/animals/:animalId/genetic-traits", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    const animalId = uuid(req.params.animalId, "animal id");
    await ownedAnimal(auth.userId, animalId);
    const query = parseBody(traitListQuery, req.query);
    const where = { animalId };
    const [total, traits] = await Promise.all([
      prisma.animalGeneticTrait.count({ where }),
      prisma.animalGeneticTrait.findMany({
        where,
        orderBy: [{ traitName: "asc" }, { createdAt: "asc" }, { id: "asc" }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: { sourceAnimal: { select: { id: true, name: true, identifier: true, species: true } } },
      }),
    ]);
    res.status(200).json({ traits, pagination: { page: query.page, pageSize: query.pageSize, total, totalPages: Math.ceil(total / query.pageSize) } });
  });

  router.post("/animals/:animalId/genetic-traits", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    const animalId = uuid(req.params.animalId, "animal id");
    const animal = await ownedAnimal(auth.userId, animalId);
    const input = parseBody(traitCreate, req.body);
    await ownedSource(auth.userId, input.sourceAnimalId, animalId);
    const locus = await ownedLocus(auth.userId, input.locusId);
    if (locus && locus.species.toLocaleLowerCase() !== animal.species.toLocaleLowerCase()) throw new AppError(400, "GENETIC_SPECIES_MISMATCH", "Genetic locus species does not match the animal species");
    validateGenotypes([input.genotype, input.theoreticalGenotype, input.confirmedGenotype], locus?.alleles ?? []);
    if (input.confirmedGenotype && input.certainty !== "confirmed") throw new AppError(400, "CONFIRMED_GENOTYPE_REQUIRES_CONFIRMATION", "A confirmed genotype requires certainty=confirmed");
    const trait = await prisma.$transaction(async (tx) => {
      const created = await tx.animalGeneticTrait.create({
        data: {
          animalId, traitName: input.traitName, traitValue: input.traitValue,
          sourceAnimalId: input.sourceAnimalId ?? null, confidenceNote: input.confidenceNote ?? null,
          inheritanceMode: input.inheritanceMode ?? null, genotype: input.genotype ?? null, phenotypeRules: input.phenotypeRules as never, certainty: input.certainty ?? "unverified",
          locusId: input.locusId ?? null, theoreticalGenotype: input.theoreticalGenotype ?? null, observedPhenotype: input.observedPhenotype ?? null, confirmedGenotype: input.confirmedGenotype ?? null,
        },
        include: { sourceAnimal: { select: { id: true, name: true, identifier: true, species: true } } },
      });
      await tx.animalGeneticTraitHistory.create({ data: { traitId: created.id, animalId, changedBy: auth.userId, snapshot: created as never } });
      await tx.auditEvent.create({ data: { userId: auth.userId, action: "animal_genetic_trait.created", entityType: "animal_genetic_trait", entityId: created.id } });
      return created;
    });
    res.status(201).json({ trait });
  });

  router.patch("/genetic-traits/:id", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    const id = uuid(req.params.id, "genetic trait id");
    const input = parseBody(traitPatch, req.body);
    const existing = await prisma.animalGeneticTrait.findFirst({ where: { id, animal: { is: { userId: auth.userId } } } });
    if (!existing) throw new AppError(404, "GENETIC_TRAIT_NOT_FOUND", "Genetic trait not found");
    const source = input.sourceAnimalId !== undefined ? input.sourceAnimalId : existing.sourceAnimalId;
    await ownedSource(auth.userId, source, existing.animalId);
    const animal = await ownedAnimal(auth.userId, existing.animalId);
    const locus = await ownedLocus(auth.userId, input.locusId !== undefined ? input.locusId : existing.locusId);
    if (locus && locus.species.toLocaleLowerCase() !== animal.species.toLocaleLowerCase()) throw new AppError(400, "GENETIC_SPECIES_MISMATCH", "Genetic locus species does not match the animal species");
    validateGenotypes([
      input.genotype !== undefined ? input.genotype : existing.genotype,
      input.theoreticalGenotype !== undefined ? input.theoreticalGenotype : existing.theoreticalGenotype,
      input.confirmedGenotype !== undefined ? input.confirmedGenotype : existing.confirmedGenotype,
    ], locus?.alleles ?? []);
    const nextCertainty = input.certainty ?? existing.certainty;
    const nextConfirmedGenotype = input.confirmedGenotype !== undefined ? input.confirmedGenotype : existing.confirmedGenotype;
    if (nextConfirmedGenotype && nextCertainty !== "confirmed") throw new AppError(400, "CONFIRMED_GENOTYPE_REQUIRES_CONFIRMATION", "A confirmed genotype requires certainty=confirmed");
    const trait = await prisma.$transaction(async (tx) => {
      await tx.animalGeneticTraitHistory.create({ data: { traitId: id, animalId: existing.animalId, changedBy: auth.userId, snapshot: existing as never } });
      const updated = await tx.animalGeneticTrait.update({ where: { id }, data: input as never, include: { sourceAnimal: { select: { id: true, name: true, identifier: true, species: true } } } });
      await tx.auditEvent.create({ data: { userId: auth.userId, action: "animal_genetic_trait.updated", entityType: "animal_genetic_trait", entityId: id } });
      return updated;
    });
    res.status(200).json({ trait });
  });

  router.delete("/genetic-traits/:id", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    const id = uuid(req.params.id, "genetic trait id");
    const existing = await prisma.animalGeneticTrait.findFirst({ where: { id, animal: { is: { userId: auth.userId } } }, select: { id: true } });
    if (!existing) throw new AppError(404, "GENETIC_TRAIT_NOT_FOUND", "Genetic trait not found");
    await prisma.$transaction(async (tx) => {
      const snapshot = await tx.animalGeneticTrait.findUniqueOrThrow({ where: { id } });
      await tx.animalGeneticTraitHistory.create({ data: { traitId: id, animalId: snapshot.animalId, changedBy: auth.userId, snapshot: snapshot as never } });
      await tx.animalGeneticTrait.delete({ where: { id } });
    });
    res.status(204).send();
  });


  router.get("/genetics/catalog", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    const species = typeof req.query.species === "string" ? req.query.species.trim().slice(0, 160) : "";
    const genes = await prisma.geneticGene.findMany({
      where: { userId: auth.userId, ...(species ? { species: { equals: species, mode: "insensitive" as const } } : {}) },
      include: { loci: { include: { alleles: { orderBy: { symbol: "asc" } } }, orderBy: { symbol: "asc" } } },
      orderBy: [{ species: "asc" }, { symbol: "asc" }],
    });
    res.status(200).json({ genes });
  });

  router.post("/genetics/genes", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    const input = parseBody(z.object({
      species: z.string().trim().min(1).max(160), symbol: z.string().trim().min(1).max(40),
      name: z.string().trim().min(1).max(160), description: z.string().max(10000).nullable().optional(),
    }).strict(), req.body);
    const gene = await prisma.geneticGene.create({ data: { ...input, userId: auth.userId } });
    res.status(201).json({ gene });
  });

  router.post("/genetics/genes/:geneId/loci", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    const geneId = uuid(req.params.geneId, "gene id");
    const input = parseBody(z.object({
      symbol: z.string().trim().min(1).max(40), name: z.string().trim().min(1).max(160),
      inheritanceMode: z.enum(["autosomal_recessive", "dominant", "incomplete_dominant", "codominant"]),
      description: z.string().max(10000).nullable().optional(),
    }).strict(), req.body);
    const gene = await prisma.geneticGene.findFirst({ where: { id: geneId, userId: auth.userId }, select: { id: true } });
    if (!gene) throw new AppError(404, "GENETIC_GENE_NOT_FOUND", "Genetic gene not found");
    const locus = await prisma.geneticLocus.create({ data: { geneId, ...input } });
    res.status(201).json({ locus });
  });

  router.post("/genetics/loci/:locusId/alleles", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    const locusId = uuid(req.params.locusId, "locus id");
    const input = parseBody(z.object({
      symbol: z.string().trim().min(1).max(24), name: z.string().trim().min(1).max(120),
      description: z.string().max(10000).nullable().optional(), isReference: z.boolean().optional(),
    }).strict(), req.body);
    await ownedLocus(auth.userId, locusId);
    const allele = await prisma.$transaction(async (tx) => {
      if (input.isReference) await tx.geneticAllele.updateMany({ where: { locusId, isReference: true }, data: { isReference: false } });
      return tx.geneticAllele.create({ data: { locusId, ...input } });
    });
    res.status(201).json({ allele });
  });


  router.patch("/genetics/genes/:geneId", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    const geneId = uuid(req.params.geneId, "gene id");
    const input = parseBody(z.object({
      species: z.string().trim().min(1).max(160).optional(),
      symbol: z.string().trim().min(1).max(40).optional(),
      name: z.string().trim().min(1).max(160).optional(),
      description: z.string().max(10000).nullable().optional(),
    }).strict().refine((value) => Object.keys(value).length > 0), req.body);
    const existing = await prisma.geneticGene.findFirst({ where: { id: geneId, userId: auth.userId }, select: { id: true } });
    if (!existing) throw new AppError(404, "GENETIC_GENE_NOT_FOUND", "Genetic gene not found");
    const gene = await prisma.geneticGene.update({ where: { id: geneId }, data: input });
    res.status(200).json({ gene });
  });
  router.delete("/genetics/genes/:geneId", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    const geneId = uuid(req.params.geneId, "gene id");
    const existing = await prisma.geneticGene.findFirst({ where: { id: geneId, userId: auth.userId }, select: { id: true } });
    if (!existing) throw new AppError(404, "GENETIC_GENE_NOT_FOUND", "Genetic gene not found");
    const usedTraits = await prisma.animalGeneticTrait.count({ where: { locus: { is: { geneId } } } });
    if (usedTraits) throw new AppError(409, "GENETIC_CATALOG_IN_USE", "This gene is linked to animal genetic records");
    await prisma.geneticGene.delete({ where: { id: geneId } });
    res.status(204).send();
  });
  router.patch("/genetics/loci/:locusId", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    const locusId = uuid(req.params.locusId, "locus id");
    const input = parseBody(z.object({
      symbol: z.string().trim().min(1).max(40).optional(),
      name: z.string().trim().min(1).max(160).optional(),
      inheritanceMode: z.enum(["autosomal_recessive", "dominant", "incomplete_dominant", "codominant"]).optional(),
      description: z.string().max(10000).nullable().optional(),
    }).strict().refine((value) => Object.keys(value).length > 0), req.body);
    await ownedLocus(auth.userId, locusId);
    const locus = await prisma.geneticLocus.update({ where: { id: locusId }, data: input });
    res.status(200).json({ locus });
  });
  router.delete("/genetics/loci/:locusId", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    const locusId = uuid(req.params.locusId, "locus id");
    await ownedLocus(auth.userId, locusId);
    const usedTraits = await prisma.animalGeneticTrait.count({ where: { locusId } });
    if (usedTraits) throw new AppError(409, "GENETIC_CATALOG_IN_USE", "This locus is linked to animal genetic records");
    await prisma.geneticLocus.delete({ where: { id: locusId } });
    res.status(204).send();
  });
  router.patch("/genetics/alleles/:alleleId", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    const alleleId = uuid(req.params.alleleId, "allele id");
    const input = parseBody(z.object({
      symbol: z.string().trim().min(1).max(24).optional(),
      name: z.string().trim().min(1).max(120).optional(),
      description: z.string().max(10000).nullable().optional(),
      isReference: z.boolean().optional(),
    }).strict().refine((value) => Object.keys(value).length > 0), req.body);
    const existing = await prisma.geneticAllele.findFirst({ where: { id: alleleId, locus: { is: { gene: { is: { userId: auth.userId } } } } }, select: { id: true, locusId: true } });
    if (!existing) throw new AppError(404, "GENETIC_ALLELE_NOT_FOUND", "Genetic allele not found");
    const allele = await prisma.$transaction(async (tx) => {
      if (input.isReference) await tx.geneticAllele.updateMany({ where: { locusId: existing.locusId, isReference: true, id: { not: alleleId } }, data: { isReference: false } });
      return tx.geneticAllele.update({ where: { id: alleleId }, data: input });
    });
    res.status(200).json({ allele });
  });
  router.delete("/genetics/alleles/:alleleId", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    const alleleId = uuid(req.params.alleleId, "allele id");
    const existing = await prisma.geneticAllele.findFirst({ where: { id: alleleId, locus: { is: { gene: { is: { userId: auth.userId } } } } }, select: { id: true, locusId: true } });
    if (!existing) throw new AppError(404, "GENETIC_ALLELE_NOT_FOUND", "Genetic allele not found");
    const usedTraits = await prisma.animalGeneticTrait.count({ where: { locusId: existing.locusId } });
    if (usedTraits) throw new AppError(409, "GENETIC_CATALOG_IN_USE", "This allele may be referenced by saved animal genotypes");
    await prisma.geneticAllele.delete({ where: { id: alleleId } });
    res.status(204).send();
  });

  router.get("/animals/:animalId/genetic-history", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    const animalId = uuid(req.params.animalId, "animal id");
    await ownedAnimal(auth.userId, animalId);
    const history = await prisma.animalGeneticTraitHistory.findMany({
      where: { animalId }, orderBy: [{ changedAt: "desc" }, { id: "desc" }], take: 200,
    });
    res.status(200).json({ history });
  });

  router.post("/genetics/calculate", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    const input = parseBody(z.object({
      loci: z.array(z.object({ locusId: z.string().uuid(), motherGenotype: z.string().max(64), fatherGenotype: z.string().max(64) }).strict()).min(1).max(12),
    }).strict(), req.body);
    const ids = input.loci.map((item) => item.locusId);
    const catalog = await prisma.geneticLocus.findMany({
      where: { id: { in: ids }, gene: { is: { userId: auth.userId } } }, include: { alleles: true },
    });
    if (catalog.length !== ids.length || new Set(ids).size !== ids.length) throw new AppError(400, "GENETIC_LOCUS_INVALID", "One or more loci are unavailable");
    const byId = new Map(catalog.map((locus) => [locus.id, locus]));
    const calculation = calculateGenetics(input.loci.map((item) => {
      const locus = byId.get(item.locusId)!;
      return {
        locusId: locus.id, name: locus.name,
        inheritanceMode: locus.inheritanceMode as GeneticLocusInput["inheritanceMode"],
        motherGenotype: item.motherGenotype, fatherGenotype: item.fatherGenotype,
        referenceAllele: locus.alleles.find((allele) => allele.isReference)?.symbol ?? null,
        allowedAlleles: locus.alleles.map((allele) => allele.symbol),
      };
    }));
    res.status(200).json({ calculation });
  });

  router.post("/genetics/calculate-pairing", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    const input = parseBody(z.object({
      motherAnimalId: z.string().uuid(), fatherAnimalId: z.string().uuid(),
      locusIds: z.array(z.string().uuid()).min(1).max(12),
    }).strict(), req.body);
    if (input.motherAnimalId === input.fatherAnimalId) throw new AppError(400, "INVALID_PAIRING", "Parents must be different animals");
    const motherAnimal = await ownedAnimal(auth.userId, input.motherAnimalId);
    const fatherAnimal = await ownedAnimal(auth.userId, input.fatherAnimalId);
    if (motherAnimal.species.toLocaleLowerCase() !== fatherAnimal.species.toLocaleLowerCase()) throw new AppError(400, "GENETIC_SPECIES_MISMATCH", "Pairing parents must belong to the same species");
    const [catalog, traits] = await Promise.all([
      prisma.geneticLocus.findMany({ where: { id: { in: input.locusIds }, gene: { is: { userId: auth.userId } } }, include: { alleles: true, gene: { select: { species: true } } } }),
      prisma.animalGeneticTrait.findMany({ where: { animalId: { in: [input.motherAnimalId, input.fatherAnimalId] }, locusId: { in: input.locusIds } } }),
    ]);
    if (catalog.length !== input.locusIds.length || new Set(input.locusIds).size !== input.locusIds.length) throw new AppError(400, "GENETIC_LOCUS_INVALID", "One or more loci are unavailable");
    if (catalog.some((locus) => locus.gene.species.toLocaleLowerCase() !== motherAnimal.species.toLocaleLowerCase())) throw new AppError(400, "GENETIC_SPECIES_MISMATCH", "Selected loci do not belong to the parents species");
    const inputs: GeneticLocusInput[] = catalog.map((locus) => {
      const motherTraits = traits.filter((trait) => trait.animalId === input.motherAnimalId && trait.locusId === locus.id);
      const fatherTraits = traits.filter((trait) => trait.animalId === input.fatherAnimalId && trait.locusId === locus.id);
      const genotypeFor = (records: typeof motherTraits) => {
        const confirmed = [...new Set(records.flatMap((trait) => trait.confirmedGenotype ? [trait.confirmedGenotype] : []))];
        if (confirmed.length > 1) return "?|?";
        if (confirmed.length === 1) return confirmed[0]!;
        const verified = [...new Set(records.flatMap((trait) => ["confirmed", "carrier"].includes(trait.certainty) && trait.genotype ? [trait.genotype] : []))];
        if (verified.length > 1) return "?|?";
        if (verified.length === 1) return verified[0]!;
        const theoretical = [...new Set(records.flatMap((trait) => trait.theoreticalGenotype ? [trait.theoreticalGenotype] : []))];
        return theoretical.length === 1 ? theoretical[0]! : "?|?";
      };
      const rules: Record<string, string> = {};
      let conflict = false;
      for (const ruleSet of [...motherTraits.map((trait) => trait.phenotypeRules), ...fatherTraits.map((trait) => trait.phenotypeRules)]) {
        if (!ruleSet || typeof ruleSet !== "object" || Array.isArray(ruleSet)) continue;
        for (const [genotype, value] of Object.entries(ruleSet as Record<string, unknown>)) {
          if (typeof value !== "string") continue;
          if (rules[genotype] && rules[genotype] !== value) conflict = true;
          else rules[genotype] = value;
        }
      }
      return {
        locusId: locus.id, name: locus.name,
        inheritanceMode: locus.inheritanceMode as GeneticLocusInput["inheritanceMode"],
        motherGenotype: genotypeFor(motherTraits), fatherGenotype: genotypeFor(fatherTraits),
        referenceAllele: locus.alleles.find((allele) => allele.isReference)?.symbol ?? null,
        allowedAlleles: locus.alleles.map((allele) => allele.symbol),
        phenotypeRules: conflict ? null : rules, phenotypeRulesConflict: conflict,
      };
    });
    res.status(200).json({ calculation: calculateGenetics(inputs) });
  });

  router.get("/animals/:animalId/inbreeding", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    const animalId = uuid(req.params.animalId, "animal id");
    await ownedAnimal(auth.userId, animalId);
    const animals = await prisma.animal.findMany({ where: { userId: auth.userId }, select: { id: true, motherAnimalId: true, fatherAnimalId: true } });
    const inbreeding = calculateInbreeding(animals.map((animal) => ({ id: animal.id, motherId: animal.motherAnimalId, fatherId: animal.fatherAnimalId })), animalId, 8);
    res.status(200).json({ inbreeding });
  });

  router.get("/animals/:animalId/pedigree", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    const animalId = uuid(req.params.animalId, "animal id");
    await ownedAnimal(auth.userId, animalId);
    const animals = await prisma.animal.findMany({
      where: { userId: auth.userId },
      select: { id: true, name: true, species: true, motherAnimalId: true, fatherAnimalId: true, motherDescription: true, fatherDescription: true },
    });
    const byId = new Map(animals.map((animal) => [animal.id, animal]));
    const nodes = new Map<string, { id: string; name: string; species: string; generation: number }>();
    const edges: Array<{ childId: string; parentId: string; role: "mother" | "father" }> = [];
    const missingParents: Array<{ childId: string; role: "mother" | "father"; description: string | null }> = [];
    const walk = (id: string, generation: number, path: string[]) => {
      const animal = byId.get(id);
      if (!animal || generation > 8 || path.includes(id)) return;
      nodes.set(id, { id, name: animal.name, species: animal.species, generation });
      for (const [role, parentId, description] of [
        ["mother", animal.motherAnimalId, animal.motherDescription],
        ["father", animal.fatherAnimalId, animal.fatherDescription],
      ] as const) {
        if (!parentId) { missingParents.push({ childId: id, role, description }); continue; }
        if (!byId.has(parentId)) { missingParents.push({ childId: id, role, description: description ?? "Genitore non presente nel catalogo dell'allevatore" }); continue; }
        if (path.includes(parentId)) continue;
        edges.push({ childId: id, parentId, role });
        walk(parentId, generation + 1, [...path, id]);
      }
    };
    walk(animalId, 0, []);
    res.status(200).json({ nodes: [...nodes.values()], edges, missingParents, generations: 8 });
  });

  return router;
}
