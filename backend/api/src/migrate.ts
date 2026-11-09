import { ensureDatabaseSchema } from "./db/schema-integrity.js";
import { logger } from "./logger.js";
import { prisma } from "./db/prisma.js";

void ensureDatabaseSchema()
  .then((report) => {
    logger.info({
      tableCount: report.tableCount,
      columnCount: report.columnCount,
      indexCount: report.indexCount,
      constraintCount: report.constraintCount,
    }, "Database migrations and schema verification completed");
  })
  .catch((error: unknown) => {
    const rawMessage = error instanceof Error ? error.message : "Unknown migration error";
    const safeMessage = rawMessage
      .replace(/postgres(?:ql)?:\/\/[^\s"'\]]+/gi, "[database URL redacted]")
      .slice(0, 2_000);
    logger.fatal({
      errorName: error instanceof Error ? error.name : "UnknownError",
      errorMessage: safeMessage,
    }, "Database migration job failed");
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
