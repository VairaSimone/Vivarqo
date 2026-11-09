import { z } from "zod";

export const statuses = ["planned", "active", "completed", "cancelled"] as const;
const eventTypes = ["pairing", "observation", "ovulation", "gravid", "laying", "live_birth", "incubation_start", "hatch", "loss", "other"] as const;
const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const nullableUuid = z.string().uuid().nullable().optional();

export const reproductionCycleStatusSchema = z.enum(statuses);
export const reproductiveEventTypeSchema = z.enum(eventTypes);
export const reproductionPageSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(100),
});

export const createCycleSchema = z.object({
  name: z.string().trim().max(160).nullable().optional(),
  startedOn: dateOnly,
  endedOn: dateOnly.nullable().optional(),
  status: reproductionCycleStatusSchema.default("planned"),
  parentAAnimalId: nullableUuid,
  parentBAnimalId: nullableUuid,
  notes: z.string().trim().max(20_000).nullable().optional(),
}).strict().superRefine((value, ctx) => {
  if (value.endedOn && value.endedOn < value.startedOn) {
    ctx.addIssue({ code: "custom", path: ["endedOn"], message: "End date cannot precede start date" });
  }
  if (value.parentAAnimalId && value.parentAAnimalId === value.parentBAnimalId) {
    ctx.addIssue({ code: "custom", path: ["parentBAnimalId"], message: "Parents must be different animals" });
  }
});

export const patchCycleSchema = z.object({
  name: z.string().trim().max(160).nullable().optional(),
  startedOn: dateOnly.optional(),
  endedOn: dateOnly.nullable().optional(),
  status: reproductionCycleStatusSchema.optional(),
  parentAAnimalId: nullableUuid,
  parentBAnimalId: nullableUuid,
  notes: z.string().trim().max(20_000).nullable().optional(),
}).strict().refine((value) => Object.keys(value).length > 0, "At least one field is required");

export const createEventSchema = z.object({
  eventType: reproductiveEventTypeSchema,
  occurredAt: z.string().datetime({ offset: true }),
  animalId: nullableUuid,
  details: z.string().trim().max(20_000).nullable().optional(),
  temperatureC: z.coerce.number().min(-100).max(100).nullable().optional(),
  humidityPct: z.coerce.number().min(0).max(100).nullable().optional(),
}).strict();

export const patchEventSchema = z.object({
  eventType: reproductiveEventTypeSchema.optional(),
  occurredAt: z.string().datetime({ offset: true }).optional(),
  animalId: nullableUuid,
  details: z.string().trim().max(20_000).nullable().optional(),
  temperatureC: z.coerce.number().min(-100).max(100).nullable().optional(),
  humidityPct: z.coerce.number().min(0).max(100).nullable().optional(),
}).strict().refine((value) => Object.keys(value).length > 0, "At least one field is required");

export const createClutchSchema = z.object({
  cycleId: z.string().uuid(),
  laidOn: dateOnly,
  eggCount: z.coerce.number().int().min(0).max(10_000),
  status: z.string().trim().min(1).max(20).default("active"),
  incubatorLabel: z.string().trim().max(120).nullable().optional(),
  incubationStartedAt: z.string().datetime({ offset: true }).nullable().optional(),
  notes: z.string().trim().max(20_000).nullable().optional(),
}).strict();

export const patchClutchSchema = z.object({
  laidOn: dateOnly.optional(),
  eggCount: z.coerce.number().int().min(0).max(10_000).optional(),
  status: z.string().trim().min(1).max(20).optional(),
  incubatorLabel: z.string().trim().max(120).nullable().optional(),
  incubationStartedAt: z.string().datetime({ offset: true }).nullable().optional(),
  notes: z.string().trim().max(20_000).nullable().optional(),
}).strict().refine((value) => Object.keys(value).length > 0, "At least one field is required");

export const eggSchema = z.object({
  code: z.string().trim().max(80).nullable().optional(),
  status: z.string().trim().min(1).max(20).default("unknown"),
  notes: z.string().trim().max(10_000).nullable().optional(),
}).strict();

export const patchEggSchema = z.object({
  code: z.string().trim().max(80).nullable().optional(),
  status: z.string().trim().min(1).max(20).optional(),
  notes: z.string().trim().max(10_000).nullable().optional(),
}).strict().refine((value) => Object.keys(value).length > 0, "At least one field is required");

export const incubationSchema = z.object({
  recordedAt: z.string().datetime({ offset: true }),
  temperatureC: z.coerce.number().min(-100).max(100).nullable().optional(),
  humidityPct: z.coerce.number().min(0).max(100).nullable().optional(),
  eventType: z.string().trim().min(1).max(24),
  notes: z.string().trim().max(10_000).nullable().optional(),
}).strict();

export const offspringSchema = z.object({
  cycleId: z.string().uuid(),
  clutchId: z.string().uuid().nullable().optional(),
  bornOn: dateOnly,
  count: z.coerce.number().int().min(0).max(10_000),
  notes: z.string().trim().max(20_000).nullable().optional(),
}).strict();

