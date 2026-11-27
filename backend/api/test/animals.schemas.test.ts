import { describe, expect, it } from "vitest";
import { createAnimalSchema, patchAnimalSchema, feedingEntrySchema, patchFeedingEntrySchema, bulkCareRecordsSchema, validateAnimalDomainProfile } from "../src/modules/animals/animals.schemas.js";


describe("dog and cat medical profile validation", () => {
  it("accepts microchip, veterinary contacts, allergies and chronic conditions", () => {
    const result = validateAnimalDomainProfile("dogs_cats", {
      microchip: "380260000000001",
      veterinarianName: "Dott.ssa Rossi",
      veterinaryClinic: "Ambulatorio Centro",
      veterinaryPhone: "+39 011 1234567",
      veterinaryEmail: "vet@example.it",
      veterinaryAddress: "Torino",
      allergies: "Pollo",
      chronicConditions: "Dermatite cronica",
    });
    expect(result.success).toBe(true);
  });

  it("rejects malformed veterinary email and oversized microchip values", () => {
    expect(validateAnimalDomainProfile("dogs_cats", { veterinaryEmail: "not-an-email" }).success).toBe(false);
    expect(validateAnimalDomainProfile("dogs_cats", { microchip: "x".repeat(41) }).success).toBe(false);
  });
});

describe("animal calendar date validation", () => {
  it("rejects impossible calendar dates on create and patch", () => {
    expect(createAnimalSchema.safeParse({
      name: "Nala",
      species: "Python regius",
      birthDate: "2024-02-31",
    }).success).toBe(false);

    expect(patchAnimalSchema.safeParse({ birthDate: "2024-02-31" }).success).toBe(false);
    expect(patchAnimalSchema.safeParse({ acquiredDate: "2023-02-29" }).success).toBe(false);
  });

  it("accepts a valid leap day and nullable date clearing", () => {
    expect(createAnimalSchema.safeParse({
      name: "Nala",
      species: "Python regius",
      birthDate: "2024-02-29",
    }).success).toBe(true);

    expect(patchAnimalSchema.safeParse({ birthDate: null }).success).toBe(true);
  });
});

describe("feeding prey validation", () => {
  const animalId = "00000000-0000-4000-8000-000000000001";
  const inventoryItemId = "00000000-0000-4000-8000-000000000002";

  it("accepts prey metadata and an optional inventory link", () => {
    expect(feedingEntrySchema.safeParse({
      animalId, outcome: "ate", foodType: "Rat", foodWeightG: 120,
      preyState: "thawed", inventoryItemId, inventoryQuantity: 1,
    }).success).toBe(true);
  });

  it("requires a positive stock quantity when an inventory item is linked", () => {
    expect(feedingEntrySchema.safeParse({
      animalId, outcome: "ate", inventoryItemId,
    }).success).toBe(false);
    expect(patchFeedingEntrySchema.safeParse({
      inventoryItemId, inventoryQuantity: null,
    }).success).toBe(false);
  });

  it("rejects unsupported prey conditions and invalid feeding intervals", () => {
    expect(feedingEntrySchema.safeParse({ animalId, outcome: "ate", preyState: "warm" }).success).toBe(false);
    expect(patchAnimalSchema.safeParse({ feedingIntervalDays: 0 }).success).toBe(false);
    expect(patchAnimalSchema.safeParse({ feedingIntervalDays: 365 }).success).toBe(true);
    expect(patchAnimalSchema.safeParse({ feedingIntervalDays: null }).success).toBe(true);
  });
});

describe("atomic bulk care record validation", () => {
  const firstId = "00000000-0000-4000-8000-000000000001";
  const secondId = "00000000-0000-4000-8000-000000000002";
  const ids = [firstId, secondId];

  it("accepts bulk weights and shed records", () => {
    expect(bulkCareRecordsSchema.safeParse({
      kind: "weight", animalIds: ids, measuredAt: "2026-11-16T12:00:00.000Z", weightG: 1250,
    }).success).toBe(true);
    expect(bulkCareRecordsSchema.safeParse({
      kind: "shed", animalIds: ids, occurredAt: "2026-11-16T12:00:00.000Z", outcome: "partial",
    }).success).toBe(true);
  });

  it("rejects duplicate animals, unsupported outcomes and oversized batches", () => {
    expect(bulkCareRecordsSchema.safeParse({
      kind: "weight", animalIds: [firstId, firstId], measuredAt: "2026-11-16T12:00:00.000Z", weightG: 1250,
    }).success).toBe(false);
    expect(bulkCareRecordsSchema.safeParse({
      kind: "shed", animalIds: ids, occurredAt: "2026-11-16T12:00:00.000Z", outcome: "incomplete",
    }).success).toBe(false);
    expect(bulkCareRecordsSchema.safeParse({
      kind: "weight", animalIds: Array.from({ length: 501 }, (_, index) => `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`),
      measuredAt: "2026-11-16T12:00:00.000Z", weightG: 1250,
    }).success).toBe(false);
  });
});
