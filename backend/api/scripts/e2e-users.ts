import argon2 from "argon2";
import { env } from "../src/config/env.js";
import { prisma } from "../src/db/prisma.js";

const databaseName = new URL(env.DATABASE_URL).pathname.replace(/^\//, "");
if (env.NODE_ENV !== "test" || !/(test|e2e)/i.test(databaseName)) {
  throw new Error("E2E fixtures are restricted to NODE_ENV=test and a test/e2e database");
}

const password = "Vivarqo-E2E-Only-2026!";
const accounts = [
  { email: "e2e-owner@vivarqo.test", displayName: "E2E Owner" },
  { email: "e2e-other@vivarqo.test", displayName: "E2E Other" },
];

try {
  if (process.argv.includes("--cleanup")) {
    await prisma.user.deleteMany({ where: { email: { in: accounts.map((account) => account.email) } } });
    process.stdout.write("E2E accounts cleaned.\n");
  } else {
    await prisma.user.deleteMany({ where: { email: { in: accounts.map((account) => account.email) } } });
    const passwordHash = await argon2.hash(password);
    await prisma.user.createMany({
      data: accounts.map((account) => ({
        ...account,
        passwordHash,
        locale: "it",
        timezone: "Europe/Rome",
        emailVerifiedAt: new Date(),
        accountStatus: "active",
      })),
    });
    process.stdout.write("Two isolated E2E accounts seeded.\n");
  }
} finally {
  await prisma.$disconnect();
}
