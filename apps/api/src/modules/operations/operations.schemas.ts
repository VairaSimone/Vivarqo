import { z } from "zod";
import { AppError } from "../../errors/app-error.js";

export const taskCategories = [
  "feeding",
  "weighing",
  "shed_check",
  "cleaning",
  "reproduction",
  "document",
  "inventory",
  "custom",
] as const;

export const taskStatuses = ["open", "completed", "dismissed"] as const;
const dateTimeWithOffset = z.string().datetime({ offset: true });
const optionalNullableUuid = z.string().uuid().nullable().optional();

export const createTaskSchema = z.object({
  title: z.string().trim().min(1).max(160),
  description: z.string().trim().max(10_000).nullable().optional(),
  category: z.enum(taskCategories),
  dueAt: dateTimeWithOffset,
  animalId: optionalNullableUuid,
}).strict();

export const patchTaskSchema = z.object({
  title: z.string().trim().min(1).max(160).optional(),
  description: z.string().trim().max(10_000).nullable().optional(),
  category: z.enum(taskCategories).optional(),
  dueAt: dateTimeWithOffset.optional(),
  animalId: optionalNullableUuid,
  status: z.enum(["open", "dismissed"]).optional(),
}).strict().refine((value) => Object.keys(value).length > 0, "At least one field is required");

export const createReminderRuleSchema = z.object({
  title: z.string().trim().min(1).max(160),
  category: z.enum(taskCategories),
  intervalDays: z.coerce.number().int().min(1).max(3650),
  nextDueAt: dateTimeWithOffset,
  animalId: optionalNullableUuid,
  isEnabled: z.boolean().optional().default(true),
}).strict();

export const patchReminderRuleSchema = z.object({
  title: z.string().trim().min(1).max(160).optional(),
  category: z.enum(taskCategories).optional(),
  intervalDays: z.coerce.number().int().min(1).max(3650).optional(),
  nextDueAt: dateTimeWithOffset.optional(),
  animalId: optionalNullableUuid,
  isEnabled: z.boolean().optional(),
}).strict().refine((value) => Object.keys(value).length > 0, "At least one field is required");

export const taskListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  status: z.enum(taskStatuses).or(z.literal("all")).default("open"),
  category: z.enum(taskCategories).optional(),
  animalId: z.string().uuid().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
});

export const reminderListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  enabled: z.enum(["true", "false", "all"]).default("true"),
});

export const calendarQuerySchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  view: z.enum(["month", "week", "list"]).default("list"),
  includeDismissed: z.enum(["true", "false"]).default("false"),
}).strict();

export function parseBody<TSchema extends z.ZodType>(schema: TSchema, body: unknown): z.output<TSchema> {
  const result = schema.safeParse(body);
  if (!result.success) {
    throw new AppError(400, "VALIDATION_ERROR", "Request validation failed", {
      issues: result.error.issues.map((issue) => ({
        path: issue.path.map(String).join("."),
        message: issue.message,
      })),
    });
  }
  return result.data;
}

