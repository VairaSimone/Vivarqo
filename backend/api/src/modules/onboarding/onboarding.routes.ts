import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../db/prisma.js";
import { AppError } from "../../errors/app-error.js";
import { requireSession, type AuthContext } from "../auth/session.js";

const milestones = ["animal", "feeding", "weight", "shed", "reminder", "clutch", "egg"] as const;
const suggestions = ["animal-care", "clutch-eggs"] as const;


const animalCategories = ["reptiles", "fish", "birds", "dogs_cats"] as const;
const configurationSchema = z.object({
  categories: z.array(z.enum(animalCategories)).min(1).max(animalCategories.length)
    .refine((categories) => new Set(categories).size === categories.length, "Categories must be unique"),
}).strict();

export function createOnboardingRouter() {
  const router = Router();

  router.get("/configuration", requireSession, async (_req, res) => {
    const auth = res.locals.auth as AuthContext;
    const configuration = await prisma.accountConfiguration.findUnique({
      where: { userId: auth.userId },
      select: { animalCategories: true, configuredAt: true },
    });
    res.setHeader("Cache-Control", "private, no-store");
    res.status(200).json({
      categories: configuration?.animalCategories ?? [],
      configuredAt: configuration?.configuredAt ?? null,
    });
  });

  router.post("/configuration", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    const parsed = configurationSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(400, "VALIDATION_ERROR", "Select at least one valid animal category", {
        issues: parsed.error.issues.map((issue) => ({
          path: issue.path.map(String).join("."),
          message: issue.message,
        })),
      });
    }
    const configuration = await prisma.accountConfiguration.upsert({
      where: { userId: auth.userId },
      create: {
        userId: auth.userId,
        animalCategories: parsed.data.categories,
      },
      update: {
        animalCategories: parsed.data.categories,
      },
      select: { animalCategories: true, configuredAt: true },
    });
    res.setHeader("Cache-Control", "private, no-store");
    res.status(200).json({
      categories: configuration.animalCategories,
      configuredAt: configuration.configuredAt,
    });
  });

  router.get("/progress", requireSession, async (_req, res) => {
    const auth = res.locals.auth as AuthContext;
    const [animals, feedings, weights, sheds, reminders, clutches, eggs, events] = await Promise.all([
      prisma.animal.count({ where: { userId: auth.userId } }),
      prisma.feedingEntry.count({ where: { session: { is: { userId: auth.userId } }, animal: { is: { userId: auth.userId } } } }),
      prisma.weightMeasurement.count({ where: { animal: { is: { userId: auth.userId } } } }),
      prisma.shedRecord.count({ where: { animal: { is: { userId: auth.userId } } } }),
      prisma.reminderRule.count({ where: { userId: auth.userId } }),
      prisma.clutch.count({ where: { cycle: { is: { userId: auth.userId } } } }),
      prisma.egg.count({ where: { clutch: { is: { cycle: { is: { userId: auth.userId } } } } } }),
      prisma.auditEvent.findMany({
        where: { userId: auth.userId, action: { in: ["onboarding.milestone_completed", "onboarding.suggestion_dismissed"] } },
        select: { action: true, entityType: true },
      }),
    ]);

    const current = { animal: animals > 0, feeding: feedings > 0, weight: weights > 0, shed: sheds > 0, reminder: reminders > 0, clutch: clutches > 0, egg: eggs > 0 };
    const historical = new Set(events.filter((event) => event.action === "onboarding.milestone_completed").map((event) => event.entityType).filter((key): key is string => Boolean(key)));
    for (const event of events) {
      if (event.action === "animal.created" || event.action === "animal.bulk_created") historical.add("animal");
      if (event.action === "feeding.created" || event.action === "feeding.bulk_created") historical.add("feeding");
      if (event.action === "reminder_rule.created") historical.add("reminder");
      if (event.action === "clutch.created") historical.add("clutch");
      if (event.action === "egg.created") historical.add("egg");
      if (event.action === "weight.created") historical.add("weight");
      if (event.action === "shed.created") historical.add("shed");
    }
    const dismissed = new Set(events.filter((event) => event.action === "onboarding.suggestion_dismissed").map((event) => event.entityType).filter((key): key is string => Boolean(key)));

    // Persist milestones as soon as they are observed. This also recognizes Excel imports
    // and preserves completion if users later delete or archive their source records.
    const newlyCompleted = milestones.filter((key) => current[key] && !historical.has(key));
    if (newlyCompleted.length) {
      await prisma.auditEvent.createMany({
        data: newlyCompleted.map((key) => ({
          userId: auth.userId,
          action: "onboarding.milestone_completed",
          entityType: key,
          metadata: { source: "observed_account_data" },
        })),
        skipDuplicates: true,
      });
      newlyCompleted.forEach((key) => historical.add(key));
    }

    res.status(200).json({
      current,
      completed: Object.fromEntries(milestones.map((key) => [key, historical.has(key) || current[key]])),
      dismissedSuggestions: suggestions.filter((key) => dismissed.has(key)),
    });
  });

  router.post("/suggestions/:key/dismiss", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    const key = z.enum(suggestions).safeParse(req.params.key);
    if (!key.success) throw new AppError(400, "VALIDATION_ERROR", "Unknown onboarding suggestion");
    const exists = await prisma.auditEvent.findFirst({
      where: { userId: auth.userId, action: "onboarding.suggestion_dismissed", entityType: key.data },
      select: { id: true },
    });
    if (!exists) {
      await prisma.auditEvent.create({
        data: { userId: auth.userId, action: "onboarding.suggestion_dismissed", entityType: key.data },
      });
    }
    res.status(204).send();
  });

  return router;
}
