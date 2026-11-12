import { z } from "zod";

const careDecimalSchema = z.union([
  z.number().finite(),
  z.string().regex(/^-?[0-9]+([.][0-9]{1,3})?$/, "Invalid decimal value"),
]);

export const feedingEntryResponseSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  animalId: z.string(),
  outcome: z.enum(["ate", "refused", "not_offered", "unknown"]),
  foodType: z.string().nullable(),
  foodSize: z.string().nullable(),
  foodWeightG: careDecimalSchema.nullable(),
  notes: z.string().nullable(),
  animal: z.object({
    id: z.string(),
    name: z.string(),
    identifier: z.string().nullable(),
    species: z.string(),
    status: z.string(),
  }).passthrough().nullable().optional(),
}).passthrough();

export const feedingSessionResponseSchema = z.object({
  id: z.string(),
  performedAt: z.string(),
  notes: z.string().nullable(),
  entries: z.array(feedingEntryResponseSchema),
}).passthrough();

export const feedingSessionsResponseSchema = z.object({
  sessions: z.array(feedingSessionResponseSchema),
  pagination: z.object({
    page: z.number().int().min(1),
    pageSize: z.number().int().min(1),
    total: z.number().int().nonnegative(),
    totalPages: z.number().int().nonnegative(),
  }),
}).passthrough();

export type FeedingEntryDto = z.infer<typeof feedingEntryResponseSchema>;
export type FeedingSessionDto = z.infer<typeof feedingSessionResponseSchema>;
export type FeedingSessionsResponseDto = z.infer<typeof feedingSessionsResponseSchema>;

export function parseFeedingSessionsResponse(value: unknown): FeedingSessionsResponseDto {
  return feedingSessionsResponseSchema.parse(value);
}
