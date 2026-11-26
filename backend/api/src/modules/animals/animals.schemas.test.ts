import { describe, expect, it } from "vitest";
import { createAnimalSchema, validateAnimalDomainProfile } from "./animals.schemas.js";

describe("multi-domain animal profiles", () => {
  it("accepts valid dog and cat-specific fields", () => {
    expect(createAnimalSchema.safeParse({
      name: "Luna", species: "Gatto europeo", category: "dogs_cats",
      domainProfile: { microchip: "380260000000001", sterilized: true, vaccinationStatus: "up_to_date", weightKg: 4.2 },
    }).success).toBe(true);
  });
  it("rejects fields that do not belong to the selected category", () => {
    expect(validateAnimalDomainProfile("fish", { microchip: "123" }).success).toBe(false);
  });
  it("validates bird ring identifiers and care metadata", () => {
    expect(validateAnimalDomainProfile("birds", { ringNumber: "IT-2026-001", tameness: "tame", flightStatus: "full_flight" }).success).toBe(true);
  });
  it("does not allow arbitrary JSON properties in a profile", () => {
    expect(validateAnimalDomainProfile("dogs_cats", { unknownField: "unsafe" }).success).toBe(false);
  });
});