export const newAnimalSchema = z.object({
  name: z.string().trim().min(1).max(120),
  identifier: z.string().trim().max(120).nullable().optional(),
  species: z.string().trim().min(1).max(160),
  sex: z.enum(["male", "female", "unknown"]).default("unknown"),
  morph: z.string().trim().max(200).nullable().optional(),
  birthDate: dateOnly.nullable().optional(),
}).strict();

export type ReproductionCycleStatus = z.infer<typeof reproductionCycleStatusSchema>;
export type ReproductiveEventType = z.infer<typeof reproductiveEventTypeSchema>;
export type CreateReproductionCycleInput = z.input<typeof createCycleSchema>;
export type PatchReproductionCycleInput = z.input<typeof patchCycleSchema>;
export type CreateReproductiveEventInput = z.input<typeof createEventSchema>;
export type PatchReproductiveEventInput = z.input<typeof patchEventSchema>;
export type CreateClutchInput = z.input<typeof createClutchSchema>;
export type PatchClutchInput = z.input<typeof patchClutchSchema>;
export type EggInput = z.input<typeof eggSchema>;
export type IncubationLogInput = z.input<typeof incubationSchema>;
export type OffspringBatchInput = z.input<typeof offspringSchema>;

export interface AnimalSummaryDto {
  id: string;
  name: string;
  identifier?: string | null;
  species?: string;
}

export interface ReproductiveEventDto {
  id: string;
  eventType: ReproductiveEventType;
  occurredAt: string;
  animalId: string | null;
  details: string | null;
  temperatureC: number | null;
  humidityPct: number | null;
  animal?: Pick<AnimalSummaryDto, "id" | "name"> | null;
}

export interface EggDto {
  id: string;
  clutchId: string;
  code: string | null;
  status: string;
  notes: string | null;
}

export interface IncubationLogDto {
  id: string;
  clutchId: string;
  recordedAt: string;
  temperatureC: number | null;
  humidityPct: number | null;
  eventType: string;
  notes: string | null;
}

export interface ClutchDto {
  id: string;
  cycleId: string;
  laidOn: string;
  eggCount: number;
  status: string;
  incubatorLabel: string | null;
  incubationStartedAt: string | null;
  notes: string | null;
  _count?: { eggs: number; incubationLogs: number };
}

export interface OffspringBatchDto {
  id: string;
  cycleId: string;
  clutchId: string | null;
  bornOn: string;
  count: number;
  notes: string | null;
  cycle?: Pick<ReproductionCycleSummaryDto, "id" | "name">;
  clutch?: Pick<ClutchDto, "id" | "laidOn" | "eggCount"> | null;
}

export interface ReproductionCycleSummaryDto {
  id: string;
  name: string | null;
  startedOn: string;
  endedOn: string | null;
  status: ReproductionCycleStatus;
  parentAAnimalId: string | null;
  parentBAnimalId: string | null;
  notes: string | null;
  parentA?: AnimalSummaryDto | null;
  parentB?: AnimalSummaryDto | null;
  _count?: { events: number; clutches: number; offspringBatches: number };
}

export interface ReproductionCycleDto extends ReproductionCycleSummaryDto {
  events: ReproductiveEventDto[];
  clutches: ClutchDto[];
  offspringBatches: OffspringBatchDto[];
}

export interface ClutchDetailDto extends ClutchDto {
  cycle: Pick<ReproductionCycleSummaryDto, "id" | "name" | "status">;
  eggs: EggDto[];
  incubationLogs: IncubationLogDto[];
}

export interface ReproductionRecordDto {
  id: string;
  name?: string | null;
  startedOn?: string;
  endedOn?: string | null;
  status?: string;
  parentAAnimalId?: string | null;
  parentBAnimalId?: string | null;
  laidOn?: string;
  eggCount?: number;
  incubatorLabel?: string | null;
  incubationStartedAt?: string | null;
  occurredAt?: string;
  eventType?: string;
  animalId?: string | null;
  details?: string | null;
  temperatureC?: number | null;
  humidityPct?: number | null;
  recordedAt?: string;
  clutchId?: string | null;
  code?: string | null;
  notes?: string | null;
  bornOn?: string;
  count?: number;
  parentA?: AnimalSummaryDto | null;
  parentB?: AnimalSummaryDto | null;
  animal?: Pick<AnimalSummaryDto, "id" | "name"> | null;
  cycle?: Pick<ReproductionCycleSummaryDto, "id" | "name" | "status">;
  _count?: { events?: number; clutches?: number; offspringBatches?: number; eggs?: number; incubationLogs?: number };
  events?: ReproductiveEventDto[];
  clutches?: ClutchDto[];
  offspringBatches?: OffspringBatchDto[];
  eggs?: EggDto[];
  incubationLogs?: IncubationLogDto[];
}
