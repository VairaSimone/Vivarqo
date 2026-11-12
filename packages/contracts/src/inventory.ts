import { z } from "zod";

export interface InventoryItemDto {
  id: string;
  name: string;
  category: string;
  unit: string;
  quantityOnHand: number | string;
  minimumQuantity: number | string | null;
  notes: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface InventoryMovementDto {
  id: string;
  itemId: string;
  movementType: "in" | "out" | "adjustment";
  quantity: number | string;
  occurredAt: string;
  unitCostCents?: number | null;
  reference: string | null;
  notes: string | null;
}

export interface DocumentDto {
  id: string;
  animalId: string | null;
  originalFilename: string;
  sizeBytes: string;
  category: string | null;
  note: string | null;
  createdAt: string;
  updatedAt: string;
  status?: "active" | "pending_deletion" | "deleted";
  animal?: { id: string; name: string } | null;
  cycle?: { id: string; name: string | null } | null;
}

export interface DocumentDeletionJobDto {
  id: string;
  documentId: string;
  status: string;
  attempts: number;
  lastError?: string | null;
  nextAttemptAt?: string | null;
  lastErrorCode?: string | null;
  createdAt?: string;
  completedAt?: string | null;
  document: { originalFilename: string } | null;
}

export interface InventoryDocumentRecordDto {
  id: string;
  name?: string;
  category?: string;
  unit?: string;
  quantityOnHand?: number | string;
  minimumQuantity?: number | string | null;
  isActive?: boolean;
  notes?: string | null;
  occurredAt?: string;
  movementType?: "in" | "out" | "adjustment";
  quantity?: number | string;
  unitCost?: number | null;
  reference?: string | null;
  note?: string | null;
  originalFilename?: string;
  sizeBytes?: string;
  createdAt?: string;
  animalId?: string | null;
  status?: string;
  documentId?: string;
  attempts?: number;
  lastError?: string | null;
  nextAttemptAt?: string | null;
}


const inventoryDecimalSchema = z.union([
  z.number().finite(),
  z.string().regex(/^-?[0-9]+([.][0-9]{1,3})?$/, "Invalid decimal value"),
]);
const inventoryPaginationSchema = z.object({
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1),
  total: z.number().int().nonnegative(),
  totalPages: z.number().int().nonnegative(),
});
export const inventoryItemsResponseSchema = z.object({
  items: z.array(z.object({
    id: z.string(), name: z.string(), category: z.string(), unit: z.string(),
    quantityOnHand: inventoryDecimalSchema, minimumQuantity: inventoryDecimalSchema.nullable(),
    notes: z.string().nullable(), isActive: z.boolean(), createdAt: z.string(), updatedAt: z.string(),
  }).passthrough()),
  pagination: inventoryPaginationSchema,
}).passthrough();
export const inventoryMovementsResponseSchema = z.object({
  movements: z.array(z.object({
    id: z.string(), itemId: z.string(), movementType: z.enum(["in", "out", "adjustment"]),
    quantity: inventoryDecimalSchema, occurredAt: z.string(),
    unitCostCents: z.number().int().nullable().optional(),
    reference: z.string().nullable(), notes: z.string().nullable(),
  }).passthrough()),
  pagination: inventoryPaginationSchema,
}).passthrough();
export type InventoryItemsResponseDto = z.infer<typeof inventoryItemsResponseSchema>;
export type InventoryMovementsResponseDto = z.infer<typeof inventoryMovementsResponseSchema>;
export function parseInventoryItemsResponse(value: unknown): InventoryItemsResponseDto {
  return inventoryItemsResponseSchema.parse(value);
}
export function parseInventoryMovementsResponse(value: unknown): InventoryMovementsResponseDto {
  return inventoryMovementsResponseSchema.parse(value);
}
