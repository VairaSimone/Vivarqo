import argon2 from "argon2";
import { prisma } from "../src/db/prisma.js";

const password = "Vivarqo-CI-Only-Password-2026!";
const accounts = [
  { email: "e2e-owner@vivarqo.test", displayName: "E2E Owner" },
  { email: "e2e-other@vivarqo.test", displayName: "E2E Other" },
];

async function main(): Promise<void> {
  const passwordHash = await argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 19_456,
    timeCost: 2,
    parallelism: 1,
  });
  for (const account of accounts) {
    await prisma.user.upsert({
      where: { email: account.email },
      create: {
        ...account,
        passwordHash,
        locale: "it",
        timezone: "Europe/Rome",
        emailVerifiedAt: new Date(),
      },
      update: {
        displayName: account.displayName,
        passwordHash,
        locale: "it",
        timezone: "Europe/Rome",
        emailVerifiedAt: new Date(),
        accountStatus: "active",
        deletedAt: null,
      },
    });
  }
}

main()
  .then(async () => {
    await prisma.$disconnect();
    process.stdout.write("Seeded isolated real-E2E accounts.\n");
  })
  .catch(async (error: unknown) => {
    await prisma.$disconnect().catch(() => undefined);
    process.stderr.write((error instanceof Error ? error.message : "Unknown seed error") + "\n");
    process.exitCode = 1;
  });
