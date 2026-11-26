import { describe, expect, it } from "vitest";
import {
  waterChangeSchema, filterSchema, dosingSchema, populationMovementSchema,
  quarantineSchema, treatmentSchema, reproductionSchema, compatibilitySchema,
} from "../src/modules/domain/aquarium-management.routes.js";

const at = "2026-11-26T12:00:00.000Z";
const id = "8f8a5f4e-4e2f-4d8d-90e3-7d2f3cbf99a1";

describe("aquarium management schemas", () => {
  it("validates water change amount and percentage", () => {
    expect(waterChangeSchema.safeParse({ occurredAt: at, volumeLiters: 25, percentage: 25 }).success).toBe(true);
    expect(waterChangeSchema.safeParse({ occurredAt: at, volumeLiters: 0 }).success).toBe(false);
    expect(waterChangeSchema.safeParse({ occurredAt: at, volumeLiters: 20, percentage: 101 }).success).toBe(false);
  });
  it("validates filter maintenance action and dates", () => {
    expect(filterSchema.safeParse({ occurredAt: at, filterName: "External filter", action: "cleaning" }).success).toBe(true);
    expect(filterSchema.safeParse({ occurredAt: at, filterName: "Filter", action: "invalid" }).success).toBe(false);
  });
  it("validates positive product dosing", () => {
    expect(dosingSchema.safeParse({ occurredAt: at, productName: "Fertilizer", productType: "fertilizer", doseAmount: 2, doseUnit: "ml" }).success).toBe(true);
    expect(dosingSchema.safeParse({ occurredAt: at, productName: "Fertilizer", productType: "fertilizer", doseAmount: 0, doseUnit: "ml" }).success).toBe(false);
  });
  it("validates population movements and positive counts", () => {
    expect(populationMovementSchema.safeParse({ movementType: "introduction", speciesKey: "poecilia reticulata", quantity: 5, occurredAt: at, toAquariumId: id }).success).toBe(true);
    expect(populationMovementSchema.safeParse({ movementType: "mortality", speciesKey: "poecilia reticulata", quantity: 0, occurredAt: at }).success).toBe(false);
  });
  it("validates quarantine date ranges and counts", () => {
    expect(quarantineSchema.safeParse({ speciesKey: "neon tetra", quantity: 6, startedAt: at }).success).toBe(true);
    expect(quarantineSchema.safeParse({ speciesKey: "neon tetra", quantity: 6, startedAt: at, endedAt: "2026-11-25T12:00:00.000Z" }).success).toBe(false);
  });
  it("validates treatment types and dates", () => {
    expect(treatmentSchema.safeParse({ startedAt: at, treatmentType: "antiparasitic", productName: "Treatment" }).success).toBe(true);
    expect(treatmentSchema.safeParse({ startedAt: at, endedAt: "2026-11-25T12:00:00.000Z", treatmentType: "medication", productName: "Treatment" }).success).toBe(false);
  });
  it("validates breeding counts in sequence", () => {
    expect(reproductionSchema.safeParse({ speciesKey: "guppy", startedAt: at, eggsCount: 20, hatchedCount: 10, survivingCount: 8 }).success).toBe(true);
    expect(reproductionSchema.safeParse({ speciesKey: "guppy", startedAt: at, eggsCount: 10, hatchedCount: 12 }).success).toBe(false);
  });
  it("validates species compatibility rules", () => {
    expect(compatibilitySchema.safeParse({ speciesAKey: "guppy", speciesBKey: "corydoras", compatibility: "compatible" }).success).toBe(true);
    expect(compatibilitySchema.safeParse({ speciesAKey: "guppy", speciesBKey: "guppy", compatibility: "compatible" }).success).toBe(false);
  });
});
