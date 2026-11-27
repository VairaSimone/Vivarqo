import { describe, expect, it } from "vitest";
import { categoryForAnimalDomainPath } from "../src/modules/domain/animal-domain-access.js";

describe("animal domain route category coverage", () => {
  it.each([
    ["/birds/00000000-0000-4000-8000-000000000001/profile", "birds"],
    ["/bird-breeding-pairs", "birds"],
    ["/aviary-maintenance/00000000-0000-4000-8000-000000000001", "birds"],
    ["/quarantines/00000000-0000-4000-8000-000000000001", "fish"],
    ["/aquarium-treatments/00000000-0000-4000-8000-000000000001", "fish"],
    ["/aviaries", "birds"],
    ["/aquariums", "fish"],
    ["/companion-care", "dogs_cats"],
    ["/reproduction-cycles", "reptiles"],
  ])("requires the %s route to have category %s", (path, category) => {
    expect(categoryForAnimalDomainPath(path)).toBe(category);
  });

  it("does not apply an animal category gate to unrelated personal routes", () => {
    expect(categoryForAnimalDomainPath("/notifications")).toBeNull();
    expect(categoryForAnimalDomainPath("/finance/entries")).toBeNull();
  });
});
