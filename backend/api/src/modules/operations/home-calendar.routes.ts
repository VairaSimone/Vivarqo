import { Router } from "express";
import { AppError } from "../../errors/app-error.js";
import { prisma } from "../../db/prisma.js";
import { requireSession, type AuthContext } from "../auth/session.js";
import { calendarQuerySchema, parseBody } from "./operations.schemas.js";
import { addCalendarDays, localDateFor, localDayBounds } from "./time.js";

export function createHomeCalendarRouter() {
  const router = Router();

  // Dashboard widgets are independent resources: a failure in inventory or
  // activity history must not prevent the task list from loading.
  router.get("/home/today/tasks", requireSession, async (_req, res) => {
    const auth = res.locals.auth as AuthContext;
    const now = new Date();
    const today = localDateFor(now, auth.timezone);
    const bounds = localDayBounds(today, auth.timezone);
    const nextWeekLimit = localDayBounds(addCalendarDays(today, 8), auth.timezone).start;
    const taskInclude = { animal: { select: { id: true, name: true, identifier: true, species: true, photoKey: true, updatedAt: true } }, reminderRule: { select: { id: true, intervalDays: true, nextDueAt: true, isEnabled: true } } };
    const [dueToday, overdue, completedToday, upcoming, dueTodayCount, overdueCount, completedTodayCount, upcomingCount] = await Promise.all([
      prisma.task.findMany({ where: { userId: auth.userId, status: "open", dueAt: { gte: now, lt: bounds.end } }, orderBy: { dueAt: "asc" }, take: 100, include: taskInclude }),
      prisma.task.findMany({ where: { userId: auth.userId, status: "open", dueAt: { lt: now } }, orderBy: { dueAt: "asc" }, take: 100, include: taskInclude }),
      prisma.task.findMany({ where: { userId: auth.userId, status: "completed", completedAt: { gte: bounds.start, lt: bounds.end } }, orderBy: { completedAt: "desc" }, take: 100, include: taskInclude }),
      prisma.task.findMany({ where: { userId: auth.userId, status: "open", dueAt: { gte: bounds.end, lt: nextWeekLimit } }, orderBy: { dueAt: "asc" }, take: 100, include: taskInclude }),
      prisma.task.count({ where: { userId: auth.userId, status: "open", dueAt: { gte: now, lt: bounds.end } } }),
      prisma.task.count({ where: { userId: auth.userId, status: "open", dueAt: { lt: now } } }),
      prisma.task.count({ where: { userId: auth.userId, status: "completed", completedAt: { gte: bounds.start, lt: bounds.end } } }),
      prisma.task.count({ where: { userId: auth.userId, status: "open", dueAt: { gte: bounds.end, lt: nextWeekLimit } } }),
    ]);
    const serialize = (task: typeof dueToday[number]) => {
      const { animal, reminderRule, ...fields } = task;
      return {
        ...fields,
        animal: animal ? { id: animal.id, name: animal.name, identifier: animal.identifier, species: animal.species, photoUrl: animal.photoKey ? `/api/v1/animals/${animal.id}/photo?v=${animal.updatedAt.getTime()}` : null } : null,
        recurrence: reminderRule ? { ruleId: reminderRule.id, intervalDays: reminderRule.intervalDays, nextDueAt: reminderRule.nextDueAt, enabled: reminderRule.isEnabled } : null,
      };
    };
    res.setHeader("Cache-Control", "private, no-store");
    res.status(200).json({
      date: today, timezone: auth.timezone,
      tasks: { dueToday: dueToday.map(serialize), overdue: overdue.map(serialize), completedToday: completedToday.map(serialize), upcoming: upcoming.map(serialize) },
      counts: { dueToday: dueTodayCount, overdue: overdueCount, completedToday: completedTodayCount, upcoming: upcomingCount },
      truncated: { dueToday: dueTodayCount > dueToday.length, overdue: overdueCount > overdue.length, completedToday: completedTodayCount > completedToday.length, upcoming: upcomingCount > upcoming.length },
    });
  });

  router.get("/home/today/reminders", requireSession, async (_req, res) => {
    const auth = res.locals.auth as AuthContext;
    const today = localDateFor(new Date(), auth.timezone);
    const nextWeekLimit = localDayBounds(addCalendarDays(today, 8), auth.timezone).start;
    const [items, count] = await Promise.all([
      prisma.reminderRule.findMany({ where: { userId: auth.userId, isEnabled: true, nextDueAt: { lt: nextWeekLimit } }, orderBy: { nextDueAt: "asc" }, take: 20, include: { animal: { select: { id: true, name: true, identifier: true } } } }),
      prisma.reminderRule.count({ where: { userId: auth.userId, isEnabled: true, nextDueAt: { lt: nextWeekLimit } } }),
    ]);
    res.setHeader("Cache-Control", "private, no-store");
    res.status(200).json({ items, count, truncated: count > items.length });
  });

  router.get("/home/today/feeding-alerts", requireSession, async (_req, res) => {
    const auth = res.locals.auth as AuthContext;
    const items = await prisma.$queryRaw<Array<{ id: string; name: string; identifier: string | null; species: string; lastMealAt: Date | null; daysSinceLastMeal: number; feedingIntervalDays: number; feedingStatus: "no_history" | "overdue" | "due_soon"; photoUrl: string | null }>>`
      SELECT a.id, a.name, a.identifier, a.species, last_meal.performed_at AS "lastMealAt",
        CASE WHEN last_meal.performed_at IS NULL THEN 0 ELSE FLOOR(EXTRACT(EPOCH FROM (NOW() - last_meal.performed_at)) / 86400)::int END AS "daysSinceLastMeal",
        a.feeding_interval_days AS "feedingIntervalDays",
        CASE WHEN last_meal.performed_at IS NULL THEN 'no_history'
          WHEN last_meal.performed_at < NOW() - (a.feeding_interval_days * INTERVAL '1 day') THEN 'overdue'
          ELSE 'due_soon' END AS "feedingStatus",
        CASE WHEN a.photo_key IS NULL THEN NULL ELSE '/api/v1/animals/' || a.id::text || '/photo?v=' || (EXTRACT(EPOCH FROM a.updated_at) * 1000)::bigint::text END AS "photoUrl"
      FROM animals a
      LEFT JOIN LATERAL (
        SELECT fs.performed_at FROM feeding_entries fe
        INNER JOIN feeding_sessions fs ON fs.id = fe.session_id
        WHERE fe.animal_id = a.id AND fe.outcome = 'ate'
        ORDER BY fs.performed_at DESC LIMIT 1
      ) last_meal ON TRUE
      WHERE a.user_id = ${auth.userId}::uuid AND a.status = 'active' AND a.feeding_interval_days IS NOT NULL
        AND (last_meal.performed_at IS NULL OR last_meal.performed_at <= NOW() - (a.feeding_interval_days * 0.8 * INTERVAL '1 day'))
      ORDER BY COALESCE(last_meal.performed_at, a.created_at) ASC LIMIT 100
    `;
    res.setHeader("Cache-Control", "private, no-store");
    res.status(200).json({ items });
  });

  router.get("/home/today/overview", requireSession, async (_req, res) => {
    const auth = res.locals.auth as AuthContext;
    const today = localDateFor(new Date(), auth.timezone);
    const bounds = localDayBounds(today, auth.timezone);
    const [activeAnimals, feedingsToday, lowStockItems, lowStockCount] = await Promise.all([
      prisma.animal.count({ where: { userId: auth.userId, status: "active" } }),
      prisma.feedingEntry.count({ where: { session: { is: { userId: auth.userId, performedAt: { gte: bounds.start, lt: bounds.end } } }, animal: { is: { userId: auth.userId } } } }),
      prisma.$queryRaw<Array<{ id: string; name: string; quantityOnHand: string; minimumQuantity: string; unit: string }>>`
        SELECT id, name, quantity_on_hand::text AS "quantityOnHand", minimum_quantity::text AS "minimumQuantity", unit
        FROM inventory_items WHERE user_id = ${auth.userId}::uuid AND is_active = TRUE
          AND minimum_quantity IS NOT NULL AND quantity_on_hand <= minimum_quantity
        ORDER BY (minimum_quantity - quantity_on_hand) DESC, name ASC LIMIT 20
      `,
      prisma.$queryRaw<Array<{ count: bigint }>>`
        SELECT COUNT(*) AS count FROM inventory_items WHERE user_id = ${auth.userId}::uuid AND is_active = TRUE
          AND minimum_quantity IS NOT NULL AND quantity_on_hand <= minimum_quantity
      `,
    ]);
    res.setHeader("Cache-Control", "private, no-store");
    res.status(200).json({ activeAnimals, feedingsToday, lowStockItems, lowStockCount: Number(lowStockCount[0]?.count ?? 0n) });
  });

  router.get("/home/today/recent", requireSession, async (_req, res) => {
    const auth = res.locals.auth as AuthContext;
    const today = localDateFor(new Date(), auth.timezone);
    const bounds = localDayBounds(today, auth.timezone);
    const from = new Date(bounds.start.getTime() - 7 * 86_400_000);
    const [feedings, weights, sheds, notes, reproduction, births, maintenance, animalUpdates, dueMaintenance, eggs] = await Promise.all([
      prisma.feedingSession.findMany({ where: { userId: auth.userId, performedAt: { gte: from, lt: bounds.end } }, orderBy: { performedAt: "desc" }, take: 15, include: { entries: { where: { animal: { is: { userId: auth.userId } } }, include: { animal: { select: { id: true, name: true } } } } } }),
      prisma.weightMeasurement.findMany({ where: { animal: { is: { userId: auth.userId } }, measuredAt: { gte: from, lt: bounds.end } }, orderBy: { measuredAt: "desc" }, take: 15, include: { animal: { select: { id: true, name: true } } } }),
      prisma.shedRecord.findMany({ where: { animal: { is: { userId: auth.userId } }, occurredAt: { gte: from, lt: bounds.end } }, orderBy: { occurredAt: "desc" }, take: 15, include: { animal: { select: { id: true, name: true } } } }),
      prisma.animalNote.findMany({ where: { archivedAt: null, animal: { is: { userId: auth.userId } }, occurredAt: { gte: from, lt: bounds.end } }, orderBy: { occurredAt: "desc" }, take: 15, include: { animal: { select: { id: true, name: true } } } }),
      prisma.reproductiveEvent.findMany({ where: { cycle: { is: { userId: auth.userId } }, occurredAt: { gte: from, lt: bounds.end } }, orderBy: { occurredAt: "desc" }, take: 15, include: { cycle: { select: { id: true, name: true } }, animal: { select: { id: true, name: true } } } }),
      prisma.offspringBatch.findMany({ where: { cycle: { is: { userId: auth.userId } }, bornOn: { gte: from, lt: bounds.end } }, orderBy: { bornOn: "desc" }, take: 15, include: { cycle: { select: { id: true, name: true } } } }),
      prisma.incubatorMaintenance.findMany({ where: { incubator: { is: { userId: auth.userId } }, occurredAt: { gte: from, lt: bounds.end } }, orderBy: { occurredAt: "desc" }, take: 15, include: { incubator: { select: { id: true, name: true } } } }),
      prisma.animal.findMany({ where: { userId: auth.userId, status: "active", updatedAt: { gte: from, lt: bounds.end } }, orderBy: { updatedAt: "desc" }, take: 15, select: { id: true, name: true, updatedAt: true } }),
      prisma.incubator.findMany({ where: { userId: auth.userId, isActive: true, maintenanceIntervalDays: { not: null }, nextMaintenanceAt: { lte: localDayBounds(addCalendarDays(today, 8), auth.timezone).start } }, orderBy: { nextMaintenanceAt: "asc" }, take: 20, select: { id: true, name: true, nextMaintenanceAt: true, maintenanceIntervalDays: true } }),
      prisma.egg.findMany({ where: { clutch: { is: { cycle: { is: { userId: auth.userId } } } }, expectedHatchAt: { gte: bounds.start, lte: localDayBounds(addCalendarDays(today, 8), auth.timezone).start }, status: { notIn: ["hatched", "failed"] } }, orderBy: { expectedHatchAt: "asc" }, take: 30, include: { clutch: { select: { cycleId: true, cycle: { select: { name: true } } } } } }),
    ]);
    const events = [
      ...feedings.map((item) => ({ type: "feeding" as const, occurredAt: item.performedAt, title: "Feeding session", targetPath: "/feeding" })),
      ...weights.map((item) => ({ type: "weight" as const, occurredAt: item.measuredAt, title: "Weight recorded", targetPath: `/animals/${item.animalId}` })),
      ...sheds.map((item) => ({ type: "shed" as const, occurredAt: item.occurredAt, title: "Shed recorded", targetPath: `/animals/${item.animalId}` })),
      ...notes.map((item) => ({ type: "note" as const, occurredAt: item.occurredAt, title: item.title ?? "Animal note", targetPath: `/animals/${item.animalId}` })),
      ...reproduction.map((item) => ({ type: "reproduction" as const, occurredAt: item.occurredAt, title: item.eventType, targetPath: `/reproduction-cycles/${item.cycleId}` })),
      ...births.map((item) => ({ type: "birth" as const, occurredAt: item.bornOn, title: `Nascita: ${item.count} piccoli`, targetPath: `/reproduction-cycles/${item.cycleId}` })),
      ...maintenance.map((item) => ({ type: "incubation" as const, occurredAt: item.occurredAt, title: `Manutenzione incubatrice: ${item.incubator.name}`, targetPath: "/reproduction-cycles" })),
      ...animalUpdates.map((item) => ({ type: "animal_update" as const, occurredAt: item.updatedAt, title: `Scheda aggiornata: ${item.name}`, targetPath: `/animals/${item.id}` })),
    ].sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime()).slice(0, 20);
    const smartSuggestions = [
      ...dueMaintenance.map((item) => ({ id: `incubator-${item.id}`, type: "incubator_maintenance", title: item.name, dueAt: item.nextMaintenanceAt, targetPath: "/reproduction-cycles" })),
      ...eggs.map((item) => ({ id: `egg-${item.id}`, type: "expected_hatch", title: item.clutch.cycle.name ?? "Covata", dueAt: item.expectedHatchAt, targetPath: `/reproduction-cycles/${item.clutch.cycleId}` })),
    ];
    res.setHeader("Cache-Control", "private, no-store");
    res.status(200).json({ events, smartSuggestions });
  });

  router.get("/home/today", requireSession, async (_req, res) => {
    const auth = res.locals.auth as AuthContext;
    const now = new Date();
    const today = localDateFor(now, auth.timezone);
    const bounds = localDayBounds(today, auth.timezone);
    const nextWeekLimit = localDayBounds(addCalendarDays(today, 8), auth.timezone).start;

    const [
      dueToday,
      overdue,
      completedToday,
      upcomingTasks,
      reminders,
      recentFeedings,
      recentWeights,
      recentSheds,
      recentNotes,
      recentReproductionEvents,
      dueTodayCount,
      overdueCount,
      completedTodayCount,
      upcomingTaskCount,
      imminentReminderCount,
      feedingAlerts,
      activeAnimalCount,
      feedingTodayCount,
      lowStockItems,
      lowStockCountResult,
      recentOffspringBatches,
      recentIncubatorMaintenance,
      recentAnimalUpdates,
      dueIncubatorMaintenance,
      eggsNearHatch,
    ] = await Promise.all([
      prisma.task.findMany({
        where: { userId: auth.userId, status: "open", dueAt: { gte: now, lt: bounds.end } },
        orderBy: { dueAt: "asc" },
        take: 100,
        include: { animal: { select: { id: true, name: true, identifier: true, species: true, photoKey: true, updatedAt: true } }, reminderRule: { select: { id: true, intervalDays: true, nextDueAt: true, isEnabled: true } } },
      }),
      prisma.task.findMany({
        where: { userId: auth.userId, status: "open", dueAt: { lt: now } },
        orderBy: { dueAt: "asc" },
        take: 100,
        include: { animal: { select: { id: true, name: true, identifier: true, species: true, photoKey: true, updatedAt: true } }, reminderRule: { select: { id: true, intervalDays: true, nextDueAt: true, isEnabled: true } } },
      }),
      prisma.task.findMany({
        where: { userId: auth.userId, status: "completed", completedAt: { gte: bounds.start, lt: bounds.end } },
        orderBy: { completedAt: "desc" },
        take: 100,
        include: { animal: { select: { id: true, name: true, identifier: true, species: true, photoKey: true, updatedAt: true } }, reminderRule: { select: { id: true, intervalDays: true, nextDueAt: true, isEnabled: true } } },
      }),
      prisma.task.findMany({
        where: { userId: auth.userId, status: "open", dueAt: { gte: bounds.end, lt: nextWeekLimit } },
        orderBy: { dueAt: "asc" },
        take: 100,
        include: { animal: { select: { id: true, name: true, identifier: true, species: true, photoKey: true, updatedAt: true } }, reminderRule: { select: { id: true, intervalDays: true, nextDueAt: true, isEnabled: true } } },
      }),
      prisma.reminderRule.findMany({
        where: { userId: auth.userId, isEnabled: true, nextDueAt: { lt: nextWeekLimit } },
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
      prisma.task.count({ where: { userId: auth.userId, status: "open", dueAt: { gte: bounds.end, lt: nextWeekLimit } } }),
      prisma.reminderRule.count({ where: { userId: auth.userId, isEnabled: true, nextDueAt: { lt: nextWeekLimit } } }),
      prisma.$queryRaw<Array<{ id: string; name: string; identifier: string | null; species: string; lastMealAt: Date | null; daysSinceLastMeal: number; feedingIntervalDays: number; feedingStatus: "no_history" | "overdue" | "due_soon"; photoUrl: string | null }>>`
        SELECT a.id, a.name, a.identifier, a.species,
          last_meal.performed_at AS "lastMealAt",
          CASE WHEN last_meal.performed_at IS NULL THEN 0
            ELSE FLOOR(EXTRACT(EPOCH FROM (NOW() - last_meal.performed_at)) / 86400)::int END AS "daysSinceLastMeal",
          a.feeding_interval_days AS "feedingIntervalDays",
          CASE WHEN last_meal.performed_at IS NULL THEN 'no_history'
            WHEN last_meal.performed_at < NOW() - (a.feeding_interval_days * INTERVAL '1 day') THEN 'overdue'
            ELSE 'due_soon' END AS "feedingStatus",
          CASE WHEN a.photo_key IS NULL THEN NULL
            ELSE '/api/v1/animals/' || a.id::text || '/photo?v=' || (EXTRACT(EPOCH FROM a.updated_at) * 1000)::bigint::text END AS "photoUrl"
        FROM animals a
        LEFT JOIN LATERAL (
          SELECT fs.performed_at
          FROM feeding_entries fe
          INNER JOIN feeding_sessions fs ON fs.id = fe.session_id
          WHERE fe.animal_id = a.id AND fe.outcome = 'ate'
          ORDER BY fs.performed_at DESC
          LIMIT 1
        ) last_meal ON TRUE
        WHERE a.user_id = ${auth.userId}::uuid
          AND a.status = 'active'
          AND a.feeding_interval_days IS NOT NULL
          AND (
            last_meal.performed_at IS NULL
            OR last_meal.performed_at <= NOW() - (a.feeding_interval_days * 0.8 * INTERVAL '1 day')
          )
        ORDER BY COALESCE(last_meal.performed_at, a.created_at) ASC
        LIMIT 100
      `,
      prisma.animal.count({ where: { userId: auth.userId, status: "active" } }),
      prisma.feedingEntry.count({ where: { session: { is: { userId: auth.userId, performedAt: { gte: bounds.start, lt: bounds.end } } }, animal: { is: { userId: auth.userId } } } }),
      prisma.$queryRaw<Array<{ id: string; name: string; quantityOnHand: string; minimumQuantity: string; unit: string }>>`
        SELECT id, name, quantity_on_hand::text AS "quantityOnHand",
          minimum_quantity::text AS "minimumQuantity", unit
        FROM inventory_items
        WHERE user_id = ${auth.userId}::uuid AND is_active = TRUE
          AND minimum_quantity IS NOT NULL AND quantity_on_hand <= minimum_quantity
        ORDER BY (minimum_quantity - quantity_on_hand) DESC, name ASC
        LIMIT 20
      `,
      prisma.$queryRaw<Array<{ count: bigint }>>`
        SELECT COUNT(*) AS count FROM inventory_items
        WHERE user_id = ${auth.userId}::uuid AND is_active = TRUE
          AND minimum_quantity IS NOT NULL AND quantity_on_hand <= minimum_quantity
      `,
      prisma.offspringBatch.findMany({
        where: { cycle: { is: { userId: auth.userId } }, bornOn: { gte: new Date(bounds.start.getTime() - 7 * 86_400_000), lt: bounds.end } },
        orderBy: { bornOn: "desc" }, take: 15,
        include: { cycle: { select: { id: true, name: true } } },
      }),
      prisma.incubatorMaintenance.findMany({
        where: { incubator: { is: { userId: auth.userId } }, occurredAt: { gte: new Date(bounds.start.getTime() - 7 * 86_400_000), lt: bounds.end } },
        orderBy: { occurredAt: "desc" }, take: 15,
        include: { incubator: { select: { id: true, name: true } } },
      }),
      prisma.animal.findMany({
        where: { userId: auth.userId, status: "active", updatedAt: { gte: new Date(bounds.start.getTime() - 7 * 86_400_000), lt: bounds.end } },
        orderBy: { updatedAt: "desc" }, take: 15,
        select: { id: true, name: true, updatedAt: true },
      }),
      prisma.incubator.findMany({
        where: { userId: auth.userId, isActive: true, maintenanceIntervalDays: { not: null }, nextMaintenanceAt: { lte: nextWeekLimit } },
        orderBy: { nextMaintenanceAt: "asc" }, take: 20,
        select: { id: true, name: true, nextMaintenanceAt: true, maintenanceIntervalDays: true },
      }),
      prisma.egg.findMany({
        where: { clutch: { is: { cycle: { is: { userId: auth.userId } } } }, expectedHatchAt: { gte: bounds.start, lte: nextWeekLimit }, status: { notIn: ["hatched", "failed"] } },
        orderBy: { expectedHatchAt: "asc" }, take: 30,
        include: { clutch: { select: { cycleId: true, cycle: { select: { name: true } } } } },
      }),
    ]);

    const serializeTask = (task: typeof dueToday[number]) => {
      const { animal, reminderRule, ...taskFields } = task;
      return {
        ...taskFields,
        animal: animal ? {
          id: animal.id,
          name: animal.name,
          identifier: animal.identifier,
          species: animal.species,
          photoUrl: animal.photoKey ? `/api/v1/animals/${animal.id}/photo?v=${animal.updatedAt.getTime()}` : null,
        } : null,
        recurrence: reminderRule ? {
          ruleId: reminderRule.id,
          intervalDays: reminderRule.intervalDays,
          nextDueAt: reminderRule.nextDueAt,
          enabled: reminderRule.isEnabled,
        } : null,
      };
    };

    const recentEvents = [
      ...recentFeedings.map((item) => ({ type: "feeding" as const, occurredAt: item.performedAt, title: "Feeding session", targetPath: "/feeding", record: item })),
      ...recentWeights.map((item) => ({ type: "weight" as const, occurredAt: item.measuredAt, title: "Weight recorded", targetPath: `/animals/${item.animalId}`, record: item })),
      ...recentSheds.map((item) => ({ type: "shed" as const, occurredAt: item.occurredAt, title: "Shed recorded", targetPath: `/animals/${item.animalId}`, record: item })),
      ...recentNotes.map((item) => ({ type: "note" as const, occurredAt: item.occurredAt, title: item.title ?? "Animal note", targetPath: `/animals/${item.animalId}`, record: item })),
      ...recentReproductionEvents.map((item) => ({ type: "reproduction" as const, occurredAt: item.occurredAt, title: item.eventType, targetPath: `/reproduction-cycles/${item.cycleId}`, record: item })),
      ...recentOffspringBatches.map((item) => ({ type: "birth" as const, occurredAt: item.bornOn, title: `Nascita: ${item.count} piccoli`, targetPath: `/reproduction-cycles/${item.cycleId}`, record: item })),
      ...recentIncubatorMaintenance.map((item) => ({ type: "incubation" as const, occurredAt: item.occurredAt, title: `Manutenzione incubatrice: ${item.incubator.name}`, targetPath: "/reproduction-cycles", record: item })),
      ...recentAnimalUpdates.map((item) => ({ type: "animal_update" as const, occurredAt: item.updatedAt, title: `Scheda aggiornata: ${item.name}`, targetPath: `/animals/${item.id}`, record: item })),
    ].sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime()).slice(0, 20);

    res.status(200).json({
      date: today,
      timezone: auth.timezone,
      tasks: { dueToday: dueToday.map(serializeTask), overdue: overdue.map(serializeTask), completedToday: completedToday.map(serializeTask), upcoming: upcomingTasks.map(serializeTask) },
      counts: {
        dueToday: dueTodayCount,
        overdue: overdueCount,
        completedToday: completedTodayCount,
        upcoming: upcomingTaskCount,
        imminentReminders: imminentReminderCount,
        activeAnimals: activeAnimalCount,
        feedingsToday: feedingTodayCount,
        lowStock: Number(lowStockCountResult[0]?.count ?? 0n),
      },
      overview: {
        activeAnimals: activeAnimalCount,
        feedingsToday: feedingTodayCount,
        lowStockItems,
        lowStockCount: Number(lowStockCountResult[0]?.count ?? 0n),
      },
      smartSuggestions: [
        ...dueIncubatorMaintenance.map((item) => ({ id: `incubator-${item.id}`, type: "incubator_maintenance", title: item.name, dueAt: item.nextMaintenanceAt, targetPath: "/reproduction-cycles" })),
        ...eggsNearHatch.map((item) => ({ id: `egg-${item.id}`, type: "expected_hatch", title: item.clutch.cycle.name ?? "Covata", dueAt: item.expectedHatchAt, targetPath: `/reproduction-cycles/${item.clutch.cycleId}` })),
        ...reminders.map((item) => ({ id: item.id, type: item.category, title: item.title, dueAt: item.nextDueAt, targetPath: item.animalId ? `/animals/${item.animalId}` : "/tasks" })),
      ],
      truncated: {
        dueToday: dueTodayCount > dueToday.length,
        overdue: overdueCount > overdue.length,
        completedToday: completedTodayCount > completedToday.length,
        upcoming: upcomingTaskCount > upcomingTasks.length,
        imminentReminders: imminentReminderCount > reminders.length,
      },
      imminentReminders: reminders,
      feedingAlerts,
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
          animal: { select: { id: true, name: true, identifier: true, species: true, photoKey: true, updatedAt: true } },
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
