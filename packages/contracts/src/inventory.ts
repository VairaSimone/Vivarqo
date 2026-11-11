export interface InventoryItemDto {
  id: string;
  name: string;
  category: string;
  unit: string;
  quantityOnHand: number;
  minimumQuantity: number | null;
  notes: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface InventoryMovementDto {
  id: string;
  itemId: string;
  movementType: "in" | "out" | "adjustment";
  quantity: number;
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
  quantityOnHand?: number;
  minimumQuantity?: number | null;
  isActive?: boolean;
  notes?: string | null;
  occurredAt?: string;
  movementType?: "in" | "out" | "adjustment";
  quantity?: number;
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
