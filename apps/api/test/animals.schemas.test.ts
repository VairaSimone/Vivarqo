import { describe, expect, it } from "vitest";
import { createAnimalSchema, patchAnimalSchema } from "../src/modules/animals/animals.schemas.js";

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
