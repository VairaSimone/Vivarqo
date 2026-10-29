import { Router } from "express";
import type { Response } from "express";
import { z } from "zod";
import { AppError } from "../../errors/app-error.js";
import { prisma } from "../../db/prisma.js";
import { requireSession, type AuthContext } from "../auth/session.js";
import {
  createReminderRuleSchema,
  createTaskSchema,
  parseBody,
  patchReminderRuleSchema,
  patchTaskSchema,
  reminderListQuerySchema,
  taskListQuerySchema,
} from "./operations.schemas.js";
import { addDaysAtLocalTime, localDateFor, parseDateBound } from "./time.js";

function requestId(res: Response): string {
  return typeof res.locals.requestId === "string" ? res.locals.requestId : "unknown";
}
function routeId(value: string | string[] | undefined, name: string): string {
  const id = Array.isArray(value) ? value[0] : value;
  if (!id || !z.string().uuid().safeParse(id).success) throw new AppError(400, "INVALID_ID", `Invalid ${name}`);
  return id;
}
async function assertOwnedAnimal(userId: string, animalId: string | null | undefined) {
  if (animalId == null) return;
  const animal = await prisma.animal.findFirst({ where: { id: animalId, userId } });
  if (!animal) throw new AppError(404, "ANIMAL_NOT_FOUND", "Animal not found");
  if (animal.status !== "active" || animal.archivedAt !== null) {
    throw new AppError(409, "ANIMAL_NOT_ACTIVE", "Tasks and reminders can only be associated with active animals");
  }
}

