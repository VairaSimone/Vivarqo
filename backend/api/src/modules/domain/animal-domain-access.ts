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
      "/reproduction", "/reproduction-pairs", "/reproduction-cycles", "/species-breeding-profiles", "/reproduction-statistics",
      "/incubators", "/clutches", "/eggs", "/offspring-batches", "/reproductive-events",
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
  if (!requiredCategory && !isGeneralAnimalRoute) { next(); return; }

  const auth = res.locals.auth as { userId: string } | undefined;
  if (!auth) { next(); return; }

  const configuration = await prisma.accountConfiguration.findUnique({
    where: { userId: auth.userId },
    select: { animalCategories: true },
  });
  const categories = configuration?.animalCategories ?? [];

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
