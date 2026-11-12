import { z } from "zod";

const centsSchema = z.string().regex(/^-?[0-9]+$/, "Invalid integer cents value");

export const financeEntryResponseSchema = z.object({
  id: z.string(),
  entryType: z.enum(["income", "expense"]),
  occurredOn: z.string(),
  amountCents: centsSchema,
  currency: z.string().length(3),
  category: z.string(),
  description: z.string(),
  animalId: z.string().nullable(),
  documentId: z.string().nullable(),
  animal: z.object({ id: z.string(), name: z.string(), identifier: z.string().nullable() }).passthrough().nullable().optional(),
  document: z.object({ id: z.string(), originalFilename: z.string(), deletedAt: z.string().nullable() }).passthrough().nullable().optional(),
}).passthrough();

const financePaginationSchema = z.object({
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1),
  total: z.number().int().nonnegative(),
  totalPages: z.number().int().nonnegative(),
});

export const financeEntriesResponseSchema = z.object({
  entries: z.array(financeEntryResponseSchema),
  pagination: financePaginationSchema,
}).passthrough();

export const financeSummaryResponseSchema = z.object({
  currency: z.string().length(3),
  from: z.string().nullable(),
  to: z.string().nullable(),
  incomeCents: centsSchema,
  expenseCents: centsSchema,
  balanceCents: centsSchema,
  categories: z.array(z.object({
    entryType: z.enum(["income", "expense"]),
    category: z.string(),
    amountCents: centsSchema,
    count: z.number().int().nonnegative(),
  }).passthrough()),
}).passthrough();

export type FinanceEntryDto = z.infer<typeof financeEntryResponseSchema>;
export type FinanceEntriesResponseDto = z.infer<typeof financeEntriesResponseSchema>;
export type FinanceSummaryDto = z.infer<typeof financeSummaryResponseSchema>;

export function parseFinanceEntriesResponse(value: unknown): FinanceEntriesResponseDto {
  return financeEntriesResponseSchema.parse(value);
}

export function parseFinanceSummaryResponse(value: unknown): FinanceSummaryDto {
  return financeSummaryResponseSchema.parse(value);
}
