import { describe, expect, it } from "vitest";
import { AppError } from "../src/errors/app-error.js";
import { assertRolePermission } from "../src/modules/auth/workspace-access.js";

function expectDenied(role: string, method: string, path: string, body?: unknown) {
  try {
    assertRolePermission(role, method, path, body);
    throw new Error("Expected workspace permission denial");
  } catch (error) {
    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({ statusCode: 403, code: "WORKSPACE_PERMISSION_DENIED" });
  }
}

describe("workspace role permissions", () => {
  it("keeps viewers read-only", () => {
    expect(() => assertRolePermission("viewer", "GET", "/animals")).not.toThrow();
    expect(() => assertRolePermission("viewer", "POST", "/genetics/calculate")).not.toThrow();
    expectDenied("unknown", "GET", "/animals");
    expectDenied("viewer", "POST", "/animals");
    expectDenied("viewer", "PATCH", "/tasks/123");
  });

  it("allows operators to manage husbandry but not genetics, reproduction or administration", () => {
    expect(() => assertRolePermission("operator", "POST", "/feeding-sessions")).not.toThrow();
    expect(() => assertRolePermission("operator", "PATCH", "/animals/123/weights")).not.toThrow();
    expect(() => assertRolePermission("operator", "POST", "/animals/locations")).not.toThrow();
    expect(() => assertRolePermission("operator", "PATCH", "/animals/123", { notes: "routine care" })).not.toThrow();
    expectDenied("operator", "PATCH", "/animals/123", { morph: "Albino", geneticsNotes: "carrier" });
    expectDenied("operator", "POST", "/animals", { motherAnimalId: "00000000-0000-4000-8000-000000000001" });
    expectDenied("operator", "POST", "/animals/bulk", { animals: [{ name: "A", morph: "Pastel" }] });
    expectDenied("operator", "POST", "/animals/123/genetic-traits");
    expectDenied("operator", "POST", "/reproduction-cycles");
    expectDenied("operator", "POST", "/documents");
    expectDenied("operator", "POST", "/animals/123/transfers");
  });

  it("limits breeding collaborators to reproduction and genetics changes", () => {
    expect(() => assertRolePermission("breeding", "POST", "/reproduction-cycles")).not.toThrow();
    expect(() => assertRolePermission("breeding", "POST", "/genetics/calculate")).not.toThrow();
    expect(() => assertRolePermission("breeding", "PATCH", "/animals/123/genetic-traits")).not.toThrow();
    expectDenied("breeding", "PATCH", "/animals/123");
    expectDenied("breeding", "POST", "/feeding-sessions");
  });

  it("allows administrators to manage operational data but never finance or full exports", () => {
    expect(() => assertRolePermission("admin", "POST", "/documents")).not.toThrow();
    expect(() => assertRolePermission("admin", "POST", "/inventory/items")).not.toThrow();
    expectDenied("admin", "GET", "/finance/entries");
    expectDenied("admin", "POST", "/exports");
  });

  it("does not let any collaborator role access financial data", () => {
    for (const role of ["admin", "operator", "breeding", "viewer"]) {
      expectDenied(role, "GET", "/finance/summary");
      expectDenied(role, "POST", "/finance/entries");
    }
  });
});
