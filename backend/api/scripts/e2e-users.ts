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

async function cleanAccounts() {
  const users = await prisma.user.findMany({
    where: { email: { in: accounts.map((account) => account.email) } },
    select: { id: true },
  });
  const userIds = users.map((user) => user.id);
  if (userIds.length === 0) return;

  const ownedAnimals = { userId: { in: userIds } };
  const ownedCycles = { userId: { in: userIds } };
  const ownedClutches = { cycle: { is: ownedCycles } };

  await prisma.$transaction(async (tx) => {
    // Remove references to animals/documents before deleting their owners.
    await tx.financeEntry.deleteMany({ where: { userId: { in: userIds } } });
    await tx.document.deleteMany({ where: { userId: { in: userIds } } });
    await tx.publicShare.deleteMany({ where: { userId: { in: userIds } } });

    // Feeding entries cascade from their sessions; other care records restrict animal deletion.
    await tx.feedingSession.deleteMany({ where: { userId: { in: userIds } } });
    await tx.weightMeasurement.deleteMany({ where: { animal: { is: ownedAnimals } } });
    await tx.shedRecord.deleteMany({ where: { animal: { is: ownedAnimals } } });
    await tx.animalNote.deleteMany({ where: { animal: { is: ownedAnimals } } });
    await tx.animalGeneticTrait.deleteMany({
      where: {
        OR: [
          { animal: { is: ownedAnimals } },
          { sourceAnimal: { is: ownedAnimals } },
        ],
      },
    });
    await tx.task.deleteMany({ where: { userId: { in: userIds } } });
    await tx.reminderRule.deleteMany({ where: { userId: { in: userIds } } });

    // Reproduction records have restrictive parent/child relations.
    await tx.reproductiveEvent.deleteMany({
      where: {
        OR: [
          { cycle: { is: ownedCycles } },
          { animal: { is: ownedAnimals } },
        ],
      },
    });
    await tx.egg.deleteMany({ where: { clutch: { is: ownedClutches } } });
    await tx.incubationLog.deleteMany({ where: { clutch: { is: ownedClutches } } });

    // The origin relations use RESTRICT: clear them before removing their batches.
    await tx.animal.updateMany({
      where: ownedAnimals,
      data: { originClutchId: null, originOffspringBatchId: null },
    });
    await tx.offspringBatch.deleteMany({ where: { cycle: { is: ownedCycles } } });
    await tx.clutch.deleteMany({ where: ownedClutches });
    await tx.reproductionCycle.deleteMany({ where: ownedCycles });

    // Inventory movements restrict deleting their item.
    await tx.stockMovement.deleteMany({ where: { item: { is: { userId: { in: userIds } } } } });
    await tx.inventoryItem.deleteMany({ where: { userId: { in: userIds } } });

    await tx.animal.deleteMany({ where: ownedAnimals });
    await tx.user.deleteMany({ where: { id: { in: userIds } } });
  });
}

try {
  await cleanAccounts();

  if (process.argv.includes("--cleanup")) {
    process.stdout.write("E2E accounts and dependent records cleaned.\\n");
  } else {
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
    process.stdout.write("Two isolated E2E accounts seeded.\\n");
  }
} finally {
  await prisma.$disconnect();
}
