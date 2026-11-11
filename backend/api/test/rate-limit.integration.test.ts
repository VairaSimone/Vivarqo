import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { PostgresRateLimitStore } from "../src/middleware/postgres-rate-limit-store.js";

const integrationEnabled = process.env.RUN_DB_INTEGRATION === "true";

describe.skipIf(!integrationEnabled)("shared PostgreSQL API rate limit", () => {
  it("shares the api-global counter between independent API store instances", async () => {
    const firstReplica = new PostgresRateLimitStore("api-global");
    const secondReplica = new PostgresRateLimitStore("api-global");
    const clientKey = "rate-limit-integration:" + randomUUID();
    try {
      expect((await firstReplica.increment(clientKey)).totalHits).toBe(1);
      expect((await secondReplica.get(clientKey))?.totalHits).toBe(1);
      expect((await secondReplica.increment(clientKey)).totalHits).toBe(2);
      expect((await firstReplica.get(clientKey))?.totalHits).toBe(2);
    } finally {
      await secondReplica.resetKey(clientKey);
    }
  });
});
