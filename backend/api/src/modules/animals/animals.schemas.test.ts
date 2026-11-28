import { describe, expect, it } from "vitest";
import { createAnimalSchema, validateAnimalDomainProfile } from "./animals.schemas.js";

describe("multi-domain animal profiles", () => {
  it("requires at least one meaningful category-specific value for every category", () => {
    for (const category of ["reptiles", "fish", "birds", "dogs_cats"] as const) {
      expect(
        createAnimalSchema.safeParse({
          name: "Animal without profile",
          species: "Test species",
          category,
          domainProfile: {},
        }).success,
        category,
      ).toBe(false);
    }
  });

  it("accepts a minimal valid profile for each category without requiring identifiers", () => {
    const profiles = {
      reptiles: { brumation: "not_applicable" },
      fish: { waterType: "saltwater" },
      birds: { flightStatus: "unknown" },
      dogs_cats: { vaccinationStatus: "unknown" },
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

  it("counts explicit false values as meaningful data", () => {
    expect(validateAnimalDomainProfile("dogs_cats", { sterilized: false }).success).toBe(true);
    expect(validateAnimalDomainProfile("fish", { shoaling: false }).success).toBe(true);
  });

  it("does not count blank strings as category-specific data", () => {
    expect(validateAnimalDomainProfile("reptiles", { enclosure: "   " }).success).toBe(false);
    expect(validateAnimalDomainProfile("birds", { diet: "" }).success).toBe(false);
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

  it("accepts valid dog and cat-specific fields when the microchip is absent", () => {
    expect(createAnimalSchema.safeParse({
      name: "Luna",
      species: "Gatto europeo",
      category: "dogs_cats",
      domainProfile: { sterilized: true, vaccinationStatus: "up_to_date", weightKg: 4.2 },
    }).success).toBe(true);
  });
});
