import { z } from "zod";

const nullableText = (max: number) => z.string().trim().max(max).nullable().optional();
function isValidCalendarDate(value: string): boolean {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD").refine(isValidCalendarDate, "Invalid calendar date");


export const animalCategorySchema = z.enum(["reptiles", "fish", "birds", "dogs_cats"]);
const animalDomainProfiles = {
  reptiles: z.object({
    enclosure: nullableText(120),
    brumation: z.enum(["not_applicable", "planned", "in_progress", "completed"]).optional(),
    feedingNotes: z.string().trim().max(2_000).nullable().optional(),
  }).strict(),
  fish: z.object({
    aquariumId: z.string().uuid().nullable().optional(),
    waterType: z.enum(["freshwater", "saltwater", "brackish"]).optional(),
    temperament: nullableText(120),
    maxSizeCm: z.coerce.number().positive().max(500).nullable().optional(),
    shoaling: z.boolean().optional(),
    diet: nullableText(160),
  }).strict(),
  birds: z.object({
    aviaryId: z.string().uuid().nullable().optional(),
    diet: nullableText(160),
    tameness: z.enum(["wild", "socialized", "tame"]).optional(),
    flightStatus: z.enum(["full_flight", "clipped", "unknown"]).optional(),
  }).strict(),
  dogs_cats: z.object({
    animalType: z.enum(["dog", "cat"]).optional(),
    breed: nullableText(160),
    microchip: nullableText(40),
    veterinarianName: nullableText(160),
    veterinaryClinic: nullableText(160),
    veterinaryPhone: nullableText(40),
    veterinaryEmail: z.string().trim().email().max(254).nullable().optional(),
    veterinaryAddress: nullableText(300),
    allergies: z.string().trim().max(5000).nullable().optional(),
    chronicConditions: z.string().trim().max(5000).nullable().optional(),
    sterilized: z.boolean().optional(),
    vaccinationStatus: z.enum(["unknown", "not_up_to_date", "up_to_date"]).optional(),
    coatColor: nullableText(120),
    indoorOutdoor: z.enum(["indoor", "outdoor", "both"]).optional(),
    activityLevel: z.enum(["low", "moderate", "high"]).optional(),
    weightKg: z.coerce.number().positive().max(250).nullable().optional(),
  }).strict().superRefine((profile, ctx) => {
    if (profile.animalType === "cat" && profile.activityLevel !== undefined) {
      ctx.addIssue({ code: "custom", path: ["activityLevel"], message: "Activity level is a dog-specific field" });
    }
    if (profile.animalType === "dog" && profile.indoorOutdoor !== undefined) {
      ctx.addIssue({ code: "custom", path: ["indoorOutdoor"], message: "Outdoor access is a cat-specific field" });
    }
  }),
} as const;

export function validateAnimalDomainProfile(category: z.infer<typeof animalCategorySchema>, profile: unknown) {
  return animalDomainProfiles[category].safeParse(profile ?? {});
}

export const animalStatusSchema = z.enum(["active", "sold", "transferred", "deceased", "archived"]);
export const animalSexSchema = z.enum(["male", "female", "unknown"]);
export const feedingOutcomeSchema = z.enum(["ate", "refused", "not_offered", "unknown"]);
export const shedOutcomeSchema = z.enum(["complete", "partial", "unknown"]);

export const animalFields = {
  name: z.string().trim().min(1).max(120),
  identifier: nullableText(120),
  species: z.string().trim().min(1).max(160),
  category: animalCategorySchema.default("reptiles"),
  domainProfile: z.record(z.string(), z.unknown()).default({}),
  sex: animalSexSchema.default("unknown"),
  morph: nullableText(200),
  motherAnimalId: z.string().uuid().nullable().optional(),
  fatherAnimalId: z.string().uuid().nullable().optional(),
  motherDescription: nullableText(240),
  fatherDescription: nullableText(240),
  geneticsNotes: z.string().trim().max(10_000).nullable().optional(),
  birthDate: dateOnly.nullable().optional(),
  birthDateEstimated: z.boolean().default(false),
  acquiredDate: dateOnly.nullable().optional(),
  originDescription: z.string().trim().max(5_000).nullable().optional(),
  previousBreeder: nullableText(160),
  locationLabel: nullableText(160),
  feedingIntervalDays: z.coerce.number().int().min(1).max(365).nullable().optional(),
  status: animalStatusSchema.default("active"),
  notes: z.string().trim().max(10_000).nullable().optional(),
};

export const createAnimalSchema = z.object(animalFields).strict().superRefine((value, ctx) => {
  const profile = validateAnimalDomainProfile(value.category, value.domainProfile);
  if (!profile.success) {
    for (const issue of profile.error.issues) ctx.addIssue({ ...issue, path: ["domainProfile", ...issue.path] });
  }
  if (value.status === "archived") {
    ctx.addIssue({ code: "custom", path: ["status"], message: "Use the archive action to archive an animal" });
  }
});

export const patchAnimalSchema = z.object({
  name: animalFields.name.optional(),
  identifier: animalFields.identifier,
  species: animalFields.species.optional(),
  category: animalCategorySchema.optional(),
  domainProfile: z.record(z.string(), z.unknown()).optional(),
  sex: animalSexSchema.optional(),
  morph: animalFields.morph,
  motherAnimalId: animalFields.motherAnimalId,
  fatherAnimalId: animalFields.fatherAnimalId,
  motherDescription: animalFields.motherDescription,
  fatherDescription: animalFields.fatherDescription,
  geneticsNotes: animalFields.geneticsNotes,
  birthDate: animalFields.birthDate,
  birthDateEstimated: z.boolean().optional(),
  acquiredDate: animalFields.acquiredDate,
  originDescription: animalFields.originDescription,
  previousBreeder: animalFields.previousBreeder,
  locationLabel: animalFields.locationLabel,
  feedingIntervalDays: animalFields.feedingIntervalDays,
  status: z.enum(["active", "sold", "transferred", "deceased"]).optional(),
  notes: animalFields.notes,
}).strict().superRefine((value, ctx) => {
  if (Object.keys(value).length === 0) ctx.addIssue({ code: "custom", message: "At least one field is required" });
});

export const bulkAnimalsSchema = z.object({
  animals: z.array(createAnimalSchema).min(1).max(500),
}).strict();

export const feedingEntrySchema = z.object({
  animalId: z.string().uuid(),
  outcome: feedingOutcomeSchema,
  foodType: nullableText(120),
  foodSize: nullableText(120),
  foodWeightG: z.coerce.number().positive().max(1_000_000).nullable().optional(),
  preyState: z.enum(["unknown", "frozen", "thawed", "live"]).default("unknown"),
  inventoryItemId: z.string().uuid().nullable().optional(),
  inventoryQuantity: z.coerce.number().positive().max(999_999_999.999).nullable().optional(),
  notes: z.string().trim().max(5_000).nullable().optional(),
}).strict().superRefine((value, ctx) => {
  if (value.inventoryItemId && !value.inventoryQuantity) ctx.addIssue({ code: "custom", path: ["inventoryQuantity"], message: "Inventory quantity is required when an item is selected" });
  if (!value.inventoryItemId && value.inventoryQuantity != null) ctx.addIssue({ code: "custom", path: ["inventoryItemId"], message: "Select an inventory item for the quantity" });
});

export const feedingSessionSchema = z.object({
  performedAt: z.string().datetime({ offset: true }),
  notes: z.string().trim().max(5_000).nullable().optional(),
  entries: z.array(feedingEntrySchema).min(1).max(500),
}).strict().superRefine((value, ctx) => {
  const seen = new Set<string>();
  value.entries.forEach((entry, index) => {
    if (seen.has(entry.animalId)) {
      ctx.addIssue({ code: "custom", path: ["entries", index, "animalId"], message: "An animal can appear only once in a feeding session" });
    }
    seen.add(entry.animalId);
  });
});

export const patchFeedingEntrySchema = z.object({
  performedAt: z.string().datetime({ offset: true }).optional(),
  outcome: feedingOutcomeSchema.optional(),
  foodType: nullableText(120),
  foodSize: nullableText(120),
  foodWeightG: z.coerce.number().positive().max(1_000_000).nullable().optional(),
  preyState: z.enum(["unknown", "frozen", "thawed", "live"]).optional(),
  inventoryItemId: z.string().uuid().nullable().optional(),
  inventoryQuantity: z.coerce.number().positive().max(999_999_999.999).nullable().optional(),
  notes: z.string().trim().max(5_000).nullable().optional(),
}).strict().superRefine((value, ctx) => {
  if (value.inventoryItemId === null && value.inventoryQuantity != null) ctx.addIssue({ code: "custom", path: ["inventoryQuantity"], message: "Inventory quantity requires an inventory item" });
  if (value.inventoryQuantity === null && value.inventoryItemId === undefined) ctx.addIssue({ code: "custom", path: ["inventoryItemId"], message: "Clear the inventory item and quantity together" });
  if (value.inventoryItemId && value.inventoryQuantity == null) ctx.addIssue({ code: "custom", path: ["inventoryQuantity"], message: "Inventory quantity is required when an item is selected" });
}).refine((value) => Object.keys(value).length > 0, "At least one field is required");

export const weightSchema = z.object({
  measuredAt: z.string().datetime({ offset: true }),
  weightG: z.coerce.number().positive().max(100_000_000),
  notes: z.string().trim().max(5_000).nullable().optional(),
}).strict();

export const patchWeightSchema = z.object({
  measuredAt: z.string().datetime({ offset: true }).optional(),
  weightG: z.coerce.number().positive().max(100_000_000).optional(),
  notes: z.string().trim().max(5_000).nullable().optional(),
}).strict().refine((value) => Object.keys(value).length > 0, "At least one field is required");

export const shedSchema = z.object({
  occurredAt: z.string().datetime({ offset: true }),
  outcome: shedOutcomeSchema,
  notes: z.string().trim().max(5_000).nullable().optional(),
}).strict();

export const patchShedSchema = z.object({
  occurredAt: z.string().datetime({ offset: true }).optional(),
  outcome: shedOutcomeSchema.optional(),
  notes: z.string().trim().max(5_000).nullable().optional(),
}).strict().refine((value) => Object.keys(value).length > 0, "At least one field is required");

export const noteSchema = z.object({
  occurredAt: z.string().datetime({ offset: true }),
  title: z.string().trim().max(160).nullable().optional(),
  category: z.string().trim().min(1).max(40),
  body: z.string().trim().min(1).max(20_000),
}).strict();

export const patchNoteSchema = z.object({
  occurredAt: z.string().datetime({ offset: true }).optional(),
  title: z.string().trim().max(160).nullable().optional(),
  category: z.string().trim().min(1).max(40).optional(),
  body: z.string().trim().min(1).max(20_000).optional(),
}).strict().refine((value) => Object.keys(value).length > 0, "At least one field is required");

export const bulkCareRecordsSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("weight"),
    animalIds: z.array(z.string().uuid()).min(1).max(500),
    measuredAt: z.string().datetime({ offset: true }),
    weightG: z.coerce.number().positive().max(100_000_000),
    notes: z.string().trim().max(5_000).nullable().optional(),
  }).strict(),
  z.object({
    kind: z.literal("shed"),
    animalIds: z.array(z.string().uuid()).min(1).max(500),
    occurredAt: z.string().datetime({ offset: true }),
    outcome: shedOutcomeSchema,
    notes: z.string().trim().max(5_000).nullable().optional(),
  }).strict(),
]).superRefine((value, ctx) => {
  if (new Set(value.animalIds).size !== value.animalIds.length) {
    ctx.addIssue({ code: "custom", path: ["animalIds"], message: "An animal can appear only once in a bulk care record" });
  }
});

export const pageQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
