import { afterAll, describe, expect, it } from "vitest";
import { checkDatabaseConnection, prisma } from "../src/db/prisma.js";

const integrationEnabled = process.env.RUN_DB_INTEGRATION === "true";

describe.skipIf(!integrationEnabled)("PostgreSQL integration", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("connects and sees the migrated Vivarqo schema", async () => {
    await checkDatabaseConnection();

    const rows = await prisma.$queryRaw<Array<{ table_count: bigint }>>`
      SELECT COUNT(*)::bigint AS table_count
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_type = 'BASE TABLE'
        AND table_name <> '_prisma_migrations'
    `;

    expect(Number(rows[0]?.table_count)).toBe(31);
  });
});
