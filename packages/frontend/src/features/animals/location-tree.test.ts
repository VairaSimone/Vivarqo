import { describe, expect, it } from "vitest";
import { getLocationDescendantIds, getLocationPath } from "./location-tree";

const locations = [
  { id: "room", name: "Stanza", parentId: null },
  { id: "rack", name: "Rack 1", parentId: "room" },
  { id: "shelf", name: "Ripiano 2", parentId: "rack" },
  { id: "box", name: "Box A", parentId: "shelf" },
  { id: "other", name: "Altra stanza", parentId: null },
];

describe("animal location hierarchy", () => {
  it("includes the selected location and every nested descendant", () => {
    expect(getLocationDescendantIds(locations, "rack").sort()).toEqual(["box", "rack", "shelf"]);
  });
  it("builds a readable full location path", () => {
    expect(getLocationPath(locations, "box")).toBe("Stanza / Rack 1 / Ripiano 2 / Box A");
  });
  it("handles unassigned and missing locations", () => {
    expect(getLocationPath(locations, null, "Non assegnato")).toBe("Non assegnato");
    expect(getLocationPath(locations, "missing")).toBe("—");
  });
  it("does not loop forever if corrupted data contains a cycle", () => {
    const cyclic = [{ id: "a", name: "A", parentId: "b" }, { id: "b", name: "B", parentId: "a" }];
    expect(getLocationPath(cyclic, "a")).toBe("B / A");
    expect(getLocationDescendantIds(cyclic, "a").sort()).toEqual(["a", "b"]);
  });
});
