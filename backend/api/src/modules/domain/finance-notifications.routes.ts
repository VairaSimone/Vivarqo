import { Router } from "express";
import { z } from "zod";
import { AppError } from "../../errors/app-error.js";
import { prisma } from "../../db/prisma.js";
import { requireSession, type AuthContext } from "../auth/session.js";
import { getVapidPublicKey, isSupportedPushEndpoint, sendPushToUser } from "./web-push.js";

function parseBody<T extends z.ZodType>(schema: T, value: unknown): z.output<T> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new AppError(400, "VALIDATION_ERROR", "Request validation failed", { issues: parsed.error.issues.map((i) => ({ path: i.path.map(String).join("."), message: i.message })) });
  return parsed.data;
}
function routeUuid(value: string | string[] | undefined, label: string): string {
  const id = Array.isArray(value) ? value[0] : value;
  if (!id || !z.string().uuid().safeParse(id).success) throw new AppError(400, "INVALID_ID", `Invalid ${label}`);
  return id;
}
function validDate(value: string): Date {
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new AppError(400, "VALIDATION_ERROR", "Invalid date");
  return date;
}
const entryType = z.enum(["income", "expense"]);
const financeInput = z.object({
  entryType,
  occurredOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  amountCents: z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  currency: z.string().trim().length(3).default("EUR").transform((value) => value.toUpperCase()),
  category: z.string().trim().min(1).max(80),
  description: z.string().trim().min(1).max(240),
  animalId: z.string().uuid().nullable().optional(),
  documentId: z.string().uuid().nullable().optional(),
  reproductionCycleId: z.string().uuid().nullable().optional(),
  clutchId: z.string().uuid().nullable().optional(),
  offspringBatchId: z.string().uuid().nullable().optional(),
}).strict();
const financePatch = z.object({
  entryType: entryType.optional(),
  occurredOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  amountCents: z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
  currency: z.string().trim().length(3).transform((value) => value.toUpperCase()).optional(),
  category: z.string().trim().min(1).max(80).optional(),
  description: z.string().trim().min(1).max(240).optional(),
  animalId: z.string().uuid().nullable().optional(),
  documentId: z.string().uuid().nullable().optional(),
  reproductionCycleId: z.string().uuid().nullable().optional(),
  clutchId: z.string().uuid().nullable().optional(),
  offspringBatchId: z.string().uuid().nullable().optional(),
}).strict().refine((value) => Object.keys(value).length > 0, "At least one field is required");

const financeBudgetInput = z.object({
  period: z.enum(["month", "year"]), periodStart: z.string().regex(/^\d{4}-\d{2}-01$/),
  category: z.string().trim().min(1).max(80).default("all"),
  amountCents: z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  currency: z.string().trim().length(3).default("EUR").transform((v) => v.toUpperCase()),
}).strict();
const financeRecurrenceInput = z.object({
  entryType, amountCents: z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  currency: z.string().trim().length(3).default("EUR").transform((v) => v.toUpperCase()),
  category: z.string().trim().min(1).max(80), description: z.string().trim().min(1).max(240),
  animalId: z.string().uuid().nullable().optional(), documentId: z.string().uuid().nullable().optional(),
  frequency: z.enum(["monthly", "yearly"]), nextOccurrenceOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
}).strict();
const financeRecurrencePatch = z.object({
  amountCents: z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
  category: z.string().trim().min(1).max(80).optional(), description: z.string().trim().min(1).max(240).optional(),
  frequency: z.enum(["monthly", "yearly"]).optional(), nextOccurrenceOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  endOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(), isActive: z.boolean().optional(),
}).strict().refine((v) => Object.keys(v).length > 0, "At least one field is required");

function serializeFinance<T extends { amountCents: bigint }>(entry: T) {
  return { ...entry, amountCents: entry.amountCents.toString() };
}

function addFinancePeriod(date: Date, frequency: "monthly" | "yearly", anchorDay: number, anchorMonth: number): Date {
  const targetYear = frequency === "yearly" ? date.getUTCFullYear() + 1 : date.getUTCFullYear() + (date.getUTCMonth() === 11 ? 1 : 0);
  const targetMonth = frequency === "yearly" ? anchorMonth - 1 : (date.getUTCMonth() + 1) % 12;
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  return new Date(Date.UTC(targetYear, targetMonth, Math.min(anchorDay, lastDay)));
}
function financeDateString(date: Date): string { return date.toISOString().slice(0, 10); }
function csvCell(value: unknown): string {
  let text = value == null ? "" : String(value);
  if (/^[=+@\-\t\r]/.test(text)) text = "'" + text;
  return '"' + text.replace(/"/g, '""') + '"';
}

function parseTime(value: string | null | undefined): Date | null {
  if (!value) return null;
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) throw new AppError(400, "VALIDATION_ERROR", "Time must use HH:MM");
  return new Date(`1970-01-01T${value}:00.000Z`);
}
function timeString(value: Date | null): string | null {
  return value ? value.toISOString().slice(11, 16) : null;
}