export function createTasksRouter() {
  const router = Router();

  router.get("/", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    const query = parseBody(taskListQuerySchema, req.query);
    const where: Record<string, unknown> = { userId: auth.userId };
    if (query.status !== "all") where.status = query.status;
    if (query.category) where.category = query.category;
    if (query.animalId) {
      const animal = await prisma.animal.findFirst({ where: { id: query.animalId, userId: auth.userId }, select: { id: true } });
      if (!animal) throw new AppError(404, "ANIMAL_NOT_FOUND", "Animal not found");
      where.animalId = query.animalId;
    }
    if (query.q) {
      where.OR = [
        { title: { contains: query.q, mode: "insensitive" } },
        { description: { contains: query.q, mode: "insensitive" } },
        { animal: { is: { name: { contains: query.q, mode: "insensitive" } } } },
        { animal: { is: { identifier: { contains: query.q, mode: "insensitive" } } } },
      ];
    }
    const from = parseDateBound(query.from, auth.timezone);
    const to = parseDateBound(query.to, auth.timezone, true);
    if (from || to) {
      const dueAt: Record<string, Date> = {};
      if (from) dueAt.gte = from;
      if (to) dueAt.lt = to;
      where.dueAt = dueAt;
    }
    const [total, tasks] = await Promise.all([
      prisma.task.count({ where: where as never }),
      prisma.task.findMany({
        where: where as never,
        orderBy: [{ dueAt: "asc" }, { createdAt: "desc" }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: {
          animal: { select: { id: true, name: true, identifier: true, species: true } },
          reminderRule: { select: { id: true, intervalDays: true, isEnabled: true } },
        },
      }),
    ]);
    res.status(200).json({
      tasks,
      pagination: { page: query.page, pageSize: query.pageSize, total, totalPages: Math.ceil(total / query.pageSize) },
    });
  });

  router.post("/", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    const input = parseBody(createTaskSchema, req.body);
    await assertOwnedAnimal(auth.userId, input.animalId);
    const task = await prisma.$transaction(async (tx) => {
      const created = await tx.task.create({
        data: {
          userId: auth.userId,
          title: input.title,
          description: input.description ?? null,
          category: input.category,
          dueAt: new Date(input.dueAt),
          animalId: input.animalId ?? null,
        },
      });
      await tx.auditEvent.create({
        data: { userId: auth.userId, action: "task.created", entityType: "task", entityId: created.id, requestId: requestId(res) },
      });
      return created;
    });
    res.status(201).json({ task });
  });

  router.patch("/:id", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    const id = routeId(req.params.id, "task id");
    const input = parseBody(patchTaskSchema, req.body);
    const existing = await prisma.task.findFirst({ where: { id, userId: auth.userId } });
    if (!existing) throw new AppError(404, "TASK_NOT_FOUND", "Task not found");
    if (existing.status === "completed" && ("status" in input || "dueAt" in input)) {
      throw new AppError(409, "TASK_ALREADY_COMPLETED", "Completed tasks are historical records and cannot be reopened or rescheduled");
    }
    if (input.animalId !== undefined) await assertOwnedAnimal(auth.userId, input.animalId);
    const data: Record<string, unknown> = { ...input };
    if (input.dueAt) data.dueAt = new Date(input.dueAt);
    const updated = await prisma.$transaction(async (tx) => {
      const task = await tx.task.update({ where: { id }, data: data as never });
      if (existing.reminderRuleId && input.dueAt && existing.status === "open") {
        await tx.reminderRule.updateMany({
          where: { id: existing.reminderRuleId, userId: auth.userId, isEnabled: true },
          data: { nextDueAt: new Date(input.dueAt) },
        });
      }
      await tx.auditEvent.create({
        data: { userId: auth.userId, action: "task.updated", entityType: "task", entityId: id, requestId: requestId(res), metadata: { fields: Object.keys(input) } },
      });
      return task;
    });
    res.status(200).json({ task: updated });
  });

  router.post("/:id/complete", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    const id = routeId(req.params.id, "task id");
    const now = new Date();
    const result = await prisma.$transaction(async (tx) => {
      const existing = await tx.task.findFirst({ where: { id, userId: auth.userId } });
      if (!existing) throw new AppError(404, "TASK_NOT_FOUND", "Task not found");
      if (existing.status !== "open") throw new AppError(409, "TASK_NOT_OPEN", "Only open tasks can be completed");

      const claimed = await tx.task.updateMany({
        where: { id, userId: auth.userId, status: "open" },
        data: { status: "completed", completedAt: now },
      });
      if (claimed.count !== 1) throw new AppError(409, "TASK_NOT_OPEN", "The task has already been completed or dismissed");

      let nextTask: unknown = null;
      let nextDueAt: Date | null = null;
      if (existing.reminderRuleId) {
        const rule = await tx.reminderRule.findFirst({
          where: { id: existing.reminderRuleId, userId: auth.userId, isEnabled: true },
        });
        if (rule) {
          nextDueAt = addDaysAtLocalTime(existing.dueAt, rule.intervalDays, auth.timezone);
          if (nextDueAt <= now) {
            // Jump over missed occurrences in one calculation instead of
            // running Intl.DateTimeFormat once per interval for old tasks.
            const nextLocalDate = localDateFor(nextDueAt, auth.timezone);
            const nowLocalDate = localDateFor(now, auth.timezone);
            const nextLocalMidnight = Date.parse(`${nextLocalDate}T00:00:00.000Z`);
            const nowLocalMidnight = Date.parse(`${nowLocalDate}T00:00:00.000Z`);
            const daysBehind = Math.max(0, Math.floor((nowLocalMidnight - nextLocalMidnight) / 86_400_000));
            const missedIntervals = Math.floor(daysBehind / rule.intervalDays);
            if (missedIntervals > 0) {
              nextDueAt = addDaysAtLocalTime(nextDueAt, missedIntervals * rule.intervalDays, auth.timezone);
            }
            if (nextDueAt <= now) {
              nextDueAt = addDaysAtLocalTime(nextDueAt, rule.intervalDays, auth.timezone);
            }
          }
          await tx.reminderRule.update({
            where: { id: rule.id },
            data: { nextDueAt },
          });
          nextTask = await tx.task.create({
            data: {
              userId: auth.userId,
              animalId: existing.animalId,
              title: rule.title,
              category: rule.category,
              description: existing.description,
              dueAt: nextDueAt,
              status: "open",
              reminderRuleId: rule.id,
            },
          });
        }
      }
      await tx.auditEvent.create({
        data: {
          userId: auth.userId,
          action: "task.completed",
          entityType: "task",
          entityId: id,
          requestId: requestId(res),
          metadata: nextTask ? { nextOccurrenceCreated: true } : { nextOccurrenceCreated: false },
        },
      });
      const task = await tx.task.findFirstOrThrow({
        where: { id, userId: auth.userId },
        include: { animal: { select: { id: true, name: true } } },
      });
      return { task, nextTask, nextDueAt };
    });
    res.status(200).json(result);
  });

  router.get("/reminder-rules", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    const query = parseBody(reminderListQuerySchema, req.query);
    const where: Record<string, unknown> = { userId: auth.userId };
    if (query.enabled !== "all") where.isEnabled = query.enabled === "true";
    const [total, rules] = await Promise.all([
      prisma.reminderRule.count({ where: where as never }),
      prisma.reminderRule.findMany({
        where: where as never,
        orderBy: [{ nextDueAt: "asc" }, { createdAt: "desc" }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: { animal: { select: { id: true, name: true, identifier: true } } },
      }),
    ]);
    res.status(200).json({
      reminderRules: rules,
      pagination: { page: query.page, pageSize: query.pageSize, total, totalPages: Math.ceil(total / query.pageSize) },
    });
  });

  router.post("/reminder-rules", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    const input = parseBody(createReminderRuleSchema, req.body);
    await assertOwnedAnimal(auth.userId, input.animalId);
    const result = await prisma.$transaction(async (tx) => {
      const rule = await tx.reminderRule.create({
        data: {
          userId: auth.userId,
          title: input.title,
          category: input.category,
          intervalDays: input.intervalDays,
          nextDueAt: new Date(input.nextDueAt),
          animalId: input.animalId ?? null,
          isEnabled: input.isEnabled,
        },
      });
      const task = input.isEnabled ? await tx.task.create({
        data: {
          userId: auth.userId,
          animalId: input.animalId ?? null,
          title: input.title,
          category: input.category,
          dueAt: new Date(input.nextDueAt),
          reminderRuleId: rule.id,
        },
      }) : null;
      await tx.auditEvent.create({
        data: { userId: auth.userId, action: "reminder_rule.created", entityType: "reminder_rule", entityId: rule.id, requestId: requestId(res) },
      });
      return { rule, task };
    });
    res.status(201).json(result);
  });

  router.patch("/reminder-rules/:id", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    const id = routeId(req.params.id, "reminder rule id");
    const input = parseBody(patchReminderRuleSchema, req.body);
    const existing = await prisma.reminderRule.findFirst({ where: { id, userId: auth.userId } });
    if (!existing) throw new AppError(404, "REMINDER_RULE_NOT_FOUND", "Reminder rule not found");
    if (input.animalId !== undefined) await assertOwnedAnimal(auth.userId, input.animalId);
    const result = await prisma.$transaction(async (tx) => {
      const rule = await tx.reminderRule.update({
        where: { id },
        data: {
          ...input,
          ...(input.nextDueAt ? { nextDueAt: new Date(input.nextDueAt) } : {}),
        } as never,
      });
      const openTask = await tx.task.findFirst({
        where: { userId: auth.userId, reminderRuleId: id, status: "open" },
        orderBy: { dueAt: "asc" },
      });
      if (!rule.isEnabled) {
        await tx.task.updateMany({
          where: { userId: auth.userId, reminderRuleId: id, status: "open" },
          data: { status: "dismissed" },
        });
      } else if (openTask) {
        await tx.task.update({
          where: { id: openTask.id },
          data: {
            title: rule.title,
            category: rule.category,
            dueAt: rule.nextDueAt,
            animalId: rule.animalId,
          },
        });
      } else {
        await tx.task.create({
          data: {
            userId: auth.userId,
            title: rule.title,
            category: rule.category,
            dueAt: rule.nextDueAt,
            animalId: rule.animalId,
            reminderRuleId: rule.id,
          },
        });
      }
      await tx.auditEvent.create({
        data: { userId: auth.userId, action: "reminder_rule.updated", entityType: "reminder_rule", entityId: id, requestId: requestId(res), metadata: { fields: Object.keys(input) } },
      });
      return rule;
    });
    res.status(200).json({ reminderRule: result });
  });

  router.delete("/reminder-rules/:id", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    const id = routeId(req.params.id, "reminder rule id");
    const existing = await prisma.reminderRule.findFirst({ where: { id, userId: auth.userId } });
    if (!existing) throw new AppError(404, "REMINDER_RULE_NOT_FOUND", "Reminder rule not found");
    const rule = await prisma.$transaction(async (tx) => {
      await tx.task.updateMany({
        where: { userId: auth.userId, reminderRuleId: id, status: "open" },
        data: { status: "dismissed" },
      });
      const disabled = await tx.reminderRule.update({ where: { id }, data: { isEnabled: false } });
      await tx.auditEvent.create({
        data: { userId: auth.userId, action: "reminder_rule.disabled", entityType: "reminder_rule", entityId: id, requestId: requestId(res) },
      });
      return disabled;
    });
    res.status(200).json({ reminderRule: rule });
  });


  router.delete("/:id", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    const id = routeId(req.params.id, "task id");
    const existing = await prisma.task.findFirst({ where: { id, userId: auth.userId }, select: { id: true } });
    if (!existing) throw new AppError(404, "TASK_NOT_FOUND", "Task not found");
    await prisma.$transaction(async (tx) => {
      await tx.task.delete({ where: { id } });
      await tx.auditEvent.create({
        data: { userId: auth.userId, action: "task.deleted", entityType: "task", entityId: id, requestId: requestId(res) },
      });
    });
    res.status(204).send();
  });

  router.get("/:id", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    const id = routeId(req.params.id, "task id");
    const task = await prisma.task.findFirst({
      where: { id, userId: auth.userId },
      include: { animal: true, reminderRule: { select: { id: true, intervalDays: true, isEnabled: true } } },
    });
    if (!task) throw new AppError(404, "TASK_NOT_FOUND", "Task not found");
    res.status(200).json({ task });
  });

  return router;
}
