import type { RequestHandler } from "express";
import { prisma } from "../../db/prisma.js";
import { AppError } from "../../errors/app-error.js";

const categoryRoutes: Array<{ prefixes: string[]; category: string }> = [
  { prefixes: ["/aquariums"], category: "fish" },
  { prefixes: ["/aviaries", "/birds", "/bird-breeding-pairs", "/aviary-maintenance"], category: "birds" },
  { prefixes: ["/quarantines", "/aquarium-treatments"], category: "fish" },
  { prefixes: ["/companion-care"], category: "dogs_cats" },
  {
    prefixes: [
      "/reproduction", "/reproduction-pairs", "/species-breeding-profiles", "/reproduction-statistics",
      "/incubators", "/offspring-batches", "/reproductive-events",
      "/incubation-logs", "/genetics", "/genetic-traits",
    ],
    category: "reptiles",
  },
];
const generalAnimalRoutes = [
  "/animals", "/care-records", "/feeding-sessions", "/feeding-entries",
  "/weights", "/sheds", "/animal-notes", "/health-records",
];

function matchesPath(path: string, prefix: string) {
  return path === prefix || path.startsWith(prefix + "/");
}

export function categoryForAnimalDomainPath(path: string): string | null {
  if (/^\/animals\/[^/]+\/(?:hatchling-care|genetic-traits|genetic-history|pedigree|inbreeding)$/.test(path)) {
    return "reptiles";
  }
  return categoryRoutes.find((item) => item.prefixes.some((prefix) => matchesPath(path, prefix)))?.category ?? null;
}

/** Category access is account-scoped and intentionally separate from commercial entitlements. */
export const animalDomainAccessGuard: RequestHandler = async (req, res, next) => {
  const requiredCategory = categoryForAnimalDomainPath(req.path);
  const isGeneralAnimalRoute = generalAnimalRoutes.some((prefix) => matchesPath(req.path, prefix));
  const isReproductionCycleRoute = matchesPath(req.path, "/reproduction-cycles");
  const isClutchRoute = matchesPath(req.path, "/clutches");
  if (!requiredCategory && !isGeneralAnimalRoute && !isReproductionCycleRoute && !isClutchRoute) { next(); return; }

  const auth = res.locals.auth as { userId: string } | undefined;
  if (!auth) { next(); return; }

  const configuration = await prisma.accountConfiguration.findUnique({
    where: { userId: auth.userId },
    select: { animalCategories: true },
  });
  const categories = configuration?.animalCategories ?? [];

  // Bird breeding pairs also use ReproductionCycle for shared clutch/egg history.
  // Resolve the category from the cycle's actual parents instead of treating every
  // cycle or clutch as a reptile-only record.
  const cycleMatch = req.path.match(/^\/reproduction-cycles(?:\/([^/]+))?/);
  const clutchMatch = req.path.match(/^\/clutches(?:\/([^/]+))?/);
  let cycleCategories: string[] | null = null;
  let scopedRecord = false;
  if (cycleMatch) {
    scopedRecord = true;
    cycleCategories = ["reptiles", "birds"];
    if (cycleMatch[1]) {
      const cycle = await prisma.reproductionCycle.findFirst({
        where: { id: cycleMatch[1], userId: auth.userId },
        select: { parentA: { select: { category: true } }, parentB: { select: { category: true } } },
      });
      if (cycle) {
        cycleCategories = [cycle.parentA?.category, cycle.parentB?.category].filter((value): value is string => Boolean(value));
        if (cycleCategories.length === 0) cycleCategories = ["reptiles"];
      }
    }
  } else if (clutchMatch) {
    scopedRecord = true;
    cycleCategories = ["reptiles", "birds"];
    if (clutchMatch[1]) {
      const clutch = await prisma.clutch.findFirst({
        where: { id: clutchMatch[1], cycle: { is: { userId: auth.userId } } },
        select: { cycle: { select: { parentA: { select: { category: true } }, parentB: { select: { category: true } } } } },
      });
      if (clutch) {
        cycleCategories = [clutch.cycle.parentA?.category, clutch.cycle.parentB?.category].filter((value): value is string => Boolean(value));
        if (cycleCategories.length === 0) cycleCategories = ["reptiles"];
      }
    }
  }
  if (scopedRecord && cycleCategories) {
    const allowed = cycleCategories.some((category) => categories.includes(category));
    if (!allowed) {
      next(new AppError(403, "ANIMAL_CATEGORY_NOT_ENABLED", "This reproduction record belongs to a disabled animal category", {
        category: cycleCategories[0],
        settingsPath: "/settings/categories",
      }));
      return;
    }
  }

  if (requiredCategory && !categories.includes(requiredCategory)) {
    next(new AppError(403, "ANIMAL_CATEGORY_NOT_ENABLED", "This animal domain is not enabled for the account", {
      category: requiredCategory,
      settingsPath: "/settings/categories",
    }));
    return;
  }

  if (isGeneralAnimalRoute && categories.length === 0) {
    next(new AppError(403, "ANIMAL_CATEGORY_NOT_ENABLED", "Select at least one animal category to use animal modules", {
      settingsPath: "/settings/categories",
    }));
    return;
  }

  const requestedCategory = typeof req.query.category === "string" ? req.query.category : undefined;
  if (isGeneralAnimalRoute && requestedCategory && !categories.includes(requestedCategory)) {
    next(new AppError(403, "ANIMAL_CATEGORY_NOT_ENABLED", "This animal category is not enabled for the account", {
      category: requestedCategory,
      settingsPath: "/settings/categories",
    }));
    return;
  }

  next();
};
