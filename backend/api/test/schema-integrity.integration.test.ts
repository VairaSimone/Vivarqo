import { describe, expect, it } from "vitest";
import { ensureDatabaseSchema, inspectDatabaseSchema, verifyDatabaseSchema } from "../src/db/schema-integrity.js";

const enabled = process.env.RUN_DB_INTEGRATION === "true";

describe.skipIf(!enabled)("Automatic PostgreSQL schema initialization", () => {
  it("applies pending migrations idempotently and verifies column types, nullability and SQL objects", async () => {
    const startup = await ensureDatabaseSchema();
    const verification = await inspectDatabaseSchema();
    const readiness = await verifyDatabaseSchema();

    expect(startup.issues, startup.issues.join("; ")).toEqual([]);
    expect(verification.issues, verification.issues.join("; ")).toEqual([]);
    expect(verification.tableCount).toBeGreaterThanOrEqual(31);
    expect(verification.columnCount).toBeGreaterThan(200);
    expect(verification.indexCount).toBeGreaterThan(40);
    expect(verification.constraintCount).toBeGreaterThan(40);
    expect(readiness.issues).toEqual([]);
  });
});