export function createFinanceRouter() {
  const router = Router();

  router.get("/finance/entries", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    const query = parseBody(z.object({
      page: z.coerce.number().int().min(1).default(1),
      pageSize: z.coerce.number().int().min(1).max(100).default(25),
      entryType: entryType.optional(),
      category: z.string().trim().max(80).optional(),
      q: z.string().trim().max(160).optional(),
      from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      animalId: z.string().uuid().optional(),
    }), req.query);
    if (query.from && query.to && query.to < query.from) throw new AppError(400, "VALIDATION_ERROR", "End date cannot precede start date");
    if (query.animalId) {
      const animal = await prisma.animal.findFirst({ where: { id: query.animalId, userId: auth.userId }, select: { id: true } });
      if (!animal) throw new AppError(404, "ANIMAL_NOT_FOUND", "Animal not found");
    }
    const searchFilters: Array<Record<string, unknown>> = [];
    if (query.q) {
      searchFilters.push(
        { description: { contains: query.q, mode: "insensitive" } },
        { category: { contains: query.q, mode: "insensitive" } },
      );
      const searchType = query.q.toLowerCase();
      if (searchType === "income" || searchType === "expense") searchFilters.push({ entryType: searchType });
      if (/^\\d{4}-\\d{2}-\\d{2}$/.test(query.q)) {
        const dateCandidate = new Date(`${query.q}T00:00:00.000Z`);
        if (!Number.isNaN(dateCandidate.getTime()) && dateCandidate.toISOString().slice(0, 10) === query.q) {
          searchFilters.push({ occurredOn: dateCandidate });
        }
      }
      const amountText = query.q.replace(/^€\\s*/u, "").replace(",", ".");
      if (/^\\d+(?:\\.\\d{1,2})?$/.test(amountText)) {
        const cents = Math.round(Number(amountText) * 100);
        if (Number.isSafeInteger(cents) && cents > 0) searchFilters.push({ amountCents: BigInt(cents) });
      }
    }
    const where = {
      userId: auth.userId,
      ...(query.entryType ? { entryType: query.entryType } : {}),
      ...(query.category ? { category: query.category } : {}),
      ...(query.animalId ? { animalId: query.animalId } : {}),
      ...(query.from || query.to ? { occurredOn: { ...(query.from ? { gte: validDate(query.from) } : {}), ...(query.to ? { lte: validDate(query.to) } : {}) } } : {}),
      ...(searchFilters.length ? { OR: searchFilters } : {}),
    };
    const [total, entries] = await Promise.all([
      prisma.financeEntry.count({ where }),
      prisma.financeEntry.findMany({
        where, orderBy: [{ occurredOn: "desc" }, { createdAt: "desc" }],
        skip: (query.page - 1) * query.pageSize, take: query.pageSize,
        include: { animal: { select: { id: true, name: true, identifier: true } }, document: { select: { id: true, originalFilename: true, deletedAt: true } } },
      }),
    ]);
    res.status(200).json({ entries: entries.map(serializeFinance), pagination: { page: query.page, pageSize: query.pageSize, total, totalPages: Math.ceil(total / query.pageSize) } });
  });

  router.post("/finance/entries", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    const input = parseBody(financeInput, req.body);
    const date = validDate(input.occurredOn);
    if (input.animalId) {
      const animal = await prisma.animal.findFirst({ where: { id: input.animalId, userId: auth.userId }, select: { id: true } });
      if (!animal) throw new AppError(404, "ANIMAL_NOT_FOUND", "Animal not found");
    }
    if (input.documentId) {
      const document = await prisma.document.findFirst({ where: { id: input.documentId, userId: auth.userId, deletedAt: null }, select: { id: true } });
      if (!document) throw new AppError(404, "DOCUMENT_NOT_FOUND", "Document not found");
    }

    let linkedCycleId = input.reproductionCycleId ?? null;
    let linkedClutchId = input.clutchId ?? null;
    let linkedBatchId = input.offspringBatchId ?? null;
    if (linkedCycleId) {
      const cycle = await prisma.reproductionCycle.findFirst({ where: { id: linkedCycleId, userId: auth.userId }, select: { id: true } });
      if (!cycle) throw new AppError(404, "REPRODUCTION_CYCLE_NOT_FOUND", "Reproduction cycle not found");
    }
    if (linkedClutchId) {
      const clutch = await prisma.clutch.findFirst({ where: { id: linkedClutchId, cycle: { userId: auth.userId } }, select: { id: true, cycleId: true } });
      if (!clutch) throw new AppError(404, "CLUTCH_NOT_FOUND", "Clutch not found in this account");
      if (linkedCycleId && clutch.cycleId !== linkedCycleId) throw new AppError(400, "FINANCE_LINK_SCOPE_INVALID", "Clutch and finance entry must belong to the same cycle");
      linkedCycleId ??= clutch.cycleId;
    }
    if (linkedBatchId) {
      const batch = await prisma.offspringBatch.findFirst({ where: { id: linkedBatchId, cycle: { userId: auth.userId } }, select: { id: true, cycleId: true, clutchId: true } });
      if (!batch) throw new AppError(404, "OFFSPRING_BATCH_NOT_FOUND", "Offspring batch not found in this account");
      if (linkedCycleId && batch.cycleId !== linkedCycleId) throw new AppError(400, "FINANCE_LINK_SCOPE_INVALID", "Offspring batch and finance entry must belong to the same cycle");
      if (linkedClutchId && batch.clutchId !== linkedClutchId) throw new AppError(400, "FINANCE_LINK_SCOPE_INVALID", "Offspring batch and selected clutch do not match");
      linkedCycleId ??= batch.cycleId;
      linkedClutchId ??= batch.clutchId;
    }
    const entry = await prisma.$transaction(async (tx) => {
      const created = await tx.financeEntry.create({
        data: {
          userId: auth.userId, entryType: input.entryType, occurredOn: date, amountCents: BigInt(input.amountCents),
          currency: input.currency, category: input.category, description: input.description,
          animalId: input.animalId ?? null, documentId: input.documentId ?? null,
          reproductionCycleId: linkedCycleId, clutchId: linkedClutchId, offspringBatchId: linkedBatchId,
        },
      });
      await tx.auditEvent.create({ data: { userId: auth.userId, action: "finance_entry.created", entityType: "finance_entry", entityId: created.id } });
      return created;
    });
    res.status(201).json({ entry: serializeFinance(entry) });
  });

  router.patch("/finance/entries/:id", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    const id = routeUuid(req.params.id, "finance entry id");
    const input = parseBody(financePatch, req.body);
    const existing = await prisma.financeEntry.findFirst({ where: { id, userId: auth.userId } });
    if (!existing) throw new AppError(404, "FINANCE_ENTRY_NOT_FOUND", "Finance entry not found");
    if (input.animalId) {
      const animal = await prisma.animal.findFirst({ where: { id: input.animalId, userId: auth.userId }, select: { id: true } });
      if (!animal) throw new AppError(404, "ANIMAL_NOT_FOUND", "Animal not found");
    }
    if (input.documentId) {
      const document = await prisma.document.findFirst({ where: { id: input.documentId, userId: auth.userId, deletedAt: null }, select: { id: true } });
      if (!document) throw new AppError(404, "DOCUMENT_NOT_FOUND", "Document not found");
    }
    const data: Record<string, unknown> = { ...input };
    if (input.occurredOn) data.occurredOn = validDate(input.occurredOn);
    if (input.amountCents !== undefined) data.amountCents = BigInt(input.amountCents);
    const effectiveCycleId = input.reproductionCycleId !== undefined ? input.reproductionCycleId : existing.reproductionCycleId;
    const effectiveClutchId = input.clutchId !== undefined ? input.clutchId : existing.clutchId;
    const effectiveBatchId = input.offspringBatchId !== undefined ? input.offspringBatchId : existing.offspringBatchId;
    if (input.reproductionCycleId === null && (effectiveClutchId || effectiveBatchId)) {
      throw new AppError(400, "FINANCE_LINK_SCOPE_INVALID", "A clutch or offspring batch requires its reproduction cycle");
    }
    if (effectiveCycleId) {
      const cycle = await prisma.reproductionCycle.findFirst({ where: { id: effectiveCycleId, userId: auth.userId }, select: { id: true } });
      if (!cycle) throw new AppError(404, "REPRODUCTION_CYCLE_NOT_FOUND", "Reproduction cycle not found");
    }
    let clutchCycleId: string | null = null;
    if (effectiveClutchId) {
      const clutch = await prisma.clutch.findFirst({ where: { id: effectiveClutchId, cycle: { userId: auth.userId } }, select: { id: true, cycleId: true } });
      if (!clutch) throw new AppError(404, "CLUTCH_NOT_FOUND", "Clutch not found in this account");
      clutchCycleId = clutch.cycleId;
      if (effectiveCycleId && clutch.cycleId !== effectiveCycleId) throw new AppError(400, "FINANCE_LINK_SCOPE_INVALID", "Clutch and finance entry must belong to the same cycle");
      if (!effectiveCycleId && input.reproductionCycleId === undefined) data.reproductionCycleId = clutch.cycleId;
    }
    if (effectiveBatchId) {
      const batch = await prisma.offspringBatch.findFirst({ where: { id: effectiveBatchId, cycle: { userId: auth.userId } }, select: { id: true, cycleId: true, clutchId: true } });
      if (!batch) throw new AppError(404, "OFFSPRING_BATCH_NOT_FOUND", "Offspring batch not found in this account");
      const expectedCycleId = effectiveCycleId ?? clutchCycleId;
      if (expectedCycleId && batch.cycleId !== expectedCycleId) throw new AppError(400, "FINANCE_LINK_SCOPE_INVALID", "Offspring batch and finance entry must belong to the same cycle");
      if (effectiveClutchId && batch.clutchId !== effectiveClutchId) throw new AppError(400, "FINANCE_LINK_SCOPE_INVALID", "Offspring batch and selected clutch do not match");
      if (!effectiveCycleId && input.reproductionCycleId === undefined) data.reproductionCycleId = batch.cycleId;
      if (!effectiveClutchId && input.clutchId === undefined && batch.clutchId) data.clutchId = batch.clutchId;
    }
    if (input.reproductionCycleId !== undefined) data.reproductionCycleId = input.reproductionCycleId;
    if (input.clutchId !== undefined) data.clutchId = input.clutchId;
    if (input.offspringBatchId !== undefined) data.offspringBatchId = input.offspringBatchId;
    const entry = await prisma.financeEntry.update({ where: { id }, data: data as never });
    res.status(200).json({ entry: serializeFinance(entry) });
  });

  router.delete("/finance/entries/:id", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    const id = routeUuid(req.params.id, "finance entry id");
    const existing = await prisma.financeEntry.findFirst({ where: { id, userId: auth.userId }, select: { id: true } });
    if (!existing) throw new AppError(404, "FINANCE_ENTRY_NOT_FOUND", "Finance entry not found");
    await prisma.financeEntry.delete({ where: { id } });
    res.status(204).send();
  });

  router.get("/finance/summary", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    const query = parseBody(z.object({
      from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      currency: z.string().trim().length(3).default("EUR").transform((v) => v.toUpperCase()),
    }), req.query);
    if (query.from && query.to && query.to < query.from) throw new AppError(400, "VALIDATION_ERROR", "End date cannot precede start date");
    const where = {
      userId: auth.userId, currency: query.currency,
      ...(query.from || query.to ? { occurredOn: { ...(query.from ? { gte: validDate(query.from) } : {}), ...(query.to ? { lte: validDate(query.to) } : {}) } } : {}),
    };
    const rows = await prisma.financeEntry.groupBy({
      by: ["entryType", "category"], where, _sum: { amountCents: true }, _count: { _all: true },
      orderBy: [{ entryType: "asc" }, { category: "asc" }],
    });
    let income = 0n;
    let expense = 0n;
    const categories = rows.map((row) => {
      const amount = row._sum.amountCents ?? 0n;
      if (row.entryType === "income") income += amount; else expense += amount;
      return { entryType: row.entryType, category: row.category, amountCents: amount.toString(), count: row._count._all };
    });
    res.status(200).json({ currency: query.currency, from: query.from ?? null, to: query.to ?? null, incomeCents: income.toString(), expenseCents: expense.toString(), balanceCents: (income - expense).toString(), categories });
  });


  router.get("/finance/budgets", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    const query = parseBody(z.object({
      period: z.enum(["month", "year"]).default("month"),
      year: z.coerce.number().int().min(2000).max(2200).default(new Date().getUTCFullYear()),
      month: z.coerce.number().int().min(1).max(12).default(new Date().getUTCMonth() + 1),
      currency: z.string().trim().length(3).default("EUR").transform((v) => v.toUpperCase()),
    }), req.query);
    const start = new Date(Date.UTC(query.year, query.period === "month" ? query.month - 1 : 0, 1));
    const end = new Date(Date.UTC(query.year, query.period === "month" ? query.month : 12, 0));
    const budgets = await prisma.financeBudget.findMany({ where: { userId: auth.userId, period: query.period, periodStart: start, currency: query.currency }, orderBy: { category: "asc" } });
    const actuals = await prisma.financeEntry.groupBy({
      by: ["category"], where: { userId: auth.userId, entryType: "expense", currency: query.currency, occurredOn: { gte: start, lte: end } },
      _sum: { amountCents: true },
    });
    const allSpent = actuals.reduce((sum, item) => sum + (item._sum.amountCents ?? 0n), 0n);
    res.status(200).json({ period: query.period, periodStart: financeDateString(start), from: financeDateString(start), to: financeDateString(end), currency: query.currency,
      budgets: budgets.map((budget) => ({ ...budget, amountCents: budget.amountCents.toString(), spentCents: (budget.category === "all" ? allSpent : actuals.find((item) => item.category === budget.category)?._sum.amountCents ?? 0n).toString() })) });
  });

  router.post("/finance/budgets", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    const input = parseBody(financeBudgetInput, req.body);
    const date = validDate(input.periodStart);
    if ((input.period === "year" && date.getUTCMonth() !== 0) || (input.period === "month" && date.getUTCDate() !== 1)) throw new AppError(400, "VALIDATION_ERROR", "Budget period must start on the first day of its period");
    const budget = await prisma.financeBudget.upsert({
      where: { userId_period_periodStart_category_currency: { userId: auth.userId, period: input.period, periodStart: date, category: input.category, currency: input.currency } },
      create: { userId: auth.userId, ...input, periodStart: date, amountCents: BigInt(input.amountCents) },
      update: { amountCents: BigInt(input.amountCents) },
    });
    res.status(200).json({ budget: { ...budget, amountCents: budget.amountCents.toString() } });
  });

  router.delete("/finance/budgets/:id", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    const id = routeUuid(req.params.id, "budget id");
    const result = await prisma.financeBudget.deleteMany({ where: { id, userId: auth.userId } });
    if (!result.count) throw new AppError(404, "FINANCE_BUDGET_NOT_FOUND", "Budget not found");
    res.status(204).send();
  });

  router.get("/finance/recurrences", requireSession, async (_req, res) => {
    const auth = res.locals.auth as AuthContext;
    const recurrences = await prisma.financeRecurrence.findMany({ where: { userId: auth.userId }, orderBy: [{ isActive: "desc" }, { nextOccurrenceOn: "asc" }] });
    res.status(200).json({ recurrences: recurrences.map((item) => ({ ...item, amountCents: item.amountCents.toString() })) });
  });

  router.post("/finance/recurrences", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    const input = parseBody(financeRecurrenceInput, req.body);
    const next = validDate(input.nextOccurrenceOn);
    const end = input.endOn ? validDate(input.endOn) : null;
    if (end && end < next) throw new AppError(400, "VALIDATION_ERROR", "End date cannot precede the next occurrence");
    if (input.animalId && !await prisma.animal.findFirst({ where: { id: input.animalId, userId: auth.userId }, select: { id: true } })) throw new AppError(404, "ANIMAL_NOT_FOUND", "Animal not found");
    if (input.documentId && !await prisma.document.findFirst({ where: { id: input.documentId, userId: auth.userId, deletedAt: null }, select: { id: true } })) throw new AppError(404, "DOCUMENT_NOT_FOUND", "Document not found");
    const recurrence = await prisma.financeRecurrence.create({ data: { userId: auth.userId, ...input, nextOccurrenceOn: next, anchorMonth: next.getUTCMonth() + 1, anchorDay: next.getUTCDate(), endOn: end, amountCents: BigInt(input.amountCents), animalId: input.animalId ?? null, documentId: input.documentId ?? null } });
    res.status(201).json({ recurrence: { ...recurrence, amountCents: recurrence.amountCents.toString() } });
  });

  router.patch("/finance/recurrences/:id", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    const id = routeUuid(req.params.id, "recurrence id");
    const input = parseBody(financeRecurrencePatch, req.body);
    const existing = await prisma.financeRecurrence.findFirst({ where: { id, userId: auth.userId } });
    if (!existing) throw new AppError(404, "FINANCE_RECURRENCE_NOT_FOUND", "Recurrence not found");
    const data: Record<string, unknown> = { ...input };
    if (input.amountCents !== undefined) data.amountCents = BigInt(input.amountCents);
    const effectiveNext = input.nextOccurrenceOn ? validDate(input.nextOccurrenceOn) : existing.nextOccurrenceOn;
    const effectiveEnd = input.endOn !== undefined ? (input.endOn ? validDate(input.endOn) : null) : existing.endOn;
    if (effectiveEnd && effectiveEnd < effectiveNext) throw new AppError(400, "VALIDATION_ERROR", "End date cannot precede the next occurrence");
    if (input.nextOccurrenceOn) {
      data.nextOccurrenceOn = effectiveNext;
      data.anchorMonth = effectiveNext.getUTCMonth() + 1;
      data.anchorDay = effectiveNext.getUTCDate();
    }
    if (input.endOn !== undefined) data.endOn = effectiveEnd;
    const recurrence = await prisma.financeRecurrence.update({ where: { id }, data: data as never });
    res.status(200).json({ recurrence: { ...recurrence, amountCents: recurrence.amountCents.toString() } });
  });

  router.delete("/finance/recurrences/:id", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    const id = routeUuid(req.params.id, "recurrence id");
    const result = await prisma.financeRecurrence.deleteMany({ where: { id, userId: auth.userId } });
    if (!result.count) throw new AppError(404, "FINANCE_RECURRENCE_NOT_FOUND", "Recurrence not found");
    res.status(204).send();
  });

  router.post("/finance/recurrences/:id/generate", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    const id = routeUuid(req.params.id, "recurrence id");
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const result = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM finance_recurrences WHERE id = ${id}::uuid AND user_id = ${auth.userId}::uuid FOR UPDATE`;
      const recurrence = await tx.financeRecurrence.findFirst({ where: { id, userId: auth.userId } });
      if (!recurrence) throw new AppError(404, "FINANCE_RECURRENCE_NOT_FOUND", "Recurrence not found");
      if (!recurrence.isActive) return { generated: 0, nextOccurrenceOn: financeDateString(recurrence.nextOccurrenceOn), isActive: false };
      let next = recurrence.nextOccurrenceOn;
      let generated = 0;
      while (next <= today && (!recurrence.endOn || next <= recurrence.endOn) && generated < 36) {
        await tx.financeEntry.create({ data: {
          userId: auth.userId, entryType: recurrence.entryType, occurredOn: next, amountCents: recurrence.amountCents,
          currency: recurrence.currency, category: recurrence.category, description: recurrence.description,
          animalId: recurrence.animalId, documentId: recurrence.documentId, recurrenceId: recurrence.id,
        } });
        next = addFinancePeriod(next, recurrence.frequency as "monthly" | "yearly", recurrence.anchorDay, recurrence.anchorMonth);
        generated++;
      }
      const isActive = !recurrence.endOn || next <= recurrence.endOn;
      await tx.financeRecurrence.update({ where: { id }, data: { nextOccurrenceOn: next, isActive } });
      return { generated, nextOccurrenceOn: financeDateString(next), isActive };
    });
    res.status(200).json(result);
  });

  router.get("/finance/profitability", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    const query = parseBody(z.object({
      from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      currency: z.string().trim().length(3).default("EUR").transform((v) => v.toUpperCase()),
    }), req.query);
    if (query.from && query.to && query.to < query.from) throw new AppError(400, "VALIDATION_ERROR", "End date cannot precede start date");
    const where = { userId: auth.userId, currency: query.currency, ...(query.from || query.to ? { occurredOn: { ...(query.from ? { gte: validDate(query.from) } : {}), ...(query.to ? { lte: validDate(query.to) } : {}) } } : {}) };
    const [totals, animals, cycles, clutches, batches] = await Promise.all([
      prisma.financeEntry.groupBy({ by: ["entryType"], where, _sum: { amountCents: true } }),
      prisma.financeEntry.groupBy({ by: ["animalId", "entryType"], where: { ...where, animalId: { not: null } }, _sum: { amountCents: true } }),
      prisma.financeEntry.groupBy({ by: ["reproductionCycleId", "entryType"], where: { ...where, reproductionCycleId: { not: null } }, _sum: { amountCents: true } }),
      prisma.financeEntry.groupBy({ by: ["clutchId", "entryType"], where: { ...where, clutchId: { not: null } }, _sum: { amountCents: true } }),
      prisma.financeEntry.groupBy({ by: ["offspringBatchId", "entryType"], where: { ...where, offspringBatchId: { not: null } }, _sum: { amountCents: true } }),
    ]);
    const income = totals.find((row) => row.entryType === "income")?._sum.amountCents ?? 0n;
    const expense = totals.find((row) => row.entryType === "expense")?._sum.amountCents ?? 0n;
    function mergeGroups<T extends { entryType: string; _sum: { amountCents: bigint | null } }>(rows: T[], key: (row: T) => string | null) {
      const map = new Map<string, { income: bigint; expense: bigint }>();
      for (const row of rows) {
        const id = key(row); if (!id) continue;
        const current = map.get(id) ?? { income: 0n, expense: 0n };
        if (row.entryType === "income") current.income += row._sum.amountCents ?? 0n; else current.expense += row._sum.amountCents ?? 0n;
        map.set(id, current);
      }
      return [...map].map(([id, value]) => ({ id, incomeCents: value.income.toString(), expenseCents: value.expense.toString(), marginCents: (value.income - value.expense).toString() }));
    }
    const animalMargins = mergeGroups(animals, (row) => row.animalId);
    const cycleMargins = mergeGroups(cycles, (row) => row.reproductionCycleId);
    const clutchMargins = mergeGroups(clutches, (row) => row.clutchId);
    const batchMargins = mergeGroups(batches, (row) => row.offspringBatchId);
    const [animalLabels, cycleLabels, clutchLabels, batchLabels] = await Promise.all([
      animalMargins.length ? prisma.animal.findMany({ where: { id: { in: animalMargins.map((row) => row.id) }, userId: auth.userId }, select: { id: true, name: true, identifier: true } }) : Promise.resolve([]),
      cycleMargins.length ? prisma.reproductionCycle.findMany({ where: { id: { in: cycleMargins.map((row) => row.id) }, userId: auth.userId }, select: { id: true, name: true, startedOn: true } }) : Promise.resolve([]),
      clutchMargins.length ? prisma.clutch.findMany({ where: { id: { in: clutchMargins.map((row) => row.id) }, cycle: { userId: auth.userId } }, select: { id: true, laidOn: true } }) : Promise.resolve([]),
      batchMargins.length ? prisma.offspringBatch.findMany({ where: { id: { in: batchMargins.map((row) => row.id) }, cycle: { userId: auth.userId } }, select: { id: true, bornOn: true, count: true } }) : Promise.resolve([]),
    ]);
    const animalById = new Map(animalLabels.map((item) => [item.id, item]));
    const cycleById = new Map(cycleLabels.map((item) => [item.id, item]));
    const clutchById = new Map(clutchLabels.map((item) => [item.id, item]));
    const batchById = new Map(batchLabels.map((item) => [item.id, item]));
    res.status(200).json({
      currency: query.currency, from: query.from ?? null, to: query.to ?? null,
      incomeCents: income.toString(), expenseCents: expense.toString(), marginCents: (income - expense).toString(),
      animals: animalMargins.map((row) => ({ ...row, name: animalById.get(row.id)?.name ?? row.id, identifier: animalById.get(row.id)?.identifier ?? null })),
      reproductionCycles: cycleMargins.map((row) => ({ ...row, name: cycleById.get(row.id)?.name ?? null, startedOn: financeDateString(cycleById.get(row.id)!.startedOn) })),
      clutches: clutchMargins.map((row) => ({ ...row, laidOn: financeDateString(clutchById.get(row.id)!.laidOn) })),
      offspringBatches: batchMargins.map((row) => ({ ...row, bornOn: financeDateString(batchById.get(row.id)!.bornOn), count: batchById.get(row.id)!.count })),
    });
  });

  router.get("/finance/export.csv", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    const query = parseBody(z.object({
      from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      currency: z.string().trim().length(3).default("EUR").transform((v) => v.toUpperCase()),
    }), req.query);
    if (query.from && query.to && query.to < query.from) throw new AppError(400, "VALIDATION_ERROR", "End date cannot precede start date");
    const where = { userId: auth.userId, currency: query.currency, ...(query.from || query.to ? { occurredOn: { ...(query.from ? { gte: validDate(query.from) } : {}), ...(query.to ? { lte: validDate(query.to) } : {}) } } : {}) };
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="vivarqo-finanze-${query.from ?? "inizio"}-${query.to ?? "oggi"}.csv"`);
    res.setHeader("Cache-Control", "private, no-store");
    res.status(200);
    const header = ["date","type","amount_cents","currency","category","description","animal_id","reproduction_cycle_id","clutch_id","offspring_batch_id","document_id"];
    res.write("\uFEFF" + header.map(csvCell).join(";") + "\r\n");
    let cursorId: string | undefined;
    while (!res.writableEnded) {
      const batch = await prisma.financeEntry.findMany({
        where, orderBy: [{ occurredOn: "asc" }, { createdAt: "asc" }, { id: "asc" }],
        take: 1000, ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {}),
      });
      if (!batch.length) break;
      for (const entry of batch) {
        const line = [
          financeDateString(entry.occurredOn), entry.entryType, entry.amountCents.toString(), entry.currency, entry.category, entry.description,
          entry.animalId, entry.reproductionCycleId, entry.clutchId, entry.offspringBatchId, entry.documentId,
        ].map(csvCell).join(";") + "\r\n";
        if (!res.write(line)) await new Promise<void>((resolve) => res.once("drain", resolve));
      }
      cursorId = batch[batch.length - 1]?.id;
      if (batch.length < 1000) break;
    }
    res.end();
  });

  return router;
}

