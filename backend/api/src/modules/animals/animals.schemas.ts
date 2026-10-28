import { z } from "zod";

const nullableText = (max: number) => z.string().trim().max(max).nullable().optional();
function isValidCalendarDate(value: string): boolean {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD").refine(isValidCalendarDate, "Invalid calendar date");

export const animalStatusSchema = z.enum(["active", "sold", "transferred", "deceased", "archived"]);
export const animalSexSchema = z.enum(["male", "female", "unknown"]);
export const feedingOutcomeSchema = z.enum(["ate", "refused", "not_offered", "unknown"]);
export const shedOutcomeSchema = z.enum(["complete", "partial", "unknown"]);

export const animalFields = {
  name: z.string().trim().min(1).max(120),
  identifier: nullableText(120),
  species: z.string().trim().min(1).max(160),
  sex: animalSexSchema.default("unknown"),
  morph: nullableText(200),
  geneticsNotes: z.string().trim().max(10_000).nullable().optional(),
  birthDate: dateOnly.nullable().optional(),
  birthDateEstimated: z.boolean().default(false),
  acquiredDate: dateOnly.nullable().optional(),
  originDescription: z.string().trim().max(5_000).nullable().optional(),
  previousBreeder: nullableText(160),
  locationLabel: nullableText(160),
  status: animalStatusSchema.default("active"),
  notes: z.string().trim().max(10_000).nullable().optional(),
};

export const createAnimalSchema = z.object(animalFields).strict().superRefine((value, ctx) => {
  if (value.status === "archived") {
    ctx.addIssue({ code: "custom", path: ["status"], message: "Use the archive action to archive an animal" });
  }
});

export const patchAnimalSchema = z.object({
  name: animalFields.name.optional(),
  identifier: animalFields.identifier,
  species: animalFields.species.optional(),
  sex: animalSexSchema.optional(),
  morph: animalFields.morph,
  geneticsNotes: animalFields.geneticsNotes,
  birthDate: animalFields.birthDate,
  birthDateEstimated: z.boolean().optional(),
  acquiredDate: animalFields.acquiredDate,
  originDescription: animalFields.originDescription,
  previousBreeder: animalFields.previousBreeder,
  locationLabel: animalFields.locationLabel,
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
  notes: z.string().trim().max(5_000).nullable().optional(),
}).strict();

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
  outcome: feedingOutcomeSchema.optional(),
  foodType: nullableText(120),
  foodSize: nullableText(120),
  foodWeightG: z.coerce.number().positive().max(1_000_000).nullable().optional(),
  notes: z.string().trim().max(5_000).nullable().optional(),
}).strict().refine((value) => Object.keys(value).length > 0, "At least one field is required");

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

export const pageQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
