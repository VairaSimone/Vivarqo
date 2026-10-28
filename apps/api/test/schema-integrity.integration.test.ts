import { describe, expect, it } from "vitest";
import { ensureDatabaseSchema, inspectDatabaseSchema } from "../src/db/schema-integrity.js";

const enabled = process.env.RUN_DB_INTEGRATION === "true";

describe.skipIf(!enabled)("Automatic PostgreSQL schema initialization", () => {
  it("applies pending migrations idempotently and verifies every model column and SQL guard", async () => {
    const startup = await ensureDatabaseSchema();
    const verification = await inspectDatabaseSchema();

    expect(startup.issues, startup.issues.join("; ")).toEqual([]);
    expect(verification.issues, verification.issues.join("; ")).toEqual([]);
    expect(verification.tableCount).toBeGreaterThanOrEqual(31);
    expect(verification.columnCount).toBeGreaterThan(200);
  });
});
