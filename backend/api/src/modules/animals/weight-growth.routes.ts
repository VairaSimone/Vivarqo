import { Router } from "express";
import { z } from "zod";
import { AppError } from "../../errors/app-error.js";
import { prisma } from "../../db/prisma.js";
import { requireSession, type AuthContext } from "../auth/session.js";

const periodSchema = z.enum(["30", "90", "180", "365", "all"]);

function csvCell(value: unknown): string {
  let text = value == null ? "" : value instanceof Date ? value.toISOString() : String(value);
  // Prevent spreadsheet formula execution when notes contain untrusted text.
  if (/^[=+@\-\t\r]/.test(text)) text = "'" + text;
  return '"' + text.replace(/"/g, '""') + '"';
}

export function createWeightGrowthRouter() {
  const router = Router();

  router.get("/animals/:animalId/weight-growth", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    const parsedId = z.string().uuid().safeParse(req.params.animalId);
    if (!parsedId.success) throw new AppError(400, "INVALID_ID", "Invalid animal id");
    const animalId = parsedId.data;
    const animal = await prisma.animal.findFirst({ where: { id: animalId, userId: auth.userId }, select: { id: true } });
    if (!animal) throw new AppError(404, "ANIMAL_NOT_FOUND", "Animal not found");
    const parsedPeriod = periodSchema.safeParse(req.query.periodDays ?? "90");
    if (!parsedPeriod.success) throw new AppError(400, "VALIDATION_ERROR", "Invalid weight analysis period");
    const periodDays = parsedPeriod.data === "all" ? null : Number(parsedPeriod.data);
    const now = new Date();
    const currentFrom = periodDays == null ? null : new Date(now.getTime() - periodDays * 86_400_000);
    const previousFrom = periodDays == null ? null : new Date(now.getTime() - periodDays * 2 * 86_400_000);
    const measurements = await prisma.weightMeasurement.findMany({
      where: { animalId, ...(previousFrom ? { measuredAt: { gte: previousFrom, lte: now } } : { measuredAt: { lte: now } }) },
      orderBy: [{ measuredAt: "desc" }, { id: "desc" }],
      take: 2000,
      select: { id: true, measuredAt: true, weightG: true, notes: true },
    });
    measurements.reverse();
    const current = measurements.filter((item) => !currentFrom || item.measuredAt >= currentFrom);
    const previous = periodDays == null ? [] : measurements.filter((item) => item.measuredAt < currentFrom!);
    const summarize = (items: typeof measurements) => {
      if (items.length < 2) return { count: items.length, firstWeightG: items[0] ? Number(items[0].weightG) : null, lastWeightG: items.at(-1) ? Number(items.at(-1)!.weightG) : null, changeG: null, changePercent: null };
      const firstWeightG = Number(items[0]!.weightG);
      const lastWeightG = Number(items.at(-1)!.weightG);
      const changeG = Number((lastWeightG - firstWeightG).toFixed(2));
      return { count: items.length, firstWeightG, lastWeightG, changeG, changePercent: firstWeightG > 0 ? Number(((changeG / firstWeightG) * 100).toFixed(2)) : null };
    };
    const alerts: Array<{ type: "loss" | "variation"; measuredAt: Date; previousWeightG: number; weightG: number; changeG: number; changePercent: number }> = [];
    for (let index = 1; index < current.length; index += 1) {
      const before = Number(current[index - 1]!.weightG);
      const after = Number(current[index]!.weightG);
      if (before <= 0) continue;
      const changeG = Number((after - before).toFixed(2));
      const changePercent = Number(((changeG / before) * 100).toFixed(2));
      if (changePercent <= -5) alerts.push({ type: "loss", measuredAt: current[index]!.measuredAt, previousWeightG: before, weightG: after, changeG, changePercent });
      else if (changePercent >= 30) alerts.push({ type: "variation", measuredAt: current[index]!.measuredAt, previousWeightG: before, weightG: after, changeG, changePercent });
    }
    res.status(200).json({
      measurements: current,
      current: summarize(current),
      previous: summarize(previous),
      periodDays,
      alerts,
      truncated: measurements.length === 2000,
    });
  });

  router.get("/animals/:animalId/weights/export.csv", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    const parsedId = z.string().uuid().safeParse(req.params.animalId);
    if (!parsedId.success) throw new AppError(400, "INVALID_ID", "Invalid animal id");
    const animal = await prisma.animal.findFirst({ where: { id: parsedId.data, userId: auth.userId }, select: { id: true, name: true, identifier: true } });
    if (!animal) throw new AppError(404, "ANIMAL_NOT_FOUND", "Animal not found");
    const measurements = await prisma.weightMeasurement.findMany({
      where: { animalId: animal.id },
      orderBy: [{ measuredAt: "asc" }, { id: "asc" }],
      select: { measuredAt: true, weightG: true, notes: true },
    });
    const rows = [
      ["animal", "identifier", "measured_at", "weight_g", "notes"].map(csvCell).join(","),
      ...measurements.map((item) => [animal.name, animal.identifier, item.measuredAt, item.weightG, item.notes].map(csvCell).join(",")),
    ];
    const filename = "vivarqo-pesature-" + animal.id + ".csv";
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="' + filename + '"');
    res.setHeader("Cache-Control", "no-store");
    res.status(200).send("\uFEFF" + rows.join("\r\n") + "\r\n");
  });

  return router;
}
