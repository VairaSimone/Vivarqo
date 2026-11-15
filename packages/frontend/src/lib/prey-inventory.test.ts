import { describe, expect, it } from "vitest";
import { suggestedInventoryQuantity } from "./prey-inventory";

describe("prey inventory quantity", () => {
  it("converts prey grams to kilograms when inventory is measured in kg", () => {
    expect(suggestedInventoryQuantity("kg", 120)).toBe("0.12");
  });
  it("keeps grams when inventory is measured in grams", () => {
    expect(suggestedInventoryQuantity("g", 120)).toBe("120");
  });
  it("uses one item for count-based stock and when weight is unavailable", () => {
    expect(suggestedInventoryQuantity("unit", 120)).toBe("1");
    expect(suggestedInventoryQuantity("kg", null)).toBe("1");
  });
});
