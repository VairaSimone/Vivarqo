import { Router } from "express";
import { z } from "zod";
import { AppError } from "../../errors/app-error.js";
import { prisma } from "../../db/prisma.js";
import { requireSession, type AuthContext } from "../auth/session.js";
import { assertAnimalCapacity } from "./billing-entitlements.js";
import { deletePrivateObject } from "./private-storage.js";
import { logger } from "../../logger.js";

import {
  createCycleSchema,
  patchCycleSchema,
  createEventSchema,
  patchEventSchema,
  createClutchSchema,
  patchClutchSchema,
  eggSchema,
  patchEggSchema,
  incubationSchema,
  offspringSchema,
  patchOffspringSchema,
  newAnimalSchema,
  reproductionPageSchema as pageSchema,
  reproductionCycleStatusSchema,
  eggMeasurementSchema, incubatorSchema, patchIncubatorSchema, patchEggMeasurementSchema, incubatorMaintenanceSchema, hatchlingCareSchema, speciesBreedingProfileSchema,
} from "@vivarqo/contracts/reproduction";

function parseBody<T extends z.ZodType>(schema: T, value: unknown): z.output<T> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new AppError(400, "VALIDATION_ERROR", "Request validation failed", {
      issues: parsed.error.issues.map((issue) => ({ path: issue.path.map(String).join("."), message: issue.message })),
    });
  }
  return parsed.data;
}
function routeUuid(value: string | string[] | undefined, label: string): string {
  const id = Array.isArray(value) ? value[0] : value;
  if (!id || !z.string().uuid().safeParse(id).success) throw new AppError(400, "INVALID_ID", `Invalid ${label}`);
  return id;
}
function validDate(value: string): Date {
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new AppError(400, "VALIDATION_ERROR", "Invalid calendar date");
  return date;
}
function serializeEgg<T extends { id: string; photoKey: string | null; updatedAt: Date }>(egg: T) {
  const { photoKey, updatedAt, ...safe } = egg;
  return { ...safe, photoUrl: photoKey ? `/api/v1/eggs/${egg.id}/photo?v=${updatedAt.getTime()}` : null };
}
async function assertOwnedAnimals(userId: string, ids: Array<string | null | undefined>) {
  const expected = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  if (!expected.length) return;
  const rows = await prisma.animal.findMany({ where: { userId, id: { in: expected } }, select: { id: true } });
  if (rows.length !== expected.length) throw new AppError(404, "ANIMAL_NOT_FOUND", "One or more animals were not found");
}
async function assertCycleParentSexes(userId: string, motherId?: string | null, fatherId?: string | null) {
  const ids = [...new Set([motherId, fatherId].filter((id): id is string => Boolean(id)))];
  if (!ids.length) return;
  const animals = await prisma.animal.findMany({ where: { userId, id: { in: ids } }, select: { id: true, sex: true } });
  if (animals.length !== ids.length) throw new AppError(404, "ANIMAL_NOT_FOUND", "One or more breeding animals were not found");
  if (motherId && animals.find((animal) => animal.id === motherId)?.sex === "male") throw new AppError(400, "INVALID_MOTHER_SEX", "The mother must be female or have unknown sex");
  if (fatherId && animals.find((animal) => animal.id === fatherId)?.sex === "female") throw new AppError(400, "INVALID_FATHER_SEX", "The father must be male or have unknown sex");
}
async function ownedCycle(userId: string, cycleId: string) {
  const cycle = await prisma.reproductionCycle.findFirst({ where: { id: cycleId, userId } });
  if (!cycle) throw new AppError(404, "REPRODUCTION_CYCLE_NOT_FOUND", "Reproduction cycle not found");
  return cycle;
}
async function ownedClutch(userId: string, clutchId: string) {
  const clutch = await prisma.clutch.findFirst({ where: { id: clutchId, cycle: { is: { userId } } } });
  if (!clutch) throw new AppError(404, "CLUTCH_NOT_FOUND", "Clutch not found");
  return clutch;
}
export function createReproductionRouter() {
  const router = Router();

  router.get("/species-breeding-profiles", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    const species = typeof req.query.species === "string" ? req.query.species.trim().slice(0, 160) : "";
    if (!species) throw new AppError(400, "SPECIES_REQUIRED", "Species is required");
    const profile = await prisma.speciesBreedingProfile.findFirst({ where: { userId: auth.userId, species: { equals: species, mode: "insensitive" } } });
    res.status(200).json({ profile });
  });

  router.patch("/species-breeding-profiles", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    const input = parseBody(speciesBreedingProfileSchema, req.body);
    const existing = await prisma.speciesBreedingProfile.findFirst({ where: { userId: auth.userId, species: { equals: input.species, mode: "insensitive" } }, select: { id: true } });
    const profile = existing
      ? await prisma.speciesBreedingProfile.update({ where: { id: existing.id }, data: {
          species: input.species, femaleMinAgeMonths: input.femaleMinAgeMonths ?? null,
          maleMinAgeMonths: input.maleMinAgeMonths ?? null, femaleMinWeightG: input.femaleMinWeightG ?? null,
          maleMinWeightG: input.maleMinWeightG ?? null, notes: input.notes ?? null,
        } })
      : await prisma.speciesBreedingProfile.create({ data: {
          userId: auth.userId, species: input.species, femaleMinAgeMonths: input.femaleMinAgeMonths ?? null,
          maleMinAgeMonths: input.maleMinAgeMonths ?? null, femaleMinWeightG: input.femaleMinWeightG ?? null,
          maleMinWeightG: input.maleMinWeightG ?? null, notes: input.notes ?? null,
        } });
    res.status(200).json({ profile });
  });

  // Pair insights are derived from owned animals and existing reproduction records.
  // Thresholds are only applied when the configured species matches both parents.
  router.get("/reproduction-pairs/insights", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    const motherId = routeUuid(typeof req.query.motherId === "string" ? req.query.motherId : undefined, "mother id");
    const fatherId = routeUuid(typeof req.query.fatherId === "string" ? req.query.fatherId : undefined, "father id");
    if (motherId === fatherId) throw new AppError(400, "INVALID_PAIR", "The two parents must be different animals");
    const parents = await prisma.animal.findMany({
      where: { userId: auth.userId, id: { in: [motherId, fatherId] } },
      select: {
        id: true, name: true, species: true, sex: true, morph: true, geneticsNotes: true,
        birthDate: true, motherAnimalId: true, fatherAnimalId: true,
        geneticTraits: { select: { id: true, traitName: true, traitValue: true, confidenceNote: true, sourceAnimalId: true, inheritanceMode: true, genotype: true, certainty: true, phenotypeRules: true } },
        weightMeasurements: { orderBy: [{ measuredAt: "desc" }, { id: "desc" }], take: 1, select: { measuredAt: true, weightG: true } },
      },
    });
    if (parents.length !== 2) throw new AppError(404, "ANIMAL_NOT_FOUND", "One or both breeding animals were not found");
    const mother = parents.find((animal) => animal.id === motherId)!;
    const father = parents.find((animal) => animal.id === fatherId)!;
    const breedingProfile = await prisma.speciesBreedingProfile.findFirst({
      where: { userId: auth.userId, species: { equals: mother.species, mode: "insensitive" } },
    });
    const pairCycles = await prisma.reproductionCycle.findMany({
      where: { userId: auth.userId, parentAAnimalId: motherId, parentBAnimalId: fatherId },
      select: {
        id: true, name: true, startedOn: true, status: true,
        events: { where: { eventType: { in: ["pairing", "pairing_failed", "no_deposition", "loss", "hatch", "live_birth", "infertile_clutch", "embryonic_loss", "stillbirth", "post_hatch_loss"] } }, orderBy: [{ occurredAt: "asc" }, { id: "asc" }], select: { eventType: true, occurredAt: true, details: true } },
        _count: { select: { clutches: true, offspringBatches: true } },
      },
      orderBy: [{ startedOn: "desc" }],
    });
    const ancestorLevels = async (animalId: string) => {
      const levels: Array<Array<{ id: string; name: string }>> = [];
      let frontier = [animalId];
      const seen = new Set(frontier);
      for (let depth = 1; depth <= 8 && frontier.length; depth += 1) {
        const rows = await prisma.animal.findMany({
          where: { userId: auth.userId, id: { in: frontier } },
          select: { motherAnimalId: true, fatherAnimalId: true },
        });
        const next = [...new Set(rows.flatMap((row) => [row.motherAnimalId, row.fatherAnimalId]).filter((id): id is string => id !== null && !seen.has(id)))].slice(0, 256);
        if (!next.length) break;
        next.forEach((id) => seen.add(id));
        const ancestors = await prisma.animal.findMany({ where: { userId: auth.userId, id: { in: next } }, select: { id: true, name: true } });
        levels.push(ancestors);
        frontier = ancestors.map((item) => item.id);
      }
      return levels;
    };
    const [motherAncestors, fatherAncestors] = await Promise.all([ancestorLevels(motherId), ancestorLevels(fatherId)]);
    const motherAncestorIds = new Set(motherAncestors.flat().map((item) => item.id));
    const commonAncestorIds = new Set(fatherAncestors.flat().map((item) => item.id).filter((id) => motherAncestorIds.has(id)));
    const commonAncestors = [...motherAncestors.flat(), ...fatherAncestors.flat()]
      .filter((item, index, all) => commonAncestorIds.has(item.id) && all.findIndex((candidate) => candidate.id === item.id) === index);
    const ancestorDepths = (levels: Array<Array<{ id: string; name: string }>>) => {
      const depths = new Map<string, number>();
      levels.forEach((items, index) => items.forEach((item) => { if (!depths.has(item.id)) depths.set(item.id, index + 1); }));
      return depths;
    };
    const motherDepths = ancestorDepths(motherAncestors);
    const fatherDepths = ancestorDepths(fatherAncestors);
    const inbreedingCoefficientEstimate = commonAncestors.reduce((sum, ancestor) => {
      const m = motherDepths.get(ancestor.id);
      const f = fatherDepths.get(ancestor.id);
      return m && f ? sum + Math.pow(0.5, m + f + 1) : sum;
    }, 0);
    const parseDiploidGenotype = (value: string): [string, string] | null => {
      const alleles = value.includes("|")
        ? value.split("|").map((allele) => allele.trim()).filter(Boolean)
        : [...value.trim()];
      return alleles.length === 2 && alleles.every((allele) => allele.length <= 12) ? [alleles[0]!, alleles[1]!] : null;
    };
    const canonicalGenotype = (a: string, b: string) =>
      [a, b].sort((left, right) => left.toLocaleLowerCase().localeCompare(right.toLocaleLowerCase()) || left.localeCompare(right)).join("|");
    const geneticPredictions = mother.geneticTraits.flatMap((maternalTrait) => {
      const paternalTrait = father.geneticTraits.find((trait) => trait.traitName.trim().toLocaleLowerCase() === maternalTrait.traitName.trim().toLocaleLowerCase());
      if (!paternalTrait || !maternalTrait.genotype || !paternalTrait.genotype ||
          maternalTrait.inheritanceMode !== paternalTrait.inheritanceMode ||
          !maternalTrait.inheritanceMode ||
          !["confirmed", "carrier"].includes(maternalTrait.certainty) ||
          !["confirmed", "carrier"].includes(paternalTrait.certainty)) return [];
      const maternalAlleles = parseDiploidGenotype(maternalTrait.genotype);
      const paternalAlleles = parseDiploidGenotype(paternalTrait.genotype);
      if (!maternalAlleles || !paternalAlleles) return [];
      const outcomes = new Map<string, number>();
      for (const maternalAllele of maternalAlleles) {
        for (const paternalAllele of paternalAlleles) {
          const genotype = canonicalGenotype(maternalAllele, paternalAllele);
          outcomes.set(genotype, (outcomes.get(genotype) ?? 0) + 25);
        }
      }
      const normalizeRules = (value: unknown): Record<string, string> | null => {
        if (!value || typeof value !== "object" || Array.isArray(value)) return null;
        const normalized: Record<string, string> = {};
        for (const [key, phenotype] of Object.entries(value)) {
          const alleles = parseDiploidGenotype(key);
          if (alleles && typeof phenotype === "string" && phenotype.trim()) {
            normalized[canonicalGenotype(alleles[0], alleles[1])] = phenotype.trim();
          }
        }
        return Object.keys(normalized).length ? normalized : null;
      };
      const maternalRules = normalizeRules(maternalTrait.phenotypeRules);
      const paternalRules = normalizeRules(paternalTrait.phenotypeRules);
      const rulesSignature = (rules: Record<string, string> | null) => JSON.stringify(Object.entries(rules ?? {}).sort(([left], [right]) => left.localeCompare(right)));
      const phenotypeRulesConflict = Boolean(maternalRules && paternalRules && rulesSignature(maternalRules) !== rulesSignature(paternalRules));
      const phenotypeRules = phenotypeRulesConflict ? null : maternalRules ?? paternalRules;
      const probabilities = [...outcomes.entries()].map(([genotype, probabilityPct]) => ({
        genotype,
        probabilityPct,
        phenotype: phenotypeRules?.[genotype] ?? null,
      }));
      const phenotypeTotals = new Map<string, number>();
      for (const outcome of probabilities) if (outcome.phenotype) {
        phenotypeTotals.set(outcome.phenotype, (phenotypeTotals.get(outcome.phenotype) ?? 0) + outcome.probabilityPct);
      }
      return [{
        traitName: maternalTrait.traitName,
        inheritanceMode: maternalTrait.inheritanceMode,
        probabilities,
        phenotypePredictions: [...phenotypeTotals.entries()].map(([phenotype, probabilityPct]) => ({ phenotype, probabilityPct })),
        phenotypePredictionStatus: phenotypeRulesConflict ? "rules_conflict" : !phenotypeRules ? "not_configured" : probabilities.some((outcome) => !outcome.phenotype) ? "partial" : "mapped",
        certainty: "theoretical_single_locus",
      }];
    });
    // Independent-locus combinations are calculated as a Cartesian product.
    // Linkage, recombination and epistasis are intentionally not assumed.
    const combinedGeneticOutcomes = geneticPredictions.reduce<Array<{ loci: Array<{ traitName: string; genotype: string; phenotype: string | null }>; phenotype: string | null; probabilityPct: number }>>(
      (combinations, prediction) => {
        if (!combinations.length) return prediction.probabilities.map((outcome) => ({
          loci: [{ traitName: prediction.traitName, genotype: outcome.genotype, phenotype: outcome.phenotype }],
          phenotype: outcome.phenotype ? `${prediction.traitName}: ${outcome.phenotype}` : null,
          probabilityPct: outcome.probabilityPct,
        }));
        return combinations.flatMap((combination) => prediction.probabilities.map((outcome) => ({
          loci: [...combination.loci, { traitName: prediction.traitName, genotype: outcome.genotype, phenotype: outcome.phenotype }],
          phenotype: combination.phenotype && outcome.phenotype ? `${combination.phenotype} · ${prediction.traitName}: ${outcome.phenotype}` : null,
          probabilityPct: Number((combination.probabilityPct * outcome.probabilityPct / 100).toFixed(6)),
        }))).slice(0, 256);
      },
      [],
    );
    const geneticOutcomeCombinationsTruncated = combinedGeneticOutcomes.length >= 256;
    const pairingEvents = pairCycles.flatMap((cycle) => cycle.events.filter((event) => event.eventType === "pairing"));
    const sortedPairings = pairingEvents.sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
    const allEvents = pairCycles.flatMap((cycle) => cycle.events);
    const ageYears = (birthDate: Date | null) => birthDate ? Math.floor((Date.now() - birthDate.getTime()) / 31_557_600_000) : null;
    const ageMonths = (birthDate: Date | null) => birthDate ? Math.floor((Date.now() - birthDate.getTime()) / 2_629_746_000) : null;
    const motherAgeMonths = ageMonths(mother.birthDate);
    const fatherAgeMonths = ageMonths(father.birthDate);
    const motherWeightG = mother.weightMeasurements[0] ? Number(mother.weightMeasurements[0].weightG) : null;
    const fatherWeightG = father.weightMeasurements[0] ? Number(father.weightMeasurements[0].weightG) : null;
    const sameSpecies = mother.species.trim().toLocaleLowerCase() === father.species.trim().toLocaleLowerCase();
    const warnings = [
      ...(mother.sex !== "female" ? ["MOTHER_SEX_NOT_CONFIRMED_FEMALE"] : []),
      ...(father.sex !== "male" ? ["FATHER_SEX_NOT_CONFIRMED_MALE"] : []),
      ...(!sameSpecies ? ["SPECIES_MISMATCH"] : []),
      ...(commonAncestors.length ? ["COMMON_ANCESTORS_FOUND"] : []),
      ...(!mother.birthDate ? ["MOTHER_AGE_UNKNOWN"] : []),
      ...(!father.birthDate ? ["FATHER_AGE_UNKNOWN"] : []),
      ...(!mother.weightMeasurements[0] ? ["MOTHER_WEIGHT_UNKNOWN"] : []),
      ...(!father.weightMeasurements[0] ? ["FATHER_WEIGHT_UNKNOWN"] : []),
      ...(sameSpecies && breedingProfile?.femaleMinAgeMonths != null && motherAgeMonths != null && motherAgeMonths < breedingProfile.femaleMinAgeMonths ? ["MOTHER_BELOW_MIN_AGE"] : []),
      ...(sameSpecies && breedingProfile?.maleMinAgeMonths != null && fatherAgeMonths != null && fatherAgeMonths < breedingProfile.maleMinAgeMonths ? ["FATHER_BELOW_MIN_AGE"] : []),
      ...(sameSpecies && breedingProfile?.femaleMinWeightG != null && motherWeightG != null && motherWeightG < Number(breedingProfile.femaleMinWeightG) ? ["MOTHER_BELOW_MIN_WEIGHT"] : []),
      ...(sameSpecies && breedingProfile?.maleMinWeightG != null && fatherWeightG != null && fatherWeightG < Number(breedingProfile.maleMinWeightG) ? ["FATHER_BELOW_MIN_WEIGHT"] : []),
    ];
    res.status(200).json({
      pair: {
        mother: { id: mother.id, name: mother.name, species: mother.species, sex: mother.sex, morph: mother.morph, geneticsNotes: mother.geneticsNotes, ageYears: ageYears(mother.birthDate), lastWeight: mother.weightMeasurements[0] ?? null, geneticTraits: mother.geneticTraits },
        father: { id: father.id, name: father.name, species: father.species, sex: father.sex, morph: father.morph, geneticsNotes: father.geneticsNotes, ageYears: ageYears(father.birthDate), lastWeight: father.weightMeasurements[0] ?? null, geneticTraits: father.geneticTraits },
        compatibleSpecies: sameSpecies,
        breedingProfile,
        warnings,
        commonAncestors,
        history: {
          cycleCount: pairCycles.length,
          pairingCount: sortedPairings.length,
          firstPairingAt: sortedPairings[0]?.occurredAt ?? null,
          lastPairingAt: sortedPairings.at(-1)?.occurredAt ?? null,
          clutchCount: pairCycles.reduce((sum, cycle) => sum + cycle._count.clutches, 0),
          offspringBatchCount: pairCycles.reduce((sum, cycle) => sum + cycle._count.offspringBatches, 0),
          outcomes: allEvents.map((event) => ({ type: event.eventType, occurredAt: event.occurredAt, details: event.details })),
          cycles: pairCycles.map((cycle) => ({ id: cycle.id, name: cycle.name, startedOn: cycle.startedOn, status: cycle.status, clutchCount: cycle._count.clutches, offspringBatchCount: cycle._count.offspringBatches })),
        },
        geneticDataIsIncomplete: geneticPredictions.length === 0 || geneticPredictions.length < Math.max(mother.geneticTraits.length, father.geneticTraits.length),
        inbreedingCoefficientEstimate: commonAncestors.length ? Math.min(1, inbreedingCoefficientEstimate) : null,
        inbreedingCoefficientAssumption: "Screening estimate from shared ancestor paths through at most 8 generations; assumes unrelated founders, ignores inbreeding in ancestors and can be incomplete when pedigree paths are missing.",
        geneticPredictions,
        combinedGeneticOutcomes,
        geneticOutcomeCombinationsTruncated,
        geneticModelAssumptions: ["Diploid single-locus crosses", "Independent loci; no linkage or recombination model", "No phenotype inferred without explicit allele dominance/phenotype rules", "Probabilities are theoretical and depend on verified parental genotypes"],
      },
    });
  });

  router.get("/incubators", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    const incubators = await prisma.incubator.findMany({ where: { userId: auth.userId, isActive: true }, orderBy: [{ name: "asc" }] });
    res.status(200).json({ incubators });
  });

  router.post("/incubators", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    const input = parseBody(incubatorSchema, req.body);
    const incubator = await prisma.incubator.create({ data: { userId: auth.userId, name: input.name, identifier: input.identifier ?? null, capacity: input.capacity ?? null, maintenanceIntervalDays: input.maintenanceIntervalDays ?? null, nextMaintenanceAt: input.nextMaintenanceAt ? new Date(input.nextMaintenanceAt) : null, notes: input.notes ?? null } });
    res.status(201).json({ incubator });
  });

  router.patch("/incubators/:id", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    const incubatorId = routeUuid(req.params.id, "incubator id");
    const input = parseBody(patchIncubatorSchema, req.body);
    const existing = await prisma.incubator.findFirst({ where: { id: incubatorId, userId: auth.userId, isActive: true }, select: { id: true, name: true } });
    if (!existing) throw new AppError(404, "INCUBATOR_NOT_FOUND", "Incubator not found");
    const data: Record<string, unknown> = { ...input, ...(input.nextMaintenanceAt !== undefined ? { nextMaintenanceAt: input.nextMaintenanceAt ? new Date(input.nextMaintenanceAt) : null } : {}) };
    const incubator = await prisma.$transaction(async (tx) => {
      const title = "Manutenzione incubatrice · " + incubatorId;
      const reminder = await tx.task.findFirst({ where: { userId: auth.userId, category: "incubator_maintenance", title, status: "open" }, select: { id: true } });
      if (input.maintenanceIntervalDays === null) {
        data.nextMaintenanceAt = null;
        if (reminder) await tx.task.delete({ where: { id: reminder.id } });
      } else if (input.maintenanceIntervalDays !== undefined) {
        const latest = await tx.incubatorMaintenance.findFirst({ where: { incubatorId }, orderBy: [{ occurredAt: "desc" }, { id: "desc" }], select: { occurredAt: true } });
        const dueAt = new Date((latest?.occurredAt ?? new Date()).getTime() + input.maintenanceIntervalDays * 86_400_000);
        data.nextMaintenanceAt = dueAt;
        if (reminder) await tx.task.update({ where: { id: reminder.id }, data: { dueAt, description: "Manutenzione programmata: " + existing.name } });
        else await tx.task.create({ data: { userId: auth.userId, title, category: "incubator_maintenance", dueAt, description: "Manutenzione programmata: " + existing.name } });
      } else if (input.nextMaintenanceAt !== undefined) {
        if (data.nextMaintenanceAt instanceof Date) {
          if (reminder) await tx.task.update({ where: { id: reminder.id }, data: { dueAt: data.nextMaintenanceAt as Date } });
          else await tx.task.create({ data: { userId: auth.userId, title, category: "incubator_maintenance", dueAt: data.nextMaintenanceAt as Date, description: "Manutenzione programmata: " + existing.name } });
        } else if (reminder) await tx.task.delete({ where: { id: reminder.id } });
      }
      return tx.incubator.update({ where: { id: incubatorId }, data: data as never });
    });
    res.status(200).json({ incubator });
  });

  // Deletion is a soft archive: historical clutches keep their incubator relation.
  router.delete("/incubators/:id", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    const incubatorId = routeUuid(req.params.id, "incubator id");
    const result = await prisma.incubator.updateMany({ where: { id: incubatorId, userId: auth.userId, isActive: true }, data: { isActive: false } });
    if (result.count !== 1) throw new AppError(404, "INCUBATOR_NOT_FOUND", "Incubator not found");
    res.status(204).send();
  });

  router.get("/incubators/:id/maintenance", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    const incubatorId = routeUuid(req.params.id, "incubator id");
    const incubator = await prisma.incubator.findFirst({ where: { id: incubatorId, userId: auth.userId }, select: { id: true } });
    if (!incubator) throw new AppError(404, "INCUBATOR_NOT_FOUND", "Incubator not found");
    const maintenance = await prisma.incubatorMaintenance.findMany({ where: { incubatorId }, orderBy: [{ occurredAt: "desc" }, { id: "desc" }], take: 100 });
    res.status(200).json({ maintenance });
  });

  router.post("/incubators/:id/maintenance", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    const incubatorId = routeUuid(req.params.id, "incubator id");
    const incubator = await prisma.incubator.findFirst({ where: { id: incubatorId, userId: auth.userId }, select: { id: true } });
    if (!incubator) throw new AppError(404, "INCUBATOR_NOT_FOUND", "Incubator not found");
    const input = parseBody(incubatorMaintenanceSchema, req.body);
    const maintenance = await prisma.$transaction(async (tx) => {
      const created = await tx.incubatorMaintenance.create({ data: { incubatorId, occurredAt: new Date(input.occurredAt), eventType: input.eventType, notes: input.notes ?? null } });
      const current = await tx.incubator.findUnique({ where: { id: incubatorId }, select: { name: true, maintenanceIntervalDays: true } });
      if (current?.maintenanceIntervalDays) {
        const nextMaintenanceAt = new Date(created.occurredAt.getTime() + current.maintenanceIntervalDays * 86_400_000);
        await tx.incubator.update({ where: { id: incubatorId }, data: { nextMaintenanceAt } });
        const title = "Manutenzione incubatrice · " + incubatorId;
        const reminder = await tx.task.findFirst({ where: { userId: auth.userId, category: "incubator_maintenance", title, status: "open" }, select: { id: true } });
        if (reminder) await tx.task.update({ where: { id: reminder.id }, data: { dueAt: nextMaintenanceAt } });
        else await tx.task.create({ data: { userId: auth.userId, title, category: "incubator_maintenance", dueAt: nextMaintenanceAt, description: "Manutenzione programmata: " + (current.name || incubatorId) } });
      }
      return created;
    });
    res.status(201).json({ maintenance });
  });

  router.get("/eggs/:id/measurements", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    const eggId = routeUuid(req.params.id, "egg id");
    const egg = await prisma.egg.findFirst({ where: { id: eggId, clutch: { is: { cycle: { is: { userId: auth.userId } } } } }, select: { id: true } });
    if (!egg) throw new AppError(404, "EGG_NOT_FOUND", "Egg not found");
    const measurements = await prisma.eggMeasurement.findMany({ where: { eggId }, orderBy: [{ measuredAt: "asc" }, { id: "asc" }] });
    res.status(200).json({ measurements });
  });

  router.post("/eggs/:id/measurements", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    const eggId = routeUuid(req.params.id, "egg id");
    const egg = await prisma.egg.findFirst({ where: { id: eggId, clutch: { is: { cycle: { is: { userId: auth.userId } } } }, status: { notIn: ["hatched", "lost"] } }, select: { id: true } });
    if (!egg) throw new AppError(404, "EGG_NOT_FOUND_OR_CLOSED", "Egg not found or no longer measurable");
    const input = parseBody(eggMeasurementSchema, req.body);
    const measurement = await prisma.eggMeasurement.create({ data: { eggId, measuredAt: new Date(input.measuredAt), weightG: input.weightG, notes: input.notes ?? null } });
    res.status(201).json({ measurement });
  });

  router.patch("/eggs/:id/measurements/:measurementId", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    const eggId = routeUuid(req.params.id, "egg id");
    const measurementId = routeUuid(req.params.measurementId, "measurement id");
    const egg = await prisma.egg.findFirst({ where: { id: eggId, clutch: { is: { cycle: { is: { userId: auth.userId } } } } }, select: { id: true } });
    if (!egg) throw new AppError(404, "EGG_NOT_FOUND", "Egg not found");
    const input = parseBody(patchEggMeasurementSchema, req.body);
    const measurement = await prisma.eggMeasurement.updateMany({
      where: { id: measurementId, eggId },
      data: {
        ...(input.measuredAt !== undefined ? { measuredAt: new Date(input.measuredAt) } : {}),
        ...(input.weightG !== undefined ? { weightG: input.weightG } : {}),
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
      },
    });
    if (measurement.count !== 1) throw new AppError(404, "EGG_MEASUREMENT_NOT_FOUND", "Egg measurement not found");
    const updated = await prisma.eggMeasurement.findUnique({ where: { id: measurementId } });
    res.status(200).json({ measurement: updated });
  });

  router.delete("/eggs/:id/measurements/:measurementId", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    const eggId = routeUuid(req.params.id, "egg id");
    const measurementId = routeUuid(req.params.measurementId, "measurement id");
    const egg = await prisma.egg.findFirst({ where: { id: eggId, clutch: { is: { cycle: { is: { userId: auth.userId } } } } }, select: { id: true } });
    if (!egg) throw new AppError(404, "EGG_NOT_FOUND", "Egg not found");
    const result = await prisma.eggMeasurement.deleteMany({ where: { id: measurementId, eggId } });
    if (result.count !== 1) throw new AppError(404, "EGG_MEASUREMENT_NOT_FOUND", "Egg measurement not found");
    res.status(204).send();
  });

  router.get("/animals/:animalId/hatchling-care", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    const animalId = routeUuid(req.params.animalId, "animal id");
    const animal = await prisma.animal.findFirst({ where: { id: animalId, userId: auth.userId, originOffspringBatchId: { not: null } }, select: { id: true } });
    if (!animal) throw new AppError(404, "HATCHLING_NOT_FOUND", "Hatchling not found");
    const [care, feedings, weights, sheds] = await Promise.all([
      prisma.hatchlingCare.findUnique({ where: { animalId } }),
      prisma.feedingEntry.findMany({ where: { animalId }, orderBy: [{ createdAt: "asc" }], select: { outcome: true, createdAt: true, session: { select: { performedAt: true } } } }),
      prisma.weightMeasurement.findMany({ where: { animalId }, orderBy: [{ measuredAt: "asc" }] }),
      prisma.shedRecord.findMany({ where: { animalId }, orderBy: [{ occurredAt: "asc" }] }),
    ]);
    res.status(200).json({ care, feedingCount: feedings.length, acceptedFeedings: feedings.filter((entry) => entry.outcome === "ate").length, feedings, weights, sheds });
  });

  router.patch("/animals/:animalId/hatchling-care", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    const animalId = routeUuid(req.params.animalId, "animal id");
    const animal = await prisma.animal.findFirst({ where: { id: animalId, userId: auth.userId, originOffspringBatchId: { not: null } }, select: { id: true } });
    if (!animal) throw new AppError(404, "HATCHLING_NOT_FOUND", "Hatchling not found");
    const input = parseBody(hatchlingCareSchema, req.body);
    const data = {
      ...(input.firstFeedingAt !== undefined ? { firstFeedingAt: input.firstFeedingAt ? new Date(input.firstFeedingAt) : null } : {}),
      ...(input.firstFeedingAccepted !== undefined ? { firstFeedingAccepted: input.firstFeedingAccepted } : {}),
      ...(input.firstShedAt !== undefined ? { firstShedAt: input.firstShedAt ? new Date(input.firstShedAt) : null } : {}),
      ...(input.readyForRehomingAt !== undefined ? { readyForRehomingAt: input.readyForRehomingAt ? new Date(input.readyForRehomingAt) : null } : {}),
      ...(input.healthStatus !== undefined ? { healthStatus: input.healthStatus } : {}),
      ...(input.healthNotes !== undefined ? { healthNotes: input.healthNotes } : {}),
      ...(input.notes !== undefined ? { notes: input.notes } : {}),
    };
    const care = await prisma.hatchlingCare.upsert({ where: { animalId }, create: { animalId, ...data }, update: data });
    res.status(200).json({ care });
  });

  router.get("/reproduction-cycles", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    const page = parseBody(z.object({ page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(25), status: reproductionCycleStatusSchema.or(z.literal("all")).default("all") }), req.query);
    const search = typeof req.query.q === "string" ? req.query.q.trim().slice(0, 160) : "";
    const where = {
      userId: auth.userId,
      ...(page.status === "all" ? {} : { status: page.status }),
      ...(search ? { name: { contains: search, mode: "insensitive" as const } } : {}),
    };
    const [total, cycles] = await Promise.all([
      prisma.reproductionCycle.count({ where }),
      prisma.reproductionCycle.findMany({
        where, orderBy: [{ startedOn: "desc" }, { createdAt: "desc" }],
        skip: (page.page - 1) * page.pageSize, take: page.pageSize,
        include: {
          parentA: { select: { id: true, name: true, identifier: true, species: true } },
          parentB: { select: { id: true, name: true, identifier: true, species: true } },
          _count: { select: { events: true, clutches: true, offspringBatches: true } },
        },
      }),
    ]);
    res.status(200).json({ cycles, pagination: { page: page.page, pageSize: page.pageSize, total, totalPages: Math.ceil(total / page.pageSize) } });
  });

  router.post("/reproduction-cycles", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    const input = parseBody(createCycleSchema, req.body);
    await assertOwnedAnimals(auth.userId, [input.parentAAnimalId, input.parentBAnimalId]);
    await assertCycleParentSexes(auth.userId, input.parentAAnimalId, input.parentBAnimalId);
    const cycle = await prisma.$transaction(async (tx) => {
      const created = await tx.reproductionCycle.create({
        data: {
          userId: auth.userId, name: input.name ?? null, startedOn: validDate(input.startedOn),
          endedOn: input.endedOn ? validDate(input.endedOn) : null, status: input.status,
          parentAAnimalId: input.parentAAnimalId ?? null, parentBAnimalId: input.parentBAnimalId ?? null, notes: input.notes ?? null,
        },
      });
      await tx.auditEvent.create({ data: { userId: auth.userId, action: "reproduction_cycle.created", entityType: "reproduction_cycle", entityId: created.id } });
      return created;
    });
    res.status(201).json({ cycle });
  });

  router.get("/reproduction-cycles/:id", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    const cycleId = routeUuid(req.params.id, "cycle id");
    const cycle = await prisma.reproductionCycle.findFirst({
      where: { id: cycleId, userId: auth.userId },
      include: {
        parentA: { select: { id: true, name: true, identifier: true, species: true } },
        parentB: { select: { id: true, name: true, identifier: true, species: true } },
        // Details are deliberately bounded. Full history is available through
        // the paginated child endpoints below.
        events: { orderBy: [{ occurredAt: "desc" }, { id: "desc" }], take: 100, include: { animal: { select: { id: true, name: true } } } },
        clutches: { orderBy: [{ laidOn: "desc" }, { id: "desc" }], take: 100, include: { _count: { select: { eggs: true, incubationLogs: true } } } },
        offspringBatches: { orderBy: [{ bornOn: "desc" }, { id: "desc" }], take: 100 },
        _count: { select: { events: true, clutches: true, offspringBatches: true } },
      },
    });
    if (!cycle) throw new AppError(404, "REPRODUCTION_CYCLE_NOT_FOUND", "Reproduction cycle not found");
    res.status(200).json({ cycle });
  });

  router.get("/reproduction-cycles/:id/clutches", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    const cycleId = routeUuid(req.params.id, "cycle id");
    await ownedCycle(auth.userId, cycleId);
    const query = parseBody(pageSchema, req.query);
    const where = { cycleId, cycle: { is: { userId: auth.userId } } };
    const [total, clutches] = await Promise.all([
      prisma.clutch.count({ where }),
      prisma.clutch.findMany({
        where,
        orderBy: [{ laidOn: "desc" }, { id: "desc" }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: { _count: { select: { eggs: true, incubationLogs: true } } },
      }),
    ]);
    res.status(200).json({
      clutches,
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: Math.ceil(total / query.pageSize),
      },
    });
  });

  router.patch("/reproduction-cycles/:id", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    const cycleId = routeUuid(req.params.id, "cycle id");
    const input = parseBody(patchCycleSchema, req.body);
    const existing = await ownedCycle(auth.userId, cycleId);
    await assertOwnedAnimals(auth.userId, [input.parentAAnimalId, input.parentBAnimalId]);
    const start = input.startedOn ?? existing.startedOn.toISOString().slice(0, 10);
    const end = input.endedOn === undefined ? (existing.endedOn?.toISOString().slice(0, 10) ?? null) : input.endedOn;
    if (end && end < start) throw new AppError(400, "VALIDATION_ERROR", "End date cannot precede start date");
    const parentA = input.parentAAnimalId !== undefined ? input.parentAAnimalId : existing.parentAAnimalId;
    const parentB = input.parentBAnimalId !== undefined ? input.parentBAnimalId : existing.parentBAnimalId;
    if (parentA && parentA === parentB) {
      throw new AppError(400, "VALIDATION_ERROR", "Parents must be different animals");
    }
    await assertCycleParentSexes(auth.userId, parentA, parentB);
    const data: Record<string, unknown> = { ...input };
    if (input.startedOn) data.startedOn = validDate(input.startedOn);
    if (input.endedOn !== undefined) data.endedOn = input.endedOn ? validDate(input.endedOn) : null;
    const parentsChanged = parentA !== existing.parentAAnimalId || parentB !== existing.parentBAnimalId;
    if (parentsChanged) {
      const batchRows = await prisma.offspringBatch.findMany({ where: { cycleId }, select: { id: true } });
      if (batchRows.length) {
        const offspringParent = await prisma.animal.findFirst({
          where: { userId: auth.userId, id: { in: [parentA, parentB].filter((id): id is string => Boolean(id)) }, originOffspringBatchId: { in: batchRows.map((batch) => batch.id) } },
          select: { id: true },
        });
        if (offspringParent) throw new AppError(400, "CYCLE_PARENT_IS_OFFSPRING", "A cycle parent cannot be an offspring of the same cycle");
      }
    }
    const cycle = await prisma.$transaction(async (tx) => {
      const updated = await tx.reproductionCycle.update({ where: { id: cycleId }, data: data as never });
      if (parentsChanged) {
        const batches = await tx.offspringBatch.findMany({ where: { cycleId }, select: { id: true } });
        if (batches.length) {
          const offspringScope = { userId: auth.userId, originOffspringBatchId: { in: batches.map((batch) => batch.id) } };
          await tx.animal.updateMany({
            where: { ...offspringScope, OR: [{ motherAnimalId: existing.parentAAnimalId }, { motherAnimalId: null }] },
            data: { motherAnimalId: parentA ?? null },
          });
          await tx.animal.updateMany({
            where: { ...offspringScope, OR: [{ fatherAnimalId: existing.parentBAnimalId }, { fatherAnimalId: null }] },
            data: { fatherAnimalId: parentB ?? null },
          });
        }
      }
      return updated;
    });
    res.status(200).json({ cycle });
  });

  router.get("/reproduction-cycles/:id/events", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    const cycleId = routeUuid(req.params.id, "cycle id");
    await ownedCycle(auth.userId, cycleId);
    const query = parseBody(pageSchema, req.query);
    const where = { cycleId, cycle: { is: { userId: auth.userId } } };
    const [total, events] = await Promise.all([
      prisma.reproductiveEvent.count({ where }),
      prisma.reproductiveEvent.findMany({
        where,
        orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: { animal: { select: { id: true, name: true } } },
      }),
    ]);
    res.status(200).json({ events, pagination: { page: query.page, pageSize: query.pageSize, total, totalPages: Math.ceil(total / query.pageSize) } });
  });

  router.post("/reproduction-cycles/:id/events", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    const cycleId = routeUuid(req.params.id, "cycle id");
    await ownedCycle(auth.userId, cycleId);
    const input = parseBody(createEventSchema, req.body);
    await assertOwnedAnimals(auth.userId, [input.animalId]);
    const event = await prisma.$transaction(async (tx) => {
      const created = await tx.reproductiveEvent.create({
        data: {
          cycleId, eventType: input.eventType, occurredAt: new Date(input.occurredAt), animalId: input.animalId ?? null,
          details: input.details ?? null, temperatureC: input.temperatureC ?? null, humidityPct: input.humidityPct ?? null,
        },
      });
      await tx.auditEvent.create({ data: { userId: auth.userId, action: "reproductive_event.created", entityType: "reproductive_event", entityId: created.id } });
      return created;
    });
    res.status(201).json({ event });
  });

  router.post("/clutches", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    const input = parseBody(createClutchSchema, req.body);
    await ownedCycle(auth.userId, input.cycleId);
    if (input.incubatorId) {
      const incubator = await prisma.incubator.findFirst({ where: { id: input.incubatorId, userId: auth.userId, isActive: true }, select: { id: true } });
      if (!incubator) throw new AppError(404, "INCUBATOR_NOT_FOUND", "Incubator not found");
    }
    const clutch = await prisma.$transaction(async (tx) => {
      const created = await tx.clutch.create({
        data: {
          cycleId: input.cycleId, laidOn: validDate(input.laidOn), eggCount: input.eggCount, status: input.status,
          incubatorLabel: input.incubatorLabel ?? null, incubatorId: input.incubatorId ?? null, incubationStartedAt: input.incubationStartedAt ? new Date(input.incubationStartedAt) : null,
          targetTemperatureMinC: input.targetTemperatureMinC ?? null, targetTemperatureMaxC: input.targetTemperatureMaxC ?? null,
          targetHumidityMinPct: input.targetHumidityMinPct ?? null, targetHumidityMaxPct: input.targetHumidityMaxPct ?? null,
          checkIntervalHours: input.checkIntervalHours ?? null, notes: input.notes ?? null,
        },
      });
      await tx.clutchHistory.create({ data: { clutchId: created.id, action: "clutch.created", details: { laidOn: input.laidOn, eggCount: input.eggCount, incubatorId: input.incubatorId ?? null }, notes: "Covata creata" } });
      await tx.auditEvent.create({ data: { userId: auth.userId, action: "clutch.created", entityType: "clutch", entityId: created.id } });
      return created;
    });
    res.status(201).json({ clutch });
  });

  router.get("/clutches/:id", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    const clutchId = routeUuid(req.params.id, "clutch id");
    const clutch = await prisma.clutch.findFirst({
      where: { id: clutchId, cycle: { is: { userId: auth.userId } } },
      include: {
        cycle: { select: { id: true, name: true, status: true } },
        eggs: { orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: 100, include: { currentIncubator: { select: { id: true, name: true, identifier: true } }, offspringAnimal: { select: { id: true, name: true, identifier: true, species: true } }, history: { orderBy: [{ occurredAt: "asc" }, { id: "asc" }] } } },
        incubationLogs: { orderBy: [{ recordedAt: "desc" }, { id: "desc" }], take: 100 },
        history: { orderBy: [{ occurredAt: "desc" }, { id: "desc" }], take: 100 },
        _count: { select: { eggs: true, incubationLogs: true } },
      },
    });
    if (!clutch) throw new AppError(404, "CLUTCH_NOT_FOUND", "Clutch not found");
    const temperatureRange = [
      ...(clutch.targetTemperatureMinC !== null ? [{ temperatureC: { lt: clutch.targetTemperatureMinC } }] : []),
      ...(clutch.targetTemperatureMaxC !== null ? [{ temperatureC: { gt: clutch.targetTemperatureMaxC } }] : []),
    ];
    const humidityRange = [
      ...(clutch.targetHumidityMinPct !== null ? [{ humidityPct: { lt: clutch.targetHumidityMinPct } }] : []),
      ...(clutch.targetHumidityMaxPct !== null ? [{ humidityPct: { gt: clutch.targetHumidityMaxPct } }] : []),
    ];
    const [monitoringAggregate, temperatureOutOfRange, humidityOutOfRange, lastLog, eggStatusGroups, hatchedEggDates] = await Promise.all([
      prisma.incubationLog.aggregate({ where: { clutchId }, _avg: { temperatureC: true, humidityPct: true } }),
      temperatureRange.length ? prisma.incubationLog.count({ where: { clutchId, OR: temperatureRange } }) : Promise.resolve(0),
      humidityRange.length ? prisma.incubationLog.count({ where: { clutchId, OR: humidityRange } }) : Promise.resolve(0),
      prisma.incubationLog.findFirst({ where: { clutchId }, orderBy: [{ recordedAt: "desc" }, { id: "desc" }], select: { recordedAt: true } }),
      prisma.egg.groupBy({ by: ["status"], where: { clutchId }, _count: { _all: true } }),
      prisma.egg.findMany({ where: { clutchId, hatchedAt: { not: null } }, select: { laidAt: true, hatchedAt: true } }),
    ]);
    const lastCheckAt = lastLog?.recordedAt.toISOString() ?? null;
    const nextCheckDueAt = lastCheckAt && clutch.checkIntervalHours
      ? new Date(new Date(lastCheckAt).getTime() + clutch.checkIntervalHours * 60 * 60 * 1000).toISOString()
      : null;
    const eggCounts = Object.fromEntries(eggStatusGroups.map((item) => [item.status, item._count._all]));
    const registeredEggCount = eggStatusGroups.reduce((sum, item) => sum + item._count._all, 0);
    const hatchedCount = eggCounts.hatched ?? 0;
    const incubationDurationsDays = hatchedEggDates.flatMap((egg) => egg.laidAt && egg.hatchedAt
      ? [Math.max(0, Math.floor((egg.hatchedAt.getTime() - egg.laidAt.getTime()) / 86_400_000))]
      : []);
    const averageIncubationDays = incubationDurationsDays.length
      ? incubationDurationsDays.reduce((sum, days) => sum + days, 0) / incubationDurationsDays.length
      : null;
    res.status(200).json({ clutch: { ...clutch, eggs: clutch.eggs.map(serializeEgg), eggSummary: {
      registered: registeredEggCount,
      declared: clutch.eggCount,
      unregisteredDeclared: Math.max(0, clutch.eggCount - registeredEggCount),
      byStatus: eggCounts,
      hatchRatePct: registeredEggCount ? Number(((hatchedCount / registeredEggCount) * 100).toFixed(2)) : null,
      averageIncubationDays: averageIncubationDays === null ? null : Number(averageIncubationDays.toFixed(1)),
    }, monitoring: {
      temperatureOutOfRange, humidityOutOfRange, lastCheckAt, nextCheckDueAt,
      averageTemperatureC: monitoringAggregate._avg.temperatureC === null ? null : Number(monitoringAggregate._avg.temperatureC),
      averageHumidityPct: monitoringAggregate._avg.humidityPct === null ? null : Number(monitoringAggregate._avg.humidityPct),
    } } });
  });

  router.patch("/clutches/:id", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    const clutchId = routeUuid(req.params.id, "clutch id");
    const existingClutch = await ownedClutch(auth.userId, clutchId);
    const input = parseBody(patchClutchSchema, req.body);
    if (input.incubatorId) {
      const incubator = await prisma.incubator.findFirst({ where: { id: input.incubatorId, userId: auth.userId, isActive: true }, select: { id: true } });
      if (!incubator) throw new AppError(404, "INCUBATOR_NOT_FOUND", "Incubator not found");
    }
    const data: Record<string, unknown> = { ...input };
    if (input.laidOn) data.laidOn = validDate(input.laidOn);
    if (input.incubationStartedAt !== undefined) data.incubationStartedAt = input.incubationStartedAt ? new Date(input.incubationStartedAt) : null;
    const clutch = await prisma.$transaction(async (tx) => {
      if (input.eggCount !== undefined) {
        const registeredEggs = await tx.egg.count({ where: { clutchId } });
        if (input.eggCount < registeredEggs) {
          throw new AppError(409, "CLUTCH_EGG_COUNT_BELOW_REGISTERED", "Declared egg count cannot be lower than the number of registered eggs", {
            declaredCount: input.eggCount, registeredCount: registeredEggs,
          });
        }
      }
      const updated = await tx.clutch.update({ where: { id: clutchId }, data: data as never });
      if (input.incubatorId !== undefined && input.incubatorId !== existingClutch.incubatorId) {
        const clutchEggs = await tx.egg.findMany({
          where: { clutchId, OR: [{ incubatorId: existingClutch.incubatorId }, { incubatorId: null }] },
          select: { id: true, incubatorId: true, incubatorPosition: true },
        });
        for (const egg of clutchEggs) {
          await tx.egg.update({ where: { id: egg.id }, data: {
            incubatorId: input.incubatorId,
            incubatorPosition: input.incubatorId ? egg.incubatorPosition : null,
          } });
          await tx.eggIncubatorTransfer.create({ data: {
            eggId: egg.id,
            fromIncubatorId: egg.incubatorId,
            toIncubatorId: input.incubatorId,
            fromPosition: egg.incubatorPosition,
            toPosition: input.incubatorId ? egg.incubatorPosition : null,
            notes: "Trasferimento dovuto alla modifica dell'incubatrice della covata",
          } });
        }
      }
      await tx.clutchHistory.create({ data: {
        clutchId,
        action: "clutch.updated",
        details: input as never,
        notes: "Dati della covata aggiornati",
      } });
      const lastLog = await tx.incubationLog.findFirst({ where: { clutchId }, orderBy: [{ recordedAt: "desc" }, { id: "desc" }] });
      const title = "Controllo incubazione · " + clutchId;
      const reminder = await tx.task.findFirst({ where: { userId: auth.userId, category: "incubation", title, status: "open" }, select: { id: true } });
      if (updated.checkIntervalHours && lastLog) {
        const dueAt = new Date(lastLog.recordedAt.getTime() + updated.checkIntervalHours * 60 * 60 * 1000);
        if (reminder) await tx.task.update({ where: { id: reminder.id }, data: { dueAt } });
        else await tx.task.create({ data: { userId: auth.userId, title, category: "incubation", dueAt, description: "Controllo programmato per la covata " + (updated.incubatorLabel || clutchId) } });
      } else if (reminder) await tx.task.delete({ where: { id: reminder.id } });
      return updated;
    }, { isolationLevel: "Serializable" });
    res.status(200).json({ clutch });
  });

  router.get("/clutches/:id/eggs", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    const clutchId = routeUuid(req.params.id, "clutch id");
    await ownedClutch(auth.userId, clutchId);
    const query = parseBody(pageSchema, req.query);
    const where = { clutchId };
    const [total, eggs] = await Promise.all([
      prisma.egg.count({ where }),
      prisma.egg.findMany({
        where,
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: {
          currentIncubator: { select: { id: true, name: true, identifier: true } },
          offspringAnimal: { select: { id: true, name: true, identifier: true, species: true } },
          history: { orderBy: [{ occurredAt: "asc" }, { id: "asc" }] },
          measurements: { orderBy: [{ measuredAt: "asc" }, { id: "asc" }] },
        },
      }),
    ]);
    res.status(200).json({ eggs: eggs.map(serializeEgg), pagination: { page: query.page, pageSize: query.pageSize, total, totalPages: Math.ceil(total / query.pageSize) } });
  });

  router.post("/clutches/:id/eggs", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    const clutchId = routeUuid(req.params.id, "clutch id");
    const clutch = await ownedClutch(auth.userId, clutchId);
    const input = parseBody(z.object({ eggs: z.array(eggSchema).min(1).max(1000) }).strict(), req.body);
    const codes = input.eggs.map((egg) => egg.code?.trim().toLocaleLowerCase("it-IT")).filter((code): code is string => Boolean(code));
    if (new Set(codes).size !== codes.length) throw new AppError(400, "DUPLICATE_EGG_CODES", "Egg codes must be unique within the request");
    const eggs = await prisma.$transaction(async (tx) => {
      const currentClutch = await tx.clutch.findUnique({ where: { id: clutchId }, select: { eggCount: true } });
      if (!currentClutch) throw new AppError(404, "CLUTCH_NOT_FOUND", "Clutch not found");
      const registeredEggs = await tx.egg.count({ where: { clutchId } });
      if (registeredEggs + input.eggs.length > currentClutch.eggCount) {
        throw new AppError(409, "CLUTCH_EGG_COUNT_EXCEEDED", "Registered eggs cannot exceed the declared clutch egg count", {
          declaredCount: currentClutch.eggCount, registeredCount: registeredEggs, requestedCount: input.eggs.length,
        });
      }
      const results = [];
      for (const egg of input.eggs) {
        const created = await tx.egg.create({ data: { clutchId, code: egg.code ?? null, status: egg.status, laidAt: egg.laidAt ? new Date(egg.laidAt) : null, expectedHatchAt: egg.expectedHatchAt ? validDate(egg.expectedHatchAt) : null, hatchedAt: egg.hatchedAt ? validDate(egg.hatchedAt) : null, incubatorId: clutch.incubatorId, notes: egg.notes ?? null } });
        await tx.eggHistory.create({ data: { eggId: created.id, status: created.status, notes: created.notes } });
        if (clutch.incubatorId) await tx.eggIncubatorTransfer.create({ data: { eggId: created.id, toIncubatorId: clutch.incubatorId, notes: "Assegnazione iniziale dall'incubatrice della covata" } });
        results.push(created);
      }
      await tx.clutchHistory.create({ data: { clutchId, action: "eggs.created", details: { count: results.length }, notes: "Uova registrate nella covata" } });
      await tx.auditEvent.create({ data: { userId: auth.userId, action: "egg.created", entityType: "egg", metadata: { count: results.length } } });
      return results;
    }, { isolationLevel: "Serializable" });
    res.status(201).json({ eggs: eggs.map(serializeEgg), createdCount: eggs.length });
  });

  router.patch("/eggs/:id", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    const eggId = routeUuid(req.params.id, "egg id");
    const input = parseBody(patchEggSchema, req.body);
    const existing = await prisma.egg.findFirst({ where: { id: eggId, clutch: { is: { cycle: { is: { userId: auth.userId } } } } } });
    if (!existing) throw new AppError(404, "EGG_NOT_FOUND", "Egg not found");
    if (existing.offspringAnimalId && input.status && input.status !== "hatched" && input.offspringAnimalId === undefined) {
      throw new AppError(400, "EGG_HATCHLING_LINKED", "Unlink the hatchling before changing a hatched egg to another status");
    }
    if (input.offspringAnimalId) {
      const linkedAnimal = await prisma.animal.findFirst({ where: { id: input.offspringAnimalId, userId: auth.userId, originClutchId: existing.clutchId }, select: { id: true } });
      if (!linkedAnimal) throw new AppError(400, "HATCHLING_CLUTCH_MISMATCH", "The linked animal must have been created from this clutch");
      if (input.status && input.status !== "hatched") throw new AppError(400, "EGG_HATCH_STATUS_REQUIRED", "An egg linked to a hatchling must have hatched status");
    }
    if (input.status === "hatched" && !input.hatchedAt && !existing.hatchedAt) throw new AppError(400, "HATCH_DATE_REQUIRED", "A hatch date is required when marking an egg as hatched");
    const data: Record<string, unknown> = { ...input };
    const nextIncubatorId = input.incubatorId !== undefined ? input.incubatorId : existing.incubatorId;
    const nextIncubatorPosition = input.incubatorPosition !== undefined ? input.incubatorPosition : existing.incubatorPosition;
    if (input.incubatorId) {
      const incubator = await prisma.incubator.findFirst({ where: { id: input.incubatorId, userId: auth.userId, isActive: true }, select: { id: true } });
      if (!incubator) throw new AppError(404, "INCUBATOR_NOT_FOUND", "Incubator not found");
    }
    if (!nextIncubatorId && nextIncubatorPosition) throw new AppError(400, "EGG_POSITION_REQUIRES_INCUBATOR", "An egg position requires an incubator");
    if (input.incubatorId !== undefined) data.incubatorId = input.incubatorId;
    if (input.incubatorPosition !== undefined || (input.incubatorId === null && existing.incubatorId)) data.incubatorPosition = nextIncubatorId ? nextIncubatorPosition : null;
    if (input.hatchedAt !== undefined) data.hatchedAt = input.hatchedAt ? validDate(input.hatchedAt) : null;
    if (input.laidAt !== undefined) data.laidAt = input.laidAt ? new Date(input.laidAt) : null;
    if (input.expectedHatchAt !== undefined) data.expectedHatchAt = input.expectedHatchAt ? validDate(input.expectedHatchAt) : null;
    if (input.offspringAnimalId) {
      data.status = "hatched";
      if (input.hatchedAt === undefined && !existing.hatchedAt) data.hatchedAt = new Date();
    }
    if (input.status === "hatched" && input.hatchedAt === undefined && !existing.hatchedAt) data.hatchedAt = new Date();
    const historyNotes = [
      input.code !== undefined ? "Codice aggiornato" : null,
      input.laidAt !== undefined ? "Data di deposizione aggiornata" : null,
      input.expectedHatchAt !== undefined ? "Data prevista di schiusa aggiornata" : null,
      input.hatchedAt !== undefined ? "Data di schiusa aggiornata" : null,
      input.offspringAnimalId !== undefined ? "Collegamento al piccolo aggiornato" : null,
      input.notes !== undefined && input.notes !== existing.notes ? "Note aggiornate" : null,
    ].filter((value): value is string => Boolean(value));
    const egg = await prisma.$transaction(async (tx) => {
      const updated = await tx.egg.update({ where: { id: eggId }, data: data as never });
      if (existing.incubatorId !== updated.incubatorId || existing.incubatorPosition !== updated.incubatorPosition) {
        await tx.eggIncubatorTransfer.create({ data: {
          eggId,
          fromIncubatorId: existing.incubatorId,
          toIncubatorId: updated.incubatorId,
          fromPosition: existing.incubatorPosition,
          toPosition: updated.incubatorPosition,
          transferredAt: new Date(),
          notes: "Posizione di incubazione aggiornata",
        } });
      }
      const resultingStatus = input.status ?? (input.offspringAnimalId ? "hatched" : existing.status);
      if (resultingStatus !== existing.status || historyNotes.length > 0) {
        await tx.eggHistory.create({ data: { eggId, status: resultingStatus, notes: historyNotes.join("; ") || input.notes || existing.notes } });
      }
      if (resultingStatus !== existing.status) {
        await tx.clutchHistory.create({ data: {
          clutchId: existing.clutchId,
          action: "egg.status.changed",
          details: { eggId, from: existing.status, to: resultingStatus },
          notes: "Stato di un uovo aggiornato",
        } });
      }
      await tx.auditEvent.create({ data: { userId: auth.userId, action: "egg.updated", entityType: "egg", entityId: eggId } });
      return updated;
    });
    res.status(200).json({ egg: serializeEgg(egg) });
  });

  router.get("/eggs/:id/incubator-transfers", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    const eggId = routeUuid(req.params.id, "egg id");
    const egg = await prisma.egg.findFirst({ where: { id: eggId, clutch: { is: { cycle: { is: { userId: auth.userId } } } } }, select: { id: true } });
    if (!egg) throw new AppError(404, "EGG_NOT_FOUND", "Egg not found");
    const transfers = await prisma.eggIncubatorTransfer.findMany({
      where: { eggId },
      orderBy: [{ transferredAt: "desc" }, { id: "desc" }],
      include: { fromIncubator: { select: { id: true, name: true, identifier: true } }, toIncubator: { select: { id: true, name: true, identifier: true } } },
      take: 100,
    });
    res.status(200).json({ transfers });
  });

  router.get("/clutches/:id/incubation-logs", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    const clutchId = routeUuid(req.params.id, "clutch id");
    await ownedClutch(auth.userId, clutchId);
    const query = parseBody(pageSchema, req.query);
    const where = { clutchId };
    const [total, logs] = await Promise.all([
      prisma.incubationLog.count({ where }),
      prisma.incubationLog.findMany({
        where,
        orderBy: [{ recordedAt: "desc" }, { id: "desc" }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    res.status(200).json({ logs, pagination: { page: query.page, pageSize: query.pageSize, total, totalPages: Math.ceil(total / query.pageSize) } });
  });

  router.post("/clutches/:id/incubation-logs", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    const clutchId = routeUuid(req.params.id, "clutch id");
    await ownedClutch(auth.userId, clutchId);
    const input = parseBody(incubationSchema, req.body);
    const log = await prisma.$transaction(async (tx) => {
      const created = await tx.incubationLog.create({
        data: {
          clutchId, recordedAt: new Date(input.recordedAt), temperatureC: input.temperatureC ?? null,
          humidityPct: input.humidityPct ?? null, eventType: input.eventType, notes: input.notes ?? null,
        },
      });
      await tx.clutchHistory.create({ data: {
        clutchId,
        action: "incubation.log.created",
        details: { logId: created.id, temperatureC: input.temperatureC ?? null, humidityPct: input.humidityPct ?? null, eventType: input.eventType },
        notes: input.notes ?? null,
      } });
      const clutch = await tx.clutch.findUnique({ where: { id: clutchId }, include: { cycle: { select: { userId: true } } } });
      if (clutch?.checkIntervalHours) {
        const title = "Controllo incubazione · " + clutchId;
        const dueAt = new Date(created.recordedAt.getTime() + clutch.checkIntervalHours * 60 * 60 * 1000);
        const reminder = await tx.task.findFirst({ where: { userId: auth.userId, category: "incubation", title, status: "open" }, select: { id: true } });
        if (reminder) await tx.task.update({ where: { id: reminder.id }, data: { dueAt } });
        else await tx.task.create({ data: { userId: auth.userId, title, category: "incubation", dueAt, description: "Controllo programmato per la covata " + (clutch.incubatorLabel || clutchId) } });
      }
      return created;
    });
    res.status(201).json({ log });
  });

  router.get("/offspring-batches", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    const query = parseBody(pageSchema.extend({ cycleId: z.string().uuid().optional() }), req.query);
    if (query.cycleId) await ownedCycle(auth.userId, query.cycleId);
    const where = {
      cycle: { is: { userId: auth.userId } },
      ...(query.cycleId ? { cycleId: query.cycleId } : {}),
    };
    const [total, batches] = await Promise.all([
      prisma.offspringBatch.count({ where }),
      prisma.offspringBatch.findMany({
        where,
        orderBy: [{ bornOn: "desc" }, { id: "desc" }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: { cycle: { select: { id: true, name: true } }, clutch: { select: { id: true, laidOn: true, eggCount: true } }, _count: { select: { originAnimals: true } } },
      }),
    ]);
    res.status(200).json({ offspringBatches: batches, pagination: { page: query.page, pageSize: query.pageSize, total, totalPages: Math.ceil(total / query.pageSize) } });
  });

  router.post("/offspring-batches", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    const input = parseBody(offspringSchema, req.body);
    await ownedCycle(auth.userId, input.cycleId);
    if (input.clutchId) {
      const clutch = await ownedClutch(auth.userId, input.clutchId);
      if (clutch.cycleId !== input.cycleId) throw new AppError(400, "CLUTCH_CYCLE_MISMATCH", "Clutch and offspring batch must belong to the same cycle");
    }
    const batch = await prisma.offspringBatch.create({
      data: { cycleId: input.cycleId, clutchId: input.clutchId ?? null, bornOn: validDate(input.bornOn), count: input.count, notes: input.notes ?? null },
    });
    res.status(201).json({ offspringBatch: batch });
  });

  router.post("/offspring-batches/:id/animals", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    const batchId = routeUuid(req.params.id, "offspring batch id");
    const batch = await prisma.offspringBatch.findFirst({ where: { id: batchId, cycle: { is: { userId: auth.userId } } }, include: { cycle: { include: { parentA: { select: { id: true, name: true, sex: true } }, parentB: { select: { id: true, name: true, sex: true } } } } } });
    if (!batch) throw new AppError(404, "OFFSPRING_BATCH_NOT_FOUND", "Offspring batch not found");
    const input = parseBody(z.object({ animals: z.array(newAnimalSchema).min(1).max(500) }).strict(), req.body);
    const identifiers = input.animals.map((animal) => animal.identifier?.toLocaleLowerCase("it-IT")).filter((v): v is string => Boolean(v));
    if (new Set(identifiers).size !== identifiers.length) throw new AppError(400, "DUPLICATE_IDENTIFIERS", "Identifiers must be unique in this request");
    const eggIds = input.animals.map((animal) => animal.eggId).filter((value): value is string => Boolean(value));
    if (new Set(eggIds).size !== eggIds.length) throw new AppError(400, "DUPLICATE_EGG_LINKS", "Each egg can be linked to only one hatchling in this conversion");
    if (eggIds.length && !batch.clutchId) throw new AppError(400, "EGG_CLUTCH_REQUIRED", "This offspring batch is not linked to a clutch");
    if (eggIds.length) {
      const eggs = await prisma.egg.findMany({ where: { id: { in: eggIds }, clutchId: batch.clutchId! }, select: { id: true, offspringAnimalId: true } });
      if (eggs.length !== eggIds.length) throw new AppError(400, "EGG_CLUTCH_MISMATCH", "Selected eggs must belong to the offspring batch clutch");
      if (eggs.some((egg) => egg.offspringAnimalId)) throw new AppError(409, "EGG_ALREADY_LINKED", "One or more eggs are already linked to an animal");
    }
    const created = await prisma.$transaction(async (tx) => {
      const currentBatch = await tx.offspringBatch.findUnique({ where: { id: batchId }, select: { count: true } });
      if (!currentBatch) throw new AppError(404, "OFFSPRING_BATCH_NOT_FOUND", "Offspring batch not found");
      const existingAnimals = await tx.animal.count({ where: { userId: auth.userId, originOffspringBatchId: batchId } });
      // Conversion is a single atomic operation per batch. This prevents a retried
      // request from creating duplicate hatchlings when the client loses the response.
      if (existingAnimals > 0) {
        throw new AppError(409, "OFFSPRING_BATCH_ALREADY_CONVERTED", "This offspring batch already has animal records; edit the existing animals instead of converting it again", {
          registeredCount: existingAnimals,
          declaredCount: currentBatch.count,
        });
      }
      if (input.animals.length > currentBatch.count) {
        throw new AppError(409, "OFFSPRING_COUNT_EXCEEDED", "Animal records cannot exceed the declared offspring count", {
          declaredCount: currentBatch.count, registeredCount: existingAnimals, requestedCount: input.animals.length,
        });
      }
      await assertAnimalCapacity(tx, auth.userId, input.animals.length);
      const animals = [];
      for (const animal of input.animals) {
        await assertOwnedAnimals(auth.userId, [animal.motherAnimalId, animal.fatherAnimalId]);
        await assertCycleParentSexes(auth.userId, animal.motherAnimalId ?? batch.cycle.parentAAnimalId, animal.fatherAnimalId ?? batch.cycle.parentBAnimalId);
        const createdAnimal = await tx.animal.create({
          data: {
            userId: auth.userId, originOffspringBatchId: batchId, name: animal.name,
            identifier: animal.identifier ?? null, species: animal.species, sex: animal.sex, morph: animal.morph ?? null,
            birthDate: animal.birthDate ? validDate(animal.birthDate) : batch.bornOn,
            birthDateEstimated: animal.birthDateEstimated ?? false,
            geneticsNotes: animal.geneticsNotes ?? null, notes: animal.notes ?? null,
            locationLabel: animal.locationLabel ?? null, originDescription: animal.originDescription ?? null,
            acquiredDate: animal.acquiredDate ? validDate(animal.acquiredDate) : null,
            motherAnimalId: animal.motherAnimalId ?? batch.cycle.parentAAnimalId,
            fatherAnimalId: animal.fatherAnimalId ?? batch.cycle.parentBAnimalId,
            originClutchId: batch.clutchId,
          },
        });
        animals.push(createdAnimal);
        if (animal.eggId) {
          if (!batch.clutchId) throw new AppError(400, "EGG_CLUTCH_REQUIRED", "This offspring batch is not linked to a clutch");
          const egg = await tx.egg.findFirst({ where: { id: animal.eggId, clutchId: batch.clutchId, offspringAnimalId: null } });
          if (!egg) throw new AppError(409, "EGG_ALREADY_LINKED", "The selected egg is no longer available");
          await tx.egg.update({ where: { id: egg.id }, data: { status: "hatched", hatchedAt: animal.birthDate ? validDate(animal.birthDate) : batch.bornOn, offspringAnimalId: createdAnimal.id } });
          await tx.eggHistory.create({ data: { eggId: egg.id, status: "hatched", notes: "Hatchling linked during offspring conversion" } });
        }
      }
      return animals;
    }, { isolationLevel: "Serializable" });
    res.status(201).json({ animals: created, createdCount: created.length, batchId });
  });


  router.patch("/reproductive-events/:id", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    const eventId = routeUuid(req.params.id, "reproductive event id");
    const input = parseBody(patchEventSchema, req.body);
    const existing = await prisma.reproductiveEvent.findFirst({
      where: { id: eventId, cycle: { is: { userId: auth.userId } } },
    });
    if (!existing) throw new AppError(404, "REPRODUCTIVE_EVENT_NOT_FOUND", "Reproductive event not found");
    if (input.animalId !== undefined) await assertOwnedAnimals(auth.userId, [input.animalId]);
    const data: Record<string, unknown> = { ...input };
    if (input.occurredAt) data.occurredAt = new Date(input.occurredAt);
    const event = await prisma.$transaction(async (tx) => {
      const updated = await tx.reproductiveEvent.update({ where: { id: eventId }, data: data as never });
      await tx.auditEvent.create({ data: { userId: auth.userId, action: "reproductive_event.updated", entityType: "reproductive_event", entityId: eventId } });
      return updated;
    });
    res.status(200).json({ event });
  });

  router.delete("/reproductive-events/:id", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    const eventId = routeUuid(req.params.id, "reproductive event id");
    const existing = await prisma.reproductiveEvent.findFirst({
      where: { id: eventId, cycle: { is: { userId: auth.userId } } },
      select: { id: true },
    });
    if (!existing) throw new AppError(404, "REPRODUCTIVE_EVENT_NOT_FOUND", "Reproductive event not found");
    await prisma.$transaction(async (tx) => {
      await tx.reproductiveEvent.delete({ where: { id: eventId } });
      await tx.auditEvent.create({ data: { userId: auth.userId, action: "reproductive_event.deleted", entityType: "reproductive_event", entityId: eventId } });
    });
    res.status(204).send();
  });

  router.patch("/incubation-logs/:id", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    const logId = routeUuid(req.params.id, "incubation log id");
    const input = parseBody(z.object({
      recordedAt: z.string().datetime({ offset: true }).optional(),
      temperatureC: z.coerce.number().min(-100).max(100).nullable().optional(),
      humidityPct: z.coerce.number().min(0).max(100).nullable().optional(),
      eventType: z.string().trim().min(1).max(24).optional(),
      notes: z.string().trim().max(10_000).nullable().optional(),
    }).strict().refine((v) => Object.keys(v).length > 0, "At least one field is required"), req.body);
    const existing = await prisma.incubationLog.findFirst({
      where: { id: logId, clutch: { is: { cycle: { is: { userId: auth.userId } } } } },
      select: { id: true, clutchId: true, recordedAt: true, temperatureC: true, humidityPct: true, eventType: true, notes: true },
    });
    if (!existing) throw new AppError(404, "INCUBATION_LOG_NOT_FOUND", "Incubation log not found");
    const data: Record<string, unknown> = { ...input };
    if (input.recordedAt) data.recordedAt = new Date(input.recordedAt);
    const log = await prisma.$transaction(async (tx) => {
      const updated = await tx.incubationLog.update({ where: { id: logId }, data: data as never });
      await tx.clutchHistory.create({ data: {
        clutchId: existing.clutchId,
        action: "incubation.log.updated",
        details: {
          logId,
          before: { recordedAt: existing.recordedAt.toISOString(), temperatureC: existing.temperatureC?.toString() ?? null, humidityPct: existing.humidityPct?.toString() ?? null, eventType: existing.eventType, notes: existing.notes },
          after: { recordedAt: updated.recordedAt.toISOString(), temperatureC: updated.temperatureC?.toString() ?? null, humidityPct: updated.humidityPct?.toString() ?? null, eventType: updated.eventType, notes: updated.notes },
        },
        notes: "Registrazione di incubazione modificata",
      } });
      const clutch = await tx.clutch.findUnique({ where: { id: existing.clutchId }, include: { incubationLogs: { orderBy: [{ recordedAt: "desc" }, { id: "desc" }], take: 1 } } });
      if (clutch) {
        const title = "Controllo incubazione · " + clutch.id;
        const lastLog = clutch.incubationLogs[0];
        const reminder = await tx.task.findFirst({ where: { userId: auth.userId, category: "incubation", title, status: "open" }, select: { id: true } });
        if (clutch.checkIntervalHours && lastLog) {
          const dueAt = new Date(lastLog.recordedAt.getTime() + clutch.checkIntervalHours * 60 * 60 * 1000);
          if (reminder) await tx.task.update({ where: { id: reminder.id }, data: { dueAt } });
          else await tx.task.create({ data: { userId: auth.userId, title, category: "incubation", dueAt, description: "Controllo programmato per la covata " + (clutch.incubatorLabel || clutch.id) } });
        } else if (reminder) await tx.task.delete({ where: { id: reminder.id } });
      }
      await tx.auditEvent.create({ data: { userId: auth.userId, action: "incubation_log.updated", entityType: "incubation_log", entityId: logId } });
      return updated;
    });
    res.status(200).json({ log });
  });

  router.delete("/incubation-logs/:id", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    const logId = routeUuid(req.params.id, "incubation log id");
    const existing = await prisma.incubationLog.findFirst({
      where: { id: logId, clutch: { is: { cycle: { is: { userId: auth.userId } } } } },
      select: { id: true, clutchId: true, recordedAt: true, temperatureC: true, humidityPct: true, eventType: true, notes: true },
    });
    if (!existing) throw new AppError(404, "INCUBATION_LOG_NOT_FOUND", "Incubation log not found");
    await prisma.$transaction(async (tx) => {
      await tx.incubationLog.delete({ where: { id: logId } });
      await tx.clutchHistory.create({ data: {
        clutchId: existing.clutchId,
        action: "incubation.log.deleted",
        details: { logId, recordedAt: existing.recordedAt.toISOString(), temperatureC: existing.temperatureC, humidityPct: existing.humidityPct, eventType: existing.eventType, notes: existing.notes },
        notes: "Registrazione di incubazione eliminata",
      } });
      const clutch = await tx.clutch.findUnique({ where: { id: existing.clutchId } });
      if (clutch) {
        const title = "Controllo incubazione · " + clutch.id;
        const lastLog = await tx.incubationLog.findFirst({ where: { clutchId: clutch.id }, orderBy: [{ recordedAt: "desc" }, { id: "desc" }] });
        const reminder = await tx.task.findFirst({ where: { userId: auth.userId, category: "incubation", title, status: "open" }, select: { id: true } });
        if (clutch.checkIntervalHours && lastLog) {
          const dueAt = new Date(lastLog.recordedAt.getTime() + clutch.checkIntervalHours * 60 * 60 * 1000);
          if (reminder) await tx.task.update({ where: { id: reminder.id }, data: { dueAt } });
          else await tx.task.create({ data: { userId: auth.userId, title, category: "incubation", dueAt, description: "Controllo programmato per la covata " + (clutch.incubatorLabel || clutch.id) } });
        } else if (reminder) await tx.task.delete({ where: { id: reminder.id } });
      }
      await tx.auditEvent.create({ data: { userId: auth.userId, action: "incubation_log.deleted", entityType: "incubation_log", entityId: logId } });
    });
    res.status(204).send();
  });

  router.patch("/offspring-batches/:id", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    const batchId = routeUuid(req.params.id, "offspring batch id");
    const input = parseBody(patchOffspringSchema, req.body);
    const existing = await prisma.offspringBatch.findFirst({
      where: { id: batchId, cycle: { is: { userId: auth.userId } } },
    });
    if (!existing) throw new AppError(404, "OFFSPRING_BATCH_NOT_FOUND", "Offspring batch not found");
    if (input.clutchId) {
      const clutch = await ownedClutch(auth.userId, input.clutchId);
      if (clutch.cycleId !== existing.cycleId) throw new AppError(400, "CLUTCH_CYCLE_MISMATCH", "Clutch and offspring batch must belong to the same cycle");
    }
    if (input.clutchId !== undefined && input.clutchId !== existing.clutchId) {
      const linkedAnimals = await prisma.animal.count({ where: { userId: auth.userId, originOffspringBatchId: batchId } });
      if (linkedAnimals > 0) {
        throw new AppError(409, "OFFSPRING_BATCH_HAS_ANIMALS", "The source clutch cannot be changed after animal records have been created");
      }
    }
    const data: Record<string, unknown> = { ...input };
    if (input.bornOn) data.bornOn = validDate(input.bornOn);
    const batch = await prisma.$transaction(async (tx) => {
      if (input.count !== undefined) {
        const registeredAnimals = await tx.animal.count({ where: { userId: auth.userId, originOffspringBatchId: batchId } });
        if (input.count < registeredAnimals) {
          throw new AppError(409, "OFFSPRING_COUNT_BELOW_REGISTERED", "Declared offspring count cannot be lower than the number of registered animals", {
            declaredCount: input.count, registeredCount: registeredAnimals,
          });
        }
      }
      const updated = await tx.offspringBatch.update({ where: { id: batchId }, data: data as never });
      await tx.auditEvent.create({ data: { userId: auth.userId, action: "offspring_batch.updated", entityType: "offspring_batch", entityId: batchId } });
      return updated;
    }, { isolationLevel: "Serializable" });
    res.status(200).json({ offspringBatch: batch });
  });

  router.delete("/offspring-batches/:id", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    const batchId = routeUuid(req.params.id, "offspring batch id");
    const existing = await prisma.offspringBatch.findFirst({
      where: { id: batchId, cycle: { is: { userId: auth.userId } } },
      select: { id: true },
    });
    if (!existing) throw new AppError(404, "OFFSPRING_BATCH_NOT_FOUND", "Offspring batch not found");
    const linkedAnimals = await prisma.animal.count({ where: { userId: auth.userId, originOffspringBatchId: batchId } });
    if (linkedAnimals > 0) throw new AppError(409, "OFFSPRING_BATCH_HAS_ANIMALS", "This offspring batch has animal records. Remove or reassign those records before deleting the batch.");
    await prisma.$transaction(async (tx) => {
      await tx.offspringBatch.delete({ where: { id: batchId } });
      await tx.auditEvent.create({ data: { userId: auth.userId, action: "offspring_batch.deleted", entityType: "offspring_batch", entityId: batchId } });
    });
    res.status(204).send();
  });

  router.delete("/eggs/:id", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    const eggId = routeUuid(req.params.id, "egg id");
    const existing = await prisma.egg.findFirst({
      where: { id: eggId, clutch: { is: { cycle: { is: { userId: auth.userId } } } } },
      select: { id: true, photoKey: true },
    });
    if (!existing) throw new AppError(404, "EGG_NOT_FOUND", "Egg not found");
    await prisma.$transaction(async (tx) => {
      await tx.egg.delete({ where: { id: eggId } });
      await tx.auditEvent.create({ data: { userId: auth.userId, action: "egg.deleted", entityType: "egg", entityId: eggId } });
    });
    if (existing.photoKey) {
      try { await deletePrivateObject(existing.photoKey); }
      catch (error) { logger.error({ eggId, storageKey: existing.photoKey, error }, "Failed to delete egg photo after egg removal"); }
    }
    res.status(204).send();
  });

  router.delete("/clutches/:id", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    const clutchId = routeUuid(req.params.id, "clutch id");
    const clutch = await ownedClutch(auth.userId, clutchId);
    const [offspring, linkedAnimals] = await Promise.all([
      prisma.offspringBatch.count({ where: { clutchId, cycle: { is: { userId: auth.userId } } } }),
      prisma.animal.count({ where: { userId: auth.userId, originClutchId: clutchId } }),
    ]);
    if (offspring > 0 || linkedAnimals > 0) {
      throw new AppError(409, "CLUTCH_HAS_OFFSPRING", "This clutch is linked to offspring records. Remove or reassign those records before deleting the clutch.");
    }
    await prisma.$transaction(async (tx) => {
      await tx.incubationLog.deleteMany({ where: { clutchId } });
      await tx.egg.deleteMany({ where: { clutchId } });
      await tx.clutch.delete({ where: { id: clutchId } });
      await tx.auditEvent.create({ data: { userId: auth.userId, action: "clutch.deleted", entityType: "clutch", entityId: clutchId } });
    });
    res.status(204).send();
  });

  router.delete("/reproduction-cycles/:id", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    const cycleId = routeUuid(req.params.id, "cycle id");
    await ownedCycle(auth.userId, cycleId);
    const [events, clutches, offspring, documents] = await Promise.all([
      prisma.reproductiveEvent.count({ where: { cycleId } }),
      prisma.clutch.count({ where: { cycleId } }),
      prisma.offspringBatch.count({ where: { cycleId } }),
      prisma.document.count({ where: { userId: auth.userId, cycleId } }),
    ]);
    if (events + clutches + offspring + documents > 0) {
      throw new AppError(409, "REPRODUCTION_CYCLE_HAS_RECORDS", "This cycle still has linked events, clutches, offspring batches, or documents. Remove those records first.");
    }
    await prisma.$transaction(async (tx) => {
      await tx.reproductionCycle.delete({ where: { id: cycleId } });
      await tx.auditEvent.create({ data: { userId: auth.userId, action: "reproduction_cycle.deleted", entityType: "reproduction_cycle", entityId: cycleId } });
    });
    res.status(204).send();
  });

  return router;
}
