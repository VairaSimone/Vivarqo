import { createHash, randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "../src/db/prisma.js";
import { cleanupExpiredPrivateData } from "../src/modules/domain/retention-worker.js";
import { PostgresRateLimitStore } from "../src/middleware/postgres-rate-limit-store.js";

const enabled = process.env.RUN_DB_INTEGRATION === "true";
const userIds: string[] = [];

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

describe.skipIf(!enabled)("Privacy retention and shared authentication rate limits", () => {
  afterAll(async () => {
    await prisma.apiRateLimitBucket.deleteMany({
      where: { namespace: { in: ["test-retention", "test-shared-auth"] } },
    });
    if (userIds.length) await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  });

  it("removes expired authentication material, import reports and export metadata", async () => {
    const user = await prisma.user.create({
      data: {
        email: `retention-${randomUUID()}@example.com`,
        passwordHash: "test-only-placeholder",
        displayName: "Retention test",
        emailVerifiedAt: new Date(),
      },
    });
    userIds.push(user.id);
    const now = new Date();
    const past = new Date(now.getTime() - 60_000);
    const future = new Date(now.getTime() + 60 * 60_000);

    await prisma.userSession.createMany({
      data: [
        { userId: user.id, tokenHash: hash(randomUUID()), expiresAt: past, userAgent: "old-client", ipHash: hash("old-ip") },
        { userId: user.id, tokenHash: hash(randomUUID()), expiresAt: future, userAgent: "active-client" },
      ],
    });
    await prisma.authToken.createMany({
      data: [
        { userId: user.id, tokenHash: hash(randomUUID()), tokenType: "verify_email", expiresAt: past },
        { userId: user.id, tokenHash: hash(randomUUID()), tokenType: "reset_password", expiresAt: future, consumedAt: now },
        { userId: user.id, tokenHash: hash(randomUUID()), tokenType: "reset_password", expiresAt: future },
      ],
    });
    await prisma.importJob.createMany({
      data: [
        { userId: user.id, entityType: "notes", storageKey: "database-preview-report", status: "preview", report: { notes: "expired private preview" }, expiresAt: past },
        { userId: user.id, entityType: "notes", storageKey: "database-preview-report", status: "preview", report: { notes: "active preview" }, expiresAt: future },
      ],
    });
    await prisma.exportJob.createMany({
      data: [
        { userId: user.id, status: "completed", storageKey: null, expiresAt: past },
        { userId: user.id, status: "completed", storageKey: null, expiresAt: future },
      ],
    });
    await prisma.apiRateLimitBucket.createMany({
      data: [
        { namespace: "test-retention", keyHash: hash(randomUUID()), hits: 3, resetAt: past },
        { namespace: "test-retention", keyHash: hash(randomUUID()), hits: 1, resetAt: future },
      ],
    });

    const summary = await cleanupExpiredPrivateData(now);
    expect(summary.expiredSessions).toBe(1);
    expect(summary.expiredTokens).toBe(2);
    expect(summary.expiredImports).toBe(1);
    expect(summary.expiredExports).toBe(1);
    expect(summary.expiredRateLimitBuckets).toBe(1);

    expect(await prisma.userSession.count({ where: { userId: user.id } })).toBe(1);
    expect(await prisma.authToken.count({ where: { userId: user.id } })).toBe(1);
    expect(await prisma.importJob.count({ where: { userId: user.id } })).toBe(1);
    expect(await prisma.exportJob.count({ where: { userId: user.id } })).toBe(1);
    expect(await prisma.apiRateLimitBucket.count({ where: { namespace: "test-retention" } })).toBe(1);
  });

  it("shares authentication counters between independent API-store instances", async () => {
    const key = `integration-test-${randomUUID()}`;
    const first = new PostgresRateLimitStore("test-shared-auth");
    const second = new PostgresRateLimitStore("test-shared-auth");
    try {
      await first.resetKey(key);
      expect((await first.increment(key)).totalHits).toBe(1);
      expect((await second.increment(key)).totalHits).toBe(2);
      expect((await first.get(key))?.totalHits).toBe(2);
      await second.decrement(key);
      expect((await first.get(key))?.totalHits).toBe(1);
    } finally {
      await first.resetKey(key);
    }
  });
});
