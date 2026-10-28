import { Router } from "express";
import { AppError } from "../../errors/app-error.js";
import { prisma } from "../../db/prisma.js";
import { requireSession, type AuthContext } from "../auth/session.js";
import { calendarQuerySchema, parseBody } from "./operations.schemas.js";
import { addCalendarDays, localDateFor, localDayBounds } from "./time.js";

export function createHomeCalendarRouter() {
  const router = Router();

  router.get("/home/today", requireSession, async (_req, res) => {
    const auth = res.locals.auth as AuthContext;
    const now = new Date();
    const today = localDateFor(now, auth.timezone);
    const bounds = localDayBounds(today, auth.timezone);
    const reminderLimit = new Date(bounds.end.getTime() + 7 * 24 * 60 * 60 * 1000);

    const [
      dueToday,
      overdue,
      completedToday,
      reminders,
      recentFeedings,
      recentWeights,
      recentSheds,
      recentNotes,
      recentReproductionEvents,
      dueTodayCount,
      overdueCount,
      completedTodayCount,
      imminentReminderCount,
    ] = await Promise.all([
      prisma.task.findMany({
        where: { userId: auth.userId, status: "open", dueAt: { gte: now, lt: bounds.end } },
        orderBy: { dueAt: "asc" },
        take: 100,
        include: { animal: { select: { id: true, name: true, identifier: true } } },
      }),
      prisma.task.findMany({
        where: { userId: auth.userId, status: "open", dueAt: { lt: now } },
        orderBy: { dueAt: "asc" },
        take: 100,
        include: { animal: { select: { id: true, name: true, identifier: true } } },
      }),
      prisma.task.findMany({
        where: { userId: auth.userId, status: "completed", completedAt: { gte: bounds.start, lt: bounds.end } },
        orderBy: { completedAt: "desc" },
        take: 100,
        include: { animal: { select: { id: true, name: true, identifier: true } } },
      }),
      prisma.reminderRule.findMany({
        where: { userId: auth.userId, isEnabled: true, nextDueAt: { lt: reminderLimit } },
        orderBy: { nextDueAt: "asc" },
        take: 20,
        include: { animal: { select: { id: true, name: true, identifier: true } } },
      }),
      prisma.feedingSession.findMany({
        where: { userId: auth.userId, performedAt: { gte: new Date(bounds.start.getTime() - 7 * 86_400_000), lt: bounds.end } },
        orderBy: { performedAt: "desc" },
        take: 15,
        include: {
          entries: { where: { animal: { is: { userId: auth.userId } } }, include: { animal: { select: { id: true, name: true } } } },
        },
      }),
      prisma.weightMeasurement.findMany({
        where: { animal: { is: { userId: auth.userId } }, measuredAt: { gte: new Date(bounds.start.getTime() - 7 * 86_400_000), lt: bounds.end } },
        orderBy: { measuredAt: "desc" },
        take: 15,
        include: { animal: { select: { id: true, name: true } } },
      }),
      prisma.shedRecord.findMany({
        where: { animal: { is: { userId: auth.userId } }, occurredAt: { gte: new Date(bounds.start.getTime() - 7 * 86_400_000), lt: bounds.end } },
        orderBy: { occurredAt: "desc" },
        take: 15,
        include: { animal: { select: { id: true, name: true } } },
      }),
      prisma.animalNote.findMany({
        where: { archivedAt: null, animal: { is: { userId: auth.userId } }, occurredAt: { gte: new Date(bounds.start.getTime() - 7 * 86_400_000), lt: bounds.end } },
        orderBy: { occurredAt: "desc" },
        take: 15,
        include: { animal: { select: { id: true, name: true } } },
      }),
      prisma.reproductiveEvent.findMany({
        where: { cycle: { is: { userId: auth.userId } }, occurredAt: { gte: new Date(bounds.start.getTime() - 7 * 86_400_000), lt: bounds.end } },
        orderBy: { occurredAt: "desc" },
        take: 15,
        include: { cycle: { select: { id: true, name: true } }, animal: { select: { id: true, name: true } } },
      }),
      prisma.task.count({ where: { userId: auth.userId, status: "open", dueAt: { gte: now, lt: bounds.end } } }),
      prisma.task.count({ where: { userId: auth.userId, status: "open", dueAt: { lt: now } } }),
      prisma.task.count({ where: { userId: auth.userId, status: "completed", completedAt: { gte: bounds.start, lt: bounds.end } } }),
      prisma.reminderRule.count({ where: { userId: auth.userId, isEnabled: true, nextDueAt: { lt: reminderLimit } } }),
    ]);

    const recentEvents = [
      ...recentFeedings.map((item) => ({ type: "feeding" as const, occurredAt: item.performedAt, title: "Feeding session", targetPath: "/feeding", record: item })),
      ...recentWeights.map((item) => ({ type: "weight" as const, occurredAt: item.measuredAt, title: "Weight recorded", targetPath: `/animals/${item.animalId}`, record: item })),
      ...recentSheds.map((item) => ({ type: "shed" as const, occurredAt: item.occurredAt, title: "Shed recorded", targetPath: `/animals/${item.animalId}`, record: item })),
      ...recentNotes.map((item) => ({ type: "note" as const, occurredAt: item.occurredAt, title: item.title ?? "Animal note", targetPath: `/animals/${item.animalId}`, record: item })),
      ...recentReproductionEvents.map((item) => ({ type: "reproduction" as const, occurredAt: item.occurredAt, title: item.eventType, targetPath: `/reproduction-cycles/${item.cycleId}`, record: item })),
    ].sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime()).slice(0, 15);

    res.status(200).json({
      date: today,
      timezone: auth.timezone,
      tasks: { dueToday, overdue, completedToday },
      counts: {
        dueToday: dueTodayCount,
        overdue: overdueCount,
        completedToday: completedTodayCount,
        imminentReminders: imminentReminderCount,
      },
      truncated: {
        dueToday: dueTodayCount > dueToday.length,
        overdue: overdueCount > overdue.length,
        completedToday: completedTodayCount > completedToday.length,
        imminentReminders: imminentReminderCount > reminders.length,
      },
      imminentReminders: reminders,
      quickActions: [{ key: "bulk-feeding", label: "Register multiple feedings", targetPath: "/feeding/bulk" }],
      recentEvents,
    });
  });

  router.get("/calendar", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    const query = parseBody(calendarQuerySchema, req.query);
    if (query.to < query.from) throw new AppError(400, "VALIDATION_ERROR", "Calendar end date cannot precede the start date");
    const difference = (Date.parse(`${query.to}T00:00:00Z`) - Date.parse(`${query.from}T00:00:00Z`)) / 86_400_000;
    const maxDays = query.view === "week" ? 14 : query.view === "month" ? 62 : 93;
    if (difference > maxDays) {
      throw new AppError(400, "CALENDAR_RANGE_TOO_LARGE", `The ${query.view} view cannot span more than ${maxDays + 1} days`);
    }
    const from = localDayBounds(query.from, auth.timezone);
    const to = localDayBounds(addCalendarDays(query.to, 1), auth.timezone);
    const includeDismissed = query.includeDismissed === "true";

    const [tasks, reproductiveEvents, clutches] = await Promise.all([
      prisma.task.findMany({
        where: {
          userId: auth.userId,
          dueAt: { gte: from.start, lt: to.start },
          ...(includeDismissed ? {} : { status: { not: "dismissed" } }),
        },
        orderBy: { dueAt: "asc" },
        take: 500,
        include: { animal: { select: { id: true, name: true, identifier: true } } },
      }),
      prisma.reproductiveEvent.findMany({
        where: { cycle: { is: { userId: auth.userId } }, occurredAt: { gte: from.start, lt: to.start } },
        orderBy: { occurredAt: "asc" },
        take: 500,
        include: {
          cycle: { select: { id: true, name: true } },
          animal: { select: { id: true, name: true, identifier: true } },
        },
      }),
      prisma.clutch.findMany({
        where: {
          cycle: { is: { userId: auth.userId } },
          laidOn: { gte: new Date(`${query.from}T00:00:00.000Z`), lt: new Date(`${addCalendarDays(query.to, 1)}T00:00:00.000Z`) },
        },
        orderBy: { laidOn: "asc" },
        take: 200,
        include: { cycle: { select: { id: true, name: true } } },
      }),
    ]);

    // Compare clutches against a precomputed set instead of scanning all
    // reproductive events for every clutch (O(clutches × events)).
    const layingEventKeys = new Set(
      reproductiveEvents
        .filter((event) => event.eventType === "laying")
        .map((event) => JSON.stringify([
          event.cycleId,
          localDateFor(event.occurredAt, auth.timezone),
        ])),
    );
    const unmatchedClutches = clutches.filter((clutch) => !layingEventKeys.has(JSON.stringify([
      clutch.cycleId,
      new Date(clutch.laidOn).toISOString().slice(0, 10),
    ])));

    const items = [
      ...tasks.map((task) => ({
        id: task.id,
        type: "task" as const,
        title: task.title,
        start: task.dueAt,
        end: null,
        status: task.status,
        category: task.category,
        targetPath: `/tasks/${task.id}`,
        animal: task.animal,
        record: task,
      })),
      ...reproductiveEvents.map((event) => ({
        id: event.id,
        type: "reproduction" as const,
        title: event.eventType,
        start: event.occurredAt,
        end: null,
        status: "recorded",
        category: event.eventType,
        targetPath: `/reproduction-cycles/${event.cycleId}`,
        animal: event.animal,
        record: event,
      })),
      ...unmatchedClutches.map((clutch) => ({
        id: clutch.id,
        type: "clutch" as const,
        title: "Clutch laid",
        start: new Date(`${new Date(clutch.laidOn).toISOString().slice(0, 10)}T00:00:00.000Z`),
        end: null,
        status: clutch.status,
        category: "laying",
        targetPath: `/clutches/${clutch.id}`,
        animal: null,
        record: clutch,
      })),
    ].sort((a, b) => a.start.getTime() - b.start.getTime());

    res.status(200).json({
      view: query.view,
      from: query.from,
      to: query.to,
      timezone: auth.timezone,
      items,
      count: items.length,
      truncated: tasks.length >= 500 || reproductiveEvents.length >= 500 || clutches.length >= 200,
    });
  });

  return router;
}
