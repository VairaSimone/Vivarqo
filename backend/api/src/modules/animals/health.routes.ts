import { Router } from "express";
import { z } from "zod";
import { AppError } from "../../errors/app-error.js";
import { prisma } from "../../db/prisma.js";
import { requireSession, type AuthContext } from "../auth/session.js";

const recordSchema = z.object({
  recordType: z.enum(["symptom", "visit", "diagnosis", "suspicion", "treatment", "checkup", "vaccination"]),
  status: z.enum(["ongoing", "resolved", "chronic"]).default("ongoing"),
  occurredAt: z.string().datetime(),
  title: z.string().trim().min(1).max(160),
  symptoms: z.string().trim().max(10000).nullable().optional(),
  diagnosis: z.string().trim().max(10000).nullable().optional(),
  suspectedCondition: z.string().trim().max(10000).nullable().optional(),
  veterinarian: z.string().trim().max(160).nullable().optional(),
  clinic: z.string().trim().max(160).nullable().optional(),
  medication: z.string().trim().max(160).nullable().optional(),
  dosage: z.string().trim().max(120).nullable().optional(),
  frequency: z.string().trim().max(120).nullable().optional(),
  treatmentStartAt: z.string().datetime().nullable().optional(),
  treatmentEndAt: z.string().datetime().nullable().optional(),
  nextDueAt: z.string().datetime().nullable().optional(),
  notes: z.string().trim().max(20000).nullable().optional(),
}).strict().refine(v => !v.treatmentEndAt || !v.treatmentStartAt || v.treatmentEndAt >= v.treatmentStartAt, {
  message: "Treatment end must not precede its start", path: ["treatmentEndAt"],
});

function parseId(value: string | string[] | undefined): string {
  const id = Array.isArray(value) ? value[0] : value;
  if (!id || !z.string().uuid().safeParse(id).success) throw new AppError(400, "INVALID_ID", "Invalid id");
  return id;
}
function parseBody(value: unknown) {
  const parsed = recordSchema.safeParse(value);
  if (!parsed.success) throw new AppError(400, "VALIDATION_ERROR", "Request validation failed", {
    issues: parsed.error.issues.map(issue => ({ path: issue.path.map(String).join("."), message: issue.message })),
  });
  return parsed.data;
}
async function ownedAnimal(userId: string, animalId: string, writable = false) {
  const animal = await prisma.animal.findFirst({ where: { id: animalId, userId }, select: { id: true, status: true, archivedAt: true } });
  if (!animal) throw new AppError(404, "ANIMAL_NOT_FOUND", "Animal not found");
  if (writable && (animal.status !== "active" || animal.archivedAt)) throw new AppError(409, "ANIMAL_NOT_ACTIVE", "Health records cannot be changed for archived animals");
  return animal;
}

export function createHealthRouter() {
  const router = Router();
  router.get("/animals/:animalId/health-records", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    const animalId = parseId(req.params.animalId);
    await ownedAnimal(auth.userId, animalId);
    const records = await prisma.healthRecord.findMany({
      where: { animalId },
      orderBy: [{ occurredAt: "desc" }, { createdAt: "desc" }],
      take: 500,
    });
    res.status(200).json({ records });
  });
  router.post("/animals/:animalId/health-records", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    const animalId = parseId(req.params.animalId);
    await ownedAnimal(auth.userId, animalId, true);
    const input = parseBody(req.body);
    const created = await prisma.$transaction(async tx => {
      const record = await tx.healthRecord.create({ data: {
        animalId, ...input,
        occurredAt: new Date(input.occurredAt),
        treatmentStartAt: input.treatmentStartAt ? new Date(input.treatmentStartAt) : null,
        treatmentEndAt: input.treatmentEndAt ? new Date(input.treatmentEndAt) : null,
        nextDueAt: input.nextDueAt ? new Date(input.nextDueAt) : null,
      } });
      if (input.nextDueAt) {
        await tx.task.create({ data: {
          userId: auth.userId, animalId, healthRecordId: record.id, title: "Controllo sanitario: " + input.title,
          description: input.medication ? "Trattamento/farmaco: " + input.medication : "Controllo sanitario programmato",
          category: "custom", dueAt: new Date(input.nextDueAt),
        } });
      }
      await tx.auditEvent.create({ data: { userId: auth.userId, action: "health_record.created", entityType: "health_record", entityId: record.id } });
      return record;
    });
    res.status(201).json({ record: created });
  });
  router.patch("/health-records/:id", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    const id = parseId(req.params.id);
    const existing = await prisma.healthRecord.findFirst({ where: { id, animal: { is: { userId: auth.userId } } }, include: { animal: { select: { id: true, status: true, archivedAt: true } } } });
    if (!existing) throw new AppError(404, "HEALTH_RECORD_NOT_FOUND", "Health record not found");
    await ownedAnimal(auth.userId, existing.animalId, true);
    const input = parseBody(req.body);
    const updated = await prisma.$transaction(async tx => {
      const record = await tx.healthRecord.update({ where: { id }, data: {
        ...input, occurredAt: new Date(input.occurredAt),
        treatmentStartAt: input.treatmentStartAt ? new Date(input.treatmentStartAt) : null,
        treatmentEndAt: input.treatmentEndAt ? new Date(input.treatmentEndAt) : null,
        nextDueAt: input.nextDueAt ? new Date(input.nextDueAt) : null,
      } });
      if (input.nextDueAt) {
        await tx.task.upsert({
          where: { healthRecordId: id },
          create: {
            userId: auth.userId, animalId: existing.animalId, healthRecordId: id,
            title: "Controllo sanitario: " + input.title,
            description: input.medication ? "Trattamento/farmaco: " + input.medication : "Controllo sanitario programmato",
            category: "custom", dueAt: new Date(input.nextDueAt),
          },
          update: {
            title: "Controllo sanitario: " + input.title,
            description: input.medication ? "Trattamento/farmaco: " + input.medication : "Controllo sanitario programmato",
            dueAt: new Date(input.nextDueAt), status: "open", completedAt: null,
          },
        });
      } else {
        await tx.task.deleteMany({ where: { healthRecordId: id } });
      }
      return record;
    });
    res.status(200).json({ record: updated });
  });
  router.delete("/health-records/:id", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    const id = parseId(req.params.id);
    const existing = await prisma.healthRecord.findFirst({ where: { id, animal: { userId: auth.userId } }, select: { id: true, animalId: true } });
    if (!existing) throw new AppError(404, "HEALTH_RECORD_NOT_FOUND", "Health record not found");
    await ownedAnimal(auth.userId, existing.animalId, true);
    await prisma.healthRecord.delete({ where: { id } });
    await prisma.auditEvent.create({ data: { userId: auth.userId, action: "health_record.deleted", entityType: "health_record", entityId: id } });
    res.status(204).send();
  });
  return router;
}
