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
    ["/animals/00000000-0000-4000-8000-000000000001/genetic-traits", "reptiles"],
    ["/animals/00000000-0000-4000-8000-000000000001/pedigree", "reptiles"],
    ["/animals/00000000-0000-4000-8000-000000000001/inbreeding", "reptiles"],
    ["/genetics/calculate", "reptiles"],
    ["/genetics/calculate-pairing", "reptiles"],
  ])("requires the %s route to have category %s", (path, category) => {
    expect(categoryForAnimalDomainPath(path)).toBe(category);
  });

  it("leaves shared reproduction and offspring routes to record-scoped category checks", () => {
    const id = "00000000-0000-4000-8000-000000000001";
    expect(categoryForAnimalDomainPath("/incubators")).toBeNull();
    expect(categoryForAnimalDomainPath("/offspring-batches")).toBeNull();
    expect(categoryForAnimalDomainPath("/offspring-batches/" + id + "/animals")).toBeNull();
    expect(categoryForAnimalDomainPath("/reproductive-events/" + id)).toBeNull();
    expect(categoryForAnimalDomainPath("/animals/" + id + "/hatchling-care")).toBeNull();
  });

  it("does not apply an animal category gate to unrelated personal routes", () => {
    expect(categoryForAnimalDomainPath("/notifications")).toBeNull();
    expect(categoryForAnimalDomainPath("/finance/entries")).toBeNull();
    // Cycle routes resolve their enabled category from their actual parent animals.
    expect(categoryForAnimalDomainPath("/reproduction-cycles")).toBeNull();
    expect(categoryForAnimalDomainPath("/reproduction-cycles/00000000-0000-4000-8000-000000000001/clutches")).toBeNull();
    expect(categoryForAnimalDomainPath("/clutches/00000000-0000-4000-8000-000000000001/eggs")).toBeNull();
  });
});
