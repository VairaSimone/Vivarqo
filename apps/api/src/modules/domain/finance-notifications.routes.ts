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
}).strict().refine((value) => Object.keys(value).length > 0, "At least one field is required");
function serializeFinance<T extends { amountCents: bigint }>(entry: T) {
  return { ...entry, amountCents: entry.amountCents.toString() };
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
      from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      animalId: z.string().uuid().optional(),
    }), req.query);
    if (query.from && query.to && query.to < query.from) throw new AppError(400, "VALIDATION_ERROR", "End date cannot precede start date");
    if (query.animalId) {
      const animal = await prisma.animal.findFirst({ where: { id: query.animalId, userId: auth.userId }, select: { id: true } });
      if (!animal) throw new AppError(404, "ANIMAL_NOT_FOUND", "Animal not found");
    }
    const where = {
      userId: auth.userId,
      ...(query.entryType ? { entryType: query.entryType } : {}),
      ...(query.category ? { category: query.category } : {}),
      ...(query.animalId ? { animalId: query.animalId } : {}),
      ...(query.from || query.to ? { occurredOn: { ...(query.from ? { gte: validDate(query.from) } : {}), ...(query.to ? { lte: validDate(query.to) } : {}) } } : {}),
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
    const entry = await prisma.$transaction(async (tx) => {
      const created = await tx.financeEntry.create({
        data: {
          userId: auth.userId, entryType: input.entryType, occurredOn: date, amountCents: BigInt(input.amountCents),
          currency: input.currency, category: input.category, description: input.description,
          animalId: input.animalId ?? null, documentId: input.documentId ?? null,
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

  return router;
}

export function createNotificationRouter() {
  const router = Router();

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
    const where = { userId: auth.userId, ...(query.unreadOnly === "true" ? { readAt: null } : {}), ...(query.category ? { category: query.category } : {}) };
    const [total, unreadCount, notifications] = await Promise.all([
      prisma.notification.count({ where }),
      prisma.notification.count({ where: { userId: auth.userId, readAt: null } }),
      prisma.notification.findMany({ where, orderBy: { createdAt: "desc" }, skip: (query.page - 1) * query.pageSize, take: query.pageSize }),
    ]);
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
    const prefs = await prisma.notificationPreferences.upsert({
      where: { userId: auth.userId },
      create: { userId: auth.userId },
      update: {},
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
        title: "Test notifiche Vivarqo",
        body: "Le notifiche push sono configurate correttamente.",
        targetPath: "/settings/notifications",
      },
    });
    const delivery = await sendPushToUser(auth.userId, {
      title: notification.title,
      body: notification.body,
      url: notification.targetPath ?? "/settings/notifications",
      category: notification.category,
    });
    res.status(200).json({ notificationId: notification.id, delivery });
  });

  return router;
}
