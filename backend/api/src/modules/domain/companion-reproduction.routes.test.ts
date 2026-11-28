import { describe, expect, it } from "vitest";
import { companionReproductionCreateSchema, companionReproductionPatchSchema } from "./companion-reproduction.routes.js";

const valid = {
  femaleAnimalId: "00000000-0000-4000-8000-000000000001",
  maleAnimalId: "00000000-0000-4000-8000-000000000002",
  matedAt: "2026-01-01",
  status: "pregnant" as const,
  pregnancyConfirmedAt: "2026-01-20",
  expectedDueAt: "2026-03-20",
};

describe("companion reproduction validation", () => {
  it("accepts a mating with a confirmed pregnancy and an expected due date", () => {
    expect(companionReproductionCreateSchema.safeParse(valid).success).toBe(true);
  });

  it("requires a pregnancy confirmation date for the pregnant status", () => {
    expect(companionReproductionCreateSchema.safeParse({ ...valid, pregnancyConfirmedAt: null }).success).toBe(false);
  });

  it("requires the delivery date for a delivered record", () => {
    expect(companionReproductionCreateSchema.safeParse({ ...valid, status: "delivered", deliveredAt: null }).success).toBe(false);
  });

  it("rejects a litter whose live-born and stillborn counts exceed the total", () => {
    expect(companionReproductionCreateSchema.safeParse({
      ...valid,
      status: "delivered",
      deliveredAt: "2026-03-10",
      totalBorn: 3,
      liveBorn: 3,
      stillborn: 1,
    }).success).toBe(false);
  });

  it("rejects chronology that predates mating", () => {
    expect(companionReproductionCreateSchema.safeParse({ ...valid, pregnancyConfirmedAt: "2025-12-31" }).success).toBe(false);
  });

  it("requires at least one patch field", () => {
    expect(companionReproductionPatchSchema.safeParse({}).success).toBe(false);
  });
});