export function createNotificationRouter() {
  const router = Router();


  router.get("/push-delivery-attempts", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    const query = parseBody(z.object({
      page: z.coerce.number().int().min(1).default(1),
      pageSize: z.coerce.number().int().min(1).max(100).default(25),
      status: z.enum(["queued", "processing", "retry_scheduled", "sent", "failed", "subscription_gone"]).optional(),
    }), req.query);
    const where = { userId: auth.userId, ...(query.status ? { status: query.status } : {}) };
    const [total, attempts] = await Promise.all([
      prisma.pushDeliveryAttempt.count({ where }),
      prisma.pushDeliveryAttempt.findMany({
        where, orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (query.page - 1) * query.pageSize, take: query.pageSize,
        select: {
          id: true, notificationId: true, pushSubscriptionId: true, deliveryKey: true,
          attemptNumber: true, status: true, scheduledAt: true, attemptedAt: true,
          sentAt: true, nextAttemptAt: true, httpStatus: true, errorCode: true, createdAt: true,
        },
      }),
    ]);
    res.setHeader("Cache-Control", "private, no-store");
    res.status(200).json({ attempts, pagination: { page: query.page, pageSize: query.pageSize, total, totalPages: Math.ceil(total / query.pageSize) } });
  });

  router.get("/push/public-key", (_req, res) => {
    res.status(200).json({ publicKey: getVapidPublicKey() });
  });


  router.get("/notifications", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    const query = parseBody(z.object({
      page: z.coerce.number().int().min(1).default(1),
      pageSize: z.coerce.number().int().min(1).max(100).default(25),
      unreadOnly: z.enum(["true", "false"]).default("false"),
      category: z.string().trim().max(30).optional(),
    }), req.query);
    const prefs = await prisma.notificationPreferences.findUnique({ where: { userId: auth.userId }, select: { inAppEnabled: true } });
    if (prefs?.inAppEnabled === false) {
      res.setHeader("Cache-Control", "private, no-store");
      res.status(200).json({ notifications: [], unreadCount: 0, pagination: { page: query.page, pageSize: query.pageSize, total: 0, totalPages: 0 } });
      return;
    }
    const where = { userId: auth.userId, ...(query.unreadOnly === "true" ? { readAt: null } : {}), ...(query.category ? { category: query.category } : {}) };
    const [total, unreadCount, notifications] = await Promise.all([
      prisma.notification.count({ where }),
      prisma.notification.count({ where: { userId: auth.userId, readAt: null } }),
      prisma.notification.findMany({ where, orderBy: { createdAt: "desc" }, skip: (query.page - 1) * query.pageSize, take: query.pageSize }),
    ]);
    res.setHeader("Cache-Control", "private, no-store");
    res.status(200).json({ notifications, unreadCount, pagination: { page: query.page, pageSize: query.pageSize, total, totalPages: Math.ceil(total / query.pageSize) } });
  });

  router.patch("/notifications/:id/read", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    const id = routeUuid(req.params.id, "notification id");
    const existing = await prisma.notification.findFirst({ where: { id, userId: auth.userId } });
    if (!existing) throw new AppError(404, "NOTIFICATION_NOT_FOUND", "Notification not found");
    const notification = existing.readAt ? existing : await prisma.notification.update({ where: { id }, data: { readAt: new Date() } });
    res.status(200).json({ notification });
  });

  router.post("/notifications/read-all", requireSession, async (_req, res) => {
    const auth = res.locals.auth as AuthContext;
    const result = await prisma.notification.updateMany({ where: { userId: auth.userId, readAt: null }, data: { readAt: new Date() } });
    res.status(200).json({ updatedCount: result.count });
  });

  router.get("/notification-preferences", requireSession, async (_req, res) => {
    const auth = res.locals.auth as AuthContext;
    // Concurrent page shells may request notification settings at the same time.
    // INSERT ... ON CONFLICT DO NOTHING avoids the create/create unique-key race
    // that can surface when an ORM upsert is emulated client-side.
    await prisma.notificationPreferences.createMany({
      data: [{ userId: auth.userId }],
      skipDuplicates: true,
    });
    const prefs = await prisma.notificationPreferences.findUniqueOrThrow({
      where: { userId: auth.userId },
    });
    res.status(200).json({
      preferences: {
        ...prefs,
        quietHoursStart: timeString(prefs.quietHoursStart),
        quietHoursEnd: timeString(prefs.quietHoursEnd),
      },
    });
  });

  router.patch("/notification-preferences", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    const input = parseBody(z.object({
      inAppEnabled: z.boolean().optional(),
      pushEnabled: z.boolean().optional(),
      categories: z.record(z.string().min(1).max(30), z.boolean()).optional(),
      quietHoursStart: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable().optional(),
      quietHoursEnd: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable().optional(),
    }).strict().refine((v) => Object.keys(v).length > 0, "At least one field is required"), req.body);
    if (input.pushEnabled === true) {
      const pushCount = await prisma.pushSubscription.count({ where: { userId: auth.userId } });
      if (pushCount === 0) throw new AppError(409, "PUSH_SUBSCRIPTION_REQUIRED", "Register a browser push subscription before enabling web push");
    }
    const data = {
      ...input,
      ...(input.quietHoursStart !== undefined ? { quietHoursStart: parseTime(input.quietHoursStart) } : {}),
      ...(input.quietHoursEnd !== undefined ? { quietHoursEnd: parseTime(input.quietHoursEnd) } : {}),
      ...(input.categories ? { categories: input.categories as never } : {}),
    };
    const prefs = await prisma.notificationPreferences.upsert({
      where: { userId: auth.userId },
      create: { userId: auth.userId, ...data } as never,
      update: data as never,
    });
    res.status(200).json({ preferences: { ...prefs, quietHoursStart: timeString(prefs.quietHoursStart), quietHoursEnd: timeString(prefs.quietHoursEnd) } });
  });


  router.get("/push-subscriptions", requireSession, async (_req, res) => {
    const auth = res.locals.auth as AuthContext;
    const subscriptions = await prisma.pushSubscription.findMany({
      where: { userId: auth.userId },
      orderBy: { createdAt: "desc" },
      select: { id: true, endpoint: true, userAgent: true, createdAt: true, lastSuccessAt: true },
    });
    res.setHeader("Cache-Control", "private, no-store");
    res.status(200).json({ subscriptions });
  });

  router.post("/push-subscriptions", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    const input = parseBody(z.object({
      endpoint: z.string().url().max(2048),
      keys: z.object({ p256dh: z.string().min(16).max(512), auth: z.string().min(8).max(256) }).strict(),
      userAgent: z.string().max(1000).nullable().optional(),
    }).strict(), req.body);
    if (!isSupportedPushEndpoint(input.endpoint)) {
      throw new AppError(400, "INVALID_PUSH_ENDPOINT", "Push endpoint must use a supported HTTPS push provider");
    }
    // Create first so two accounts racing to register the same endpoint cannot
    // reassign ownership through an upsert's unconditional update branch.
    let subscription;
    try {
      subscription = await prisma.pushSubscription.create({
        data: {
          userId: auth.userId,
          endpoint: input.endpoint,
          p256dh: input.keys.p256dh,
          authSecret: input.keys.auth,
          userAgent: input.userAgent ?? null,
        },
      });
    } catch (error) {
      const code = typeof error === "object" && error !== null && "code" in error
        ? (error as { code?: unknown }).code
        : undefined;
      if (code !== "P2002") throw error;

      const existing = await prisma.pushSubscription.findUnique({ where: { endpoint: input.endpoint } });
      if (!existing || existing.userId !== auth.userId) {
        throw new AppError(409, "PUSH_ENDPOINT_ALREADY_REGISTERED", "This browser endpoint is already associated with another account");
      }
      subscription = await prisma.pushSubscription.update({
        where: { id: existing.id, userId: auth.userId },
        data: { p256dh: input.keys.p256dh, authSecret: input.keys.auth, userAgent: input.userAgent ?? null },
      });
    }
    res.status(201).json({ subscription: { id: subscription.id, endpoint: subscription.endpoint, createdAt: subscription.createdAt } });
  });

  router.delete("/push-subscriptions/:id", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    const id = routeUuid(req.params.id, "push subscription id");
    const deleted = await prisma.pushSubscription.deleteMany({ where: { id, userId: auth.userId } });
    if (deleted.count === 0) throw new AppError(404, "PUSH_SUBSCRIPTION_NOT_FOUND", "Push subscription not found");
    res.status(204).send();
  });

  router.post("/notifications/test-push", requireSession, async (_req, res) => {
    const auth = res.locals.auth as AuthContext;
    // Validate configuration before persisting a test notification.
    getVapidPublicKey();
    const [preferences, subscriptionCount] = await Promise.all([
      prisma.notificationPreferences.findUnique({ where: { userId: auth.userId } }),
      prisma.pushSubscription.count({ where: { userId: auth.userId } }),
    ]);
    if (!preferences?.pushEnabled) throw new AppError(409, "PUSH_NOT_ENABLED", "Enable push notifications before sending a test");
    if (subscriptionCount === 0) throw new AppError(409, "PUSH_SUBSCRIPTION_REQUIRED", "Register a browser push subscription before sending a test");

    const notification = await prisma.notification.create({
      data: {
        userId: auth.userId,
        category: "system",
        title: auth.locale === "en" ? "Vivarqo notification test" : "Test notifiche Vivarqo",
        body: auth.locale === "en"
          ? "Push notifications are configured correctly."
          : "Le notifiche push sono configurate correttamente.",
        targetPath: "/settings/notifications",
      },
    });
    const delivery = await sendPushToUser(auth.userId, {
      title: notification.title,
      body: notification.body,
      url: notification.targetPath ?? "/settings/notifications",
      category: notification.category,
      notificationId: notification.id,
    });
    res.status(202).json({ notificationId: notification.id, delivery });
  });

  return router;
}
