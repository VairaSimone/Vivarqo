import { describe, expect, it } from "vitest";
import { createAnimalSchema, mergeAnimalDomainProfile, validateAnimalDomainProfile } from "./animals.schemas.js";

describe("multi-domain animal profiles", () => {
  it("allows creating an animal before optional category-specific details are known", () => {
    for (const category of ["reptiles", "fish", "birds", "dogs_cats"] as const) {
      expect(
        createAnimalSchema.safeParse({
          name: "Animal without profile",
          species: "Test species",
          category,
          domainProfile: {},
        }).success,
        category,
      ).toBe(true);
    }
  });

  it("accepts a minimal valid profile for each category without requiring identifiers", () => {
    const profiles = {
      reptiles: { brumation: "not_applicable" },
      fish: { waterType: "saltwater" },
      birds: { flightStatus: "unknown" },
      dogs_cats: { animalType: "cat", vaccinationStatus: "unknown", indoorOutdoor: "indoor" },
    } as const;

    for (const [category, domainProfile] of Object.entries(profiles)) {
      expect(
        createAnimalSchema.safeParse({
          name: "Animal with profile",
          species: "Test species",
          category,
          domainProfile,
        }).success,
        category,
      ).toBe(true);
    }
  });

  it("accepts explicit false boolean profile values", () => {
    expect(validateAnimalDomainProfile("dogs_cats", { sterilized: false }).success).toBe(true);
    expect(validateAnimalDomainProfile("fish", { shoaling: false }).success).toBe(true);
  });

  it("allows optional category-specific text fields to remain blank", () => {
    expect(validateAnimalDomainProfile("reptiles", { enclosure: "   " }).success).toBe(true);
    expect(validateAnimalDomainProfile("birds", { diet: "" }).success).toBe(true);
  });

  it("rejects fields that do not belong to the selected category", () => {
    expect(validateAnimalDomainProfile("fish", { microchip: "123" }).success).toBe(false);
  });

  it("validates bird care metadata without requiring a ring identifier", () => {
    expect(validateAnimalDomainProfile("birds", { tameness: "tame", flightStatus: "full_flight" }).success).toBe(true);
  });

  it("does not allow arbitrary JSON properties in a profile", () => {
    expect(validateAnimalDomainProfile("dogs_cats", { unknownField: "unsafe" }).success).toBe(false);
  });

  it("accepts dog and cat profiles without requiring a microchip", () => {
    expect(createAnimalSchema.safeParse({
      name: "Luna",
      species: "Felis catus",
      category: "dogs_cats",
      domainProfile: { animalType: "cat", indoorOutdoor: "indoor", sterilized: true, vaccinationStatus: "up_to_date", weightKg: 4.2 },
    }).success).toBe(true);
    expect(createAnimalSchema.safeParse({
      name: "Thor",
      species: "Canis lupus familiaris",
      category: "dogs_cats",
      domainProfile: { animalType: "dog", activityLevel: "high" },
    }).success).toBe(true);
  });

  it("merges partial changes while preserving untouched and legacy values", () => {
    const merged = mergeAnimalDomainProfile("dogs_cats", {
      animalType: "dog", breed: "Labrador", activityLevel: "high", legacyField: "preserve me",
    }, { activityLevel: "low" });
    expect(merged.success).toBe(true);
    if (merged.success) expect(merged.data).toMatchObject({
      animalType: "dog", breed: "Labrador", activityLevel: "low", legacyField: "preserve me",
    });
  });

  it("clears only explicitly cleared keys and preserves legacy profile values", () => {
    const merged = mergeAnimalDomainProfile("dogs_cats", {
      animalType: "cat", breed: "Europeo", indoorOutdoor: "indoor", legacyFlag: true,
    }, { breed: null });
    expect(merged.success).toBe(true);
    if (merged.success) {
      expect(merged.data).not.toHaveProperty("breed");
      expect(merged.data).toMatchObject({ animalType: "cat", indoorOutdoor: "indoor", legacyFlag: true });
    }
  });

  it("rejects new unsupported profile keys", () => {
    expect(mergeAnimalDomainProfile("dogs_cats", {}, { arbitraryField: "invalid" }).success).toBe(false);
  });

  it("rejects companion fields that do not match the selected type", () => {
    expect(validateAnimalDomainProfile("dogs_cats", { animalType: "cat", activityLevel: "high" }).success).toBe(false);
    expect(validateAnimalDomainProfile("dogs_cats", { animalType: "dog", indoorOutdoor: "indoor" }).success).toBe(false);
  });
});
