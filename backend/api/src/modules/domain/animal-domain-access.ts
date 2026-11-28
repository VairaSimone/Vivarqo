import type { RequestHandler } from "express";
import { prisma } from "../../db/prisma.js";
import { AppError } from "../../errors/app-error.js";

const reproductionCategories = ["reptiles", "birds"] as const;
const categoryRoutes: Array<{ prefixes: string[]; category: string }> = [
  { prefixes: ["/aquariums"], category: "fish" },
  { prefixes: ["/aviaries", "/birds", "/bird-breeding-pairs", "/aviary-maintenance"], category: "birds" },
  { prefixes: ["/quarantines", "/aquarium-treatments"], category: "fish" },
  { prefixes: ["/companion-care"], category: "dogs_cats" },
  {
    prefixes: [
      "/reproduction", "/reproduction-pairs", "/species-breeding-profiles",
      "/reproduction-statistics", "/genetics", "/genetic-traits",
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

function categoriesFromParents(parentA: { category: string } | null, parentB: { category: string } | null) {
  const categories = [...new Set([parentA?.category, parentB?.category].filter((value): value is string => Boolean(value)))];
  // Cycles created before animal categories existed are reptile records by migration default.
  return categories.length ? categories : ["reptiles"];
}

async function cycleCategoriesForUser(userId: string, cycleId: string) {
  const cycle = await prisma.reproductionCycle.findFirst({
    where: { id: cycleId, userId },
    select: { parentA: { select: { category: true } }, parentB: { select: { category: true } } },
  });
  return cycle ? categoriesFromParents(cycle.parentA, cycle.parentB) : null;
}

export function categoryForAnimalDomainPath(path: string): string | null {
  if (/^\/animals\/[^/]+\/(?:genetic-traits|genetic-history|pedigree|inbreeding)$/.test(path)) {
    return "reptiles";
  }
  return categoryRoutes.find((item) => item.prefixes.some((prefix) => matchesPath(path, prefix)))?.category ?? null;
}

/** Category access is account-scoped and intentionally separate from commercial entitlements. */
export const animalDomainAccessGuard: RequestHandler = async (req, res, next) => {
  const requiredCategory = categoryForAnimalDomainPath(req.path);
  const isGeneralAnimalRoute = generalAnimalRoutes.some((prefix) => matchesPath(req.path, prefix));
  const cycleMatch = req.path.match(/^\/reproduction-cycles(?:\/([^/]+))?/);
  const clutchMatch = req.path.match(/^\/clutches(?:\/([^/]+))?/);
  const offspringBatchMatch = req.path.match(/^\/offspring-batches(?:\/([^/]+))?/);
  const reproductiveEventMatch = req.path.match(/^\/reproductive-events\/([^/]+)/);
  const hatchlingCareMatch = req.path.match(/^\/animals\/([^/]+)\/hatchling-care$/);
  const isIncubatorRoute = matchesPath(req.path, "/incubators");

  if (!requiredCategory && !isGeneralAnimalRoute && !cycleMatch && !clutchMatch &&
      !offspringBatchMatch && !reproductiveEventMatch && !hatchlingCareMatch && !isIncubatorRoute) {
    next();
    return;
  }

  const auth = res.locals.auth as { userId: string } | undefined;
  if (!auth) {
    next();
    return;
  }

  const configuration = await prisma.accountConfiguration.findUnique({
    where: { userId: auth.userId },
    select: { animalCategories: true },
  });
  const categories = configuration?.animalCategories ?? [];

  let scopedCategories: string[] | null = null;
  let collectionScope = false;

  if (cycleMatch) {
    const cycleId = cycleMatch[1];
    if (cycleId) scopedCategories = await cycleCategoriesForUser(auth.userId, cycleId);
    else {
      scopedCategories = [...reproductionCategories];
      collectionScope = true;
    }
  } else if (clutchMatch) {
    const clutchId = clutchMatch[1];
    const cycleId = typeof req.body?.cycleId === "string" ? req.body.cycleId : undefined;
    if (clutchId) {
      const clutch = await prisma.clutch.findFirst({
        where: { id: clutchId, cycle: { is: { userId: auth.userId } } },
        select: { cycle: { select: { parentA: { select: { category: true } }, parentB: { select: { category: true } } } } },
      });
      if (clutch) scopedCategories = categoriesFromParents(clutch.cycle.parentA, clutch.cycle.parentB);
    } else if (cycleId) {
      scopedCategories = await cycleCategoriesForUser(auth.userId, cycleId);
    } else {
      scopedCategories = [...reproductionCategories];
      collectionScope = true;
    }
  } else if (offspringBatchMatch) {
    const batchId = offspringBatchMatch[1];
    const cycleId = typeof req.query.cycleId === "string"
      ? req.query.cycleId
      : typeof req.body?.cycleId === "string" ? req.body.cycleId : undefined;
    if (batchId) {
      const batch = await prisma.offspringBatch.findFirst({
        where: { id: batchId, cycle: { is: { userId: auth.userId } } },
        select: { cycle: { select: { parentA: { select: { category: true } }, parentB: { select: { category: true } } } } },
      });
      if (batch) scopedCategories = categoriesFromParents(batch.cycle.parentA, batch.cycle.parentB);
    } else if (cycleId) {
      scopedCategories = await cycleCategoriesForUser(auth.userId, cycleId);
    } else {
      scopedCategories = [...reproductionCategories];
      collectionScope = true;
    }
  } else if (reproductiveEventMatch) {
    const event = await prisma.reproductiveEvent.findFirst({
      where: { id: reproductiveEventMatch[1], cycle: { is: { userId: auth.userId } } },
      select: { cycle: { select: { parentA: { select: { category: true } }, parentB: { select: { category: true } } } } },
    });
    if (event) scopedCategories = categoriesFromParents(event.cycle.parentA, event.cycle.parentB);
  } else if (hatchlingCareMatch) {
    const animal = await prisma.animal.findFirst({
      where: { id: hatchlingCareMatch[1], userId: auth.userId },
      select: { category: true },
    });
    if (animal) scopedCategories = [animal.category];
  }

  if (scopedCategories?.length) {
    const missingCategory = collectionScope
      ? (scopedCategories.some((category) => categories.includes(category)) ? null : scopedCategories[0])
      : scopedCategories.find((category) => !categories.includes(category));
    if (missingCategory) {
      next(new AppError(403, "ANIMAL_CATEGORY_NOT_ENABLED", "This reproduction record belongs to a disabled animal category", {
        category: missingCategory,
        settingsPath: "/settings/categories",
      }));
      return;
    }
  }

  // Incubators are shared equipment: accounts managing either reptiles or birds
  // can use the same incubator inventory without enabling the other category.
  if (isIncubatorRoute && !reproductionCategories.some((category) => categories.includes(category))) {
    next(new AppError(403, "ANIMAL_CATEGORY_NOT_ENABLED", "Enable reptiles or birds to use incubation equipment", {
      categories: [...reproductionCategories],
      settingsPath: "/settings/categories",
    }));
    return;
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
