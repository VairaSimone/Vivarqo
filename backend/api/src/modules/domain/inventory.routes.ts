import { Router } from "express";
import { z } from "zod";
import { AppError } from "../../errors/app-error.js";
import { prisma } from "../../db/prisma.js";
import { requireSession, type AuthContext } from "../auth/session.js";
import { decimalToScaledInteger, hasMaximumDecimalPlaces } from "./decimal-precision.js";

const categories = ["food", "substrate", "material", "equipment", "other"] as const;
const movementTypes = ["in", "out", "adjustment"] as const;
const scale = 1000;
const movementListQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
function parseBody<T extends z.ZodType>(schema: T, value: unknown): z.output<T> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new AppError(400, "VALIDATION_ERROR", "Request validation failed", { issues: parsed.error.issues.map((i) => ({ path: i.path.map(String).join("."), message: i.message })) });
  return parsed.data;
}
function routeUuid(value: string | string[] | undefined): string {
  const id = Array.isArray(value) ? value[0] : value;
  if (!id || !z.string().uuid().safeParse(id).success) throw new AppError(400, "INVALID_ID", "Invalid inventory id");
  return id;
}
const quantity = z.coerce.number().finite().min(0).max(999_999_999.999)
  .refine((value) => hasMaximumDecimalPlaces(value, 3), "Quantity supports at most 3 decimal places");
const createItemSchema = z.object({
  name: z.string().trim().min(1).max(160),
  category: z.enum(categories),
  unit: z.string().trim().min(1).max(24),
  quantityOnHand: quantity.default(0),
  minimumQuantity: quantity.nullable().optional(),
  notes: z.string().trim().max(10_000).nullable().optional(),
}).strict();
const patchItemSchema = z.object({
  name: z.string().trim().min(1).max(160).optional(),
  category: z.enum(categories).optional(),
  unit: z.string().trim().min(1).max(24).optional(),
  minimumQuantity: quantity.nullable().optional(),
  notes: z.string().trim().max(10_000).nullable().optional(),
  isActive: z.boolean().optional(),
}).strict().refine((v) => Object.keys(v).length > 0, "At least one field is required");
const supplierCreateSchema = z.object({
  name: z.string().trim().min(1).max(160),
  email: z.string().trim().email().max(254).nullable().optional(),
  phone: z.string().trim().max(40).nullable().optional(),
  website: z.string().trim().url().max(255).nullable().optional(),
  notes: z.string().trim().max(5000).nullable().optional(),
}).strict();
const lotCreateSchema = z.object({
  supplierId: z.string().uuid().nullable().optional(),
  lotCode: z.string().trim().max(120).nullable().optional(),
  quantity: z.coerce.number().finite().positive().max(999_999_999.999).refine((v) => hasMaximumDecimalPlaces(v, 3)),
  unitCostCents: z.coerce.number().int().min(0).max(2_000_000_000).nullable().optional(),
  purchasedAt: z.string().datetime({ offset: true }),
  expiresAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  notes: z.string().trim().max(5000).nullable().optional(),
}).strict();
const movementSchema = z.object({
  movementType: z.enum(movementTypes),
  quantity: z.coerce.number().finite().min(0).max(999_999_999.999)
    .refine((value) => hasMaximumDecimalPlaces(value, 3), "Quantity supports at most 3 decimal places"),
  occurredAt: z.string().datetime({ offset: true }),
  unitCostCents: z.coerce.number().int().min(0).max(2_000_000_000).nullable().optional(),
  reference: z.string().trim().max(160).nullable().optional(),
  notes: z.string().trim().max(10_000).nullable().optional(),
}).strict().superRefine((value, ctx) => {
  if (value.movementType !== "adjustment" && value.quantity <= 0) {
    ctx.addIssue({
      code: "custom",
      path: ["quantity"],
      message: "Inbound and outbound movement quantities must be greater than zero",
    });
  }
});

function asMilli(value: string | number): number {
  const parsed = decimalToScaledInteger(value, 3);
  if (parsed === null) throw new AppError(400, "QUANTITY_OUT_OF_RANGE", "Quantity exceeds supported precision");
  return parsed;
}

export function createInventoryRouter() {
  const router = Router();

  router.get("/inventory/items", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    const query = parseBody(z.object({
      page: z.coerce.number().int().min(1).default(1),
      pageSize: z.coerce.number().int().min(1).max(100).default(25),
      active: z.enum(["true", "false", "all"]).default("true"),
      category: z.enum(categories).optional(),
      q: z.string().trim().max(160).optional(),
      lowStock: z.enum(["true", "false"]).optional(),
    }), req.query);
    if (query.lowStock === "true") {
      const category = query.category ?? "";
      const q = query.q ?? "";
      const activeAll = query.active === "all";
      const active = query.active === "true";
      const [countRows, idRows] = await Promise.all([
        prisma.$queryRaw<Array<{ count: bigint }>>`
          SELECT COUNT(*)::bigint AS count
          FROM inventory_items
          WHERE user_id = ${auth.userId}::uuid
            AND (${activeAll} OR is_active = ${active})
            AND (${query.category === undefined} OR category::text = ${category})
            AND (${query.q === undefined} OR (name ILIKE '%' || ${q} || '%' OR category::text ILIKE '%' || ${q} || '%' OR unit ILIKE '%' || ${q} || '%' OR COALESCE(notes, '') ILIKE '%' || ${q} || '%'))
            AND minimum_quantity IS NOT NULL
            AND quantity_on_hand <= minimum_quantity
        `,
        prisma.$queryRaw<Array<{ id: string }>>`
          SELECT id::text AS id
          FROM inventory_items
          WHERE user_id = ${auth.userId}::uuid
            AND (${activeAll} OR is_active = ${active})
            AND (${query.category === undefined} OR category::text = ${category})
            AND (${query.q === undefined} OR (name ILIKE '%' || ${q} || '%' OR category::text ILIKE '%' || ${q} || '%' OR unit ILIKE '%' || ${q} || '%' OR COALESCE(notes, '') ILIKE '%' || ${q} || '%'))
            AND minimum_quantity IS NOT NULL
            AND quantity_on_hand <= minimum_quantity
          ORDER BY is_active DESC, name ASC
          LIMIT ${query.pageSize} OFFSET ${(query.page - 1) * query.pageSize}
        `,
      ]);
      const total = Number(countRows[0]?.count ?? 0n);
      const ids = idRows.map((row) => row.id);
      const items = ids.length === 0 ? [] : await prisma.inventoryItem.findMany({
        where: { userId: auth.userId, id: { in: ids } },
        orderBy: [{ isActive: "desc" }, { name: "asc" }],
      });
      const byId = new Map(items.map((item) => [item.id, item]));
      res.status(200).json({
        items: ids.map((id) => byId.get(id)).filter((item) => item !== undefined),
        pagination: { page: query.page, pageSize: query.pageSize, total, totalPages: Math.ceil(total / query.pageSize) },
      });
      return;
    }

    const where: Record<string, unknown> = { userId: auth.userId };
    if (query.active !== "all") where.isActive = query.active === "true";
    if (query.category) where.category = query.category;
    if (query.q) {
      const search = query.q;
      const searchFilters: Array<Record<string, unknown>> = [
        { name: { contains: search, mode: "insensitive" } },
        { unit: { contains: search, mode: "insensitive" } },
        { notes: { contains: search, mode: "insensitive" } },
      ];
      const exactCategory = categories.find((category) => category === search);
      if (exactCategory) searchFilters.push({ category: exactCategory });
      where.OR = searchFilters;
    }
    const [total, items] = await Promise.all([
      prisma.inventoryItem.count({ where: where as never }),
      prisma.inventoryItem.findMany({
        where: where as never,
        orderBy: [{ isActive: "desc" }, { name: "asc" }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    res.status(200).json({
      items,
      pagination: { page: query.page, pageSize: query.pageSize, total, totalPages: Math.ceil(total / query.pageSize) },
    });
  });

  router.post("/inventory/items", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    const input = parseBody(createItemSchema, req.body);
    const item = await prisma.$transaction(async (tx) => {
      const created = await tx.inventoryItem.create({
        data: {
          userId: auth.userId, name: input.name, category: input.category, unit: input.unit,
          quantityOnHand: input.quantityOnHand, minimumQuantity: input.minimumQuantity ?? null,
          notes: input.notes ?? null,
        },
      });
      if (input.quantityOnHand > 0) {
        await tx.stockMovement.create({
          data: { itemId: created.id, movementType: "in", quantity: input.quantityOnHand, occurredAt: new Date(), reference: "Initial stock", notes: "Opening balance" },
        });
      }
      await tx.auditEvent.create({ data: { userId: auth.userId, action: "inventory_item.created", entityType: "inventory_item", entityId: created.id } });
      return created;
    });
    res.status(201).json({ item });
  });

  router.get("/inventory/items/:id", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    const id = routeUuid(req.params.id);
    const item = await prisma.inventoryItem.findFirst({
      where: { id, userId: auth.userId },
      include: { movements: { orderBy: { occurredAt: "desc" }, take: 100 } },
    });
    if (!item) throw new AppError(404, "INVENTORY_ITEM_NOT_FOUND", "Inventory item not found");
    res.status(200).json({ item, lowStock: item.minimumQuantity !== null && Number(item.quantityOnHand) <= Number(item.minimumQuantity) });
  });

  router.patch("/inventory/items/:id", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    const id = routeUuid(req.params.id);
    const input = parseBody(patchItemSchema, req.body);
    const existing = await prisma.inventoryItem.findFirst({ where: { id, userId: auth.userId } });
    if (!existing) throw new AppError(404, "INVENTORY_ITEM_NOT_FOUND", "Inventory item not found");
    const item = await prisma.inventoryItem.update({ where: { id }, data: input as never });
    res.status(200).json({ item });
  });

  router.post("/inventory/items/:id/movements", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    const id = routeUuid(req.params.id);
    const input = parseBody(movementSchema, req.body);
    const result = await prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ quantity_on_hand: string; is_active: boolean; name: string }>>` 
        SELECT quantity_on_hand::text, is_active, name
        FROM inventory_items
        WHERE id = ${id}::uuid AND user_id = ${auth.userId}::uuid
        FOR UPDATE
      `;
      const current = locked[0];
      if (!current) throw new AppError(404, "INVENTORY_ITEM_NOT_FOUND", "Inventory item not found");
      if (!current.is_active) throw new AppError(409, "INVENTORY_ITEM_ARCHIVED", "Archived inventory items cannot receive new movements");
      const amount = asMilli(input.quantity);
      const currentAmount = asMilli(current.quantity_on_hand);
      let newAmount: number;
      if (input.movementType === "in") newAmount = currentAmount + amount;
      else if (input.movementType === "out") newAmount = currentAmount - amount;
      else newAmount = amount;
      if (newAmount < 0) throw new AppError(409, "INSUFFICIENT_STOCK", "The movement would make stock negative", { available: currentAmount / scale, requested: input.quantity });
      const stockToRemove = input.movementType === "out" ? amount : input.movementType === "adjustment" && newAmount < currentAmount ? currentAmount - newAmount : 0;
      if (stockToRemove > 0) {
        let remainingToRemove = stockToRemove;
        const lots = await tx.$queryRaw<Array<{ id: string; quantity_remaining: string }>>`
          SELECT id::text, quantity_remaining::text
          FROM inventory_lots
          WHERE item_id = ${id}::uuid AND quantity_remaining > 0
          ORDER BY expires_at ASC NULLS LAST, purchased_at ASC, id ASC
          FOR UPDATE
        `;
        for (const lot of lots) {
          if (remainingToRemove <= 0) break;
          const lotAvailable = asMilli(lot.quantity_remaining);
          const taken = Math.min(remainingToRemove, lotAvailable);
          await tx.inventoryLot.update({ where: { id: lot.id }, data: { quantityRemaining: { decrement: taken / scale } } });
          remainingToRemove -= taken;
        }
      }
      if (newAmount > 999_999_999_999) throw new AppError(400, "QUANTITY_OUT_OF_RANGE", "Resulting stock exceeds the supported precision");
      const movement = await tx.stockMovement.create({
        data: {
          itemId: id, movementType: input.movementType, quantity: input.quantity,
          unitCostCents: input.unitCostCents ?? null, occurredAt: new Date(input.occurredAt),
          reference: input.reference ?? null, notes: input.notes ?? null,
        },
      });
      const item = await tx.inventoryItem.update({ where: { id }, data: { quantityOnHand: newAmount / scale } });
      if (input.movementType === "out" && input.unitCostCents != null) {
        const amountCents = (BigInt(input.unitCostCents) * BigInt(amount) + 500n) / 1000n;
        if (amountCents > 0n) {
          await tx.financeEntry.create({ data: {
            userId: auth.userId, entryType: "expense", occurredOn: new Date(input.occurredAt.slice(0, 10) + "T00:00:00.000Z"),
            amountCents, currency: "EUR", category: "Inventario",
            description: "Consumo inventario: " + current.name + (input.reference ? " · " + input.reference : ""),
            sourceStockMovementId: movement.id,
          } });
        }
      }
      await tx.auditEvent.create({
        data: {
          userId: auth.userId, action: "inventory.movement.created", entityType: "stock_movement", entityId: movement.id,
          metadata: { itemId: id, movementType: input.movementType, quantity: input.quantity, balanceAfter: newAmount / scale },
        },
      });
      return { movement, item };
    });
    res.status(201).json({
      ...result,
      lowStock: result.item.minimumQuantity !== null && Number(result.item.quantityOnHand) <= Number(result.item.minimumQuantity),
    });
  });

  router.get("/inventory/items/:id/movements", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    const id = routeUuid(req.params.id);
    const owned = await prisma.inventoryItem.findFirst({ where: { id, userId: auth.userId }, select: { id: true } });
    if (!owned) throw new AppError(404, "INVENTORY_ITEM_NOT_FOUND", "Inventory item not found");
    const query = parseBody(movementListQuery, req.query);
    const where = { itemId: id };
    const [total, movements] = await Promise.all([
      prisma.stockMovement.count({ where }),
      prisma.stockMovement.findMany({
        where,
        orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    res.status(200).json({
      movements,
      pagination: { page: query.page, pageSize: query.pageSize, total, totalPages: Math.ceil(total / query.pageSize) },
    });
  });

  router.post("/inventory/items/:id/archive", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    const id = routeUuid(req.params.id);
    const item = await prisma.inventoryItem.findFirst({ where: { id, userId: auth.userId } });
    if (!item) throw new AppError(404, "INVENTORY_ITEM_NOT_FOUND", "Inventory item not found");
    const result = await prisma.inventoryItem.update({ where: { id }, data: { isActive: false } });
    res.status(200).json({ item: result });
  });


  // Suppliers are account-scoped; supplier records never expose another workspace's data.
  router.get("/inventory/suppliers", requireSession, async (_req, res) => {
    const auth = res.locals.auth as AuthContext;
    const suppliers = await prisma.inventorySupplier.findMany({ where: { userId: auth.userId }, orderBy: { name: "asc" } });
    res.status(200).json({ suppliers });
  });

  router.post("/inventory/suppliers", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    const input = parseBody(supplierCreateSchema, req.body);
    const supplier = await prisma.inventorySupplier.create({ data: { userId: auth.userId, ...input } });
    res.status(201).json({ supplier });
  });

  router.get("/inventory/items/:id/lots", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    const id = routeUuid(req.params.id);
    const item = await prisma.inventoryItem.findFirst({ where: { id, userId: auth.userId }, select: { id: true } });
    if (!item) throw new AppError(404, "INVENTORY_ITEM_NOT_FOUND", "Inventory item not found");
    const lots = await prisma.inventoryLot.findMany({
      where: { itemId: id },
      include: { supplier: { select: { id: true, name: true } } },
      orderBy: [{ expiresAt: "asc" }, { purchasedAt: "asc" }],
    });
    res.status(200).json({ lots });
  });

  router.post("/inventory/items/:id/lots", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    const id = routeUuid(req.params.id);
    const input = parseBody(lotCreateSchema, req.body);
    const result = await prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ id: string; is_active: boolean }>>`
        SELECT id::text, is_active FROM inventory_items
        WHERE id = ${id}::uuid AND user_id = ${auth.userId}::uuid FOR UPDATE
      `;
      if (!locked[0]) throw new AppError(404, "INVENTORY_ITEM_NOT_FOUND", "Inventory item not found");
      if (!locked[0].is_active) throw new AppError(409, "INVENTORY_ITEM_ARCHIVED", "Archived inventory items cannot receive stock");
      if (input.supplierId) {
        const supplier = await tx.inventorySupplier.findFirst({ where: { id: input.supplierId, userId: auth.userId }, select: { id: true } });
        if (!supplier) throw new AppError(404, "INVENTORY_SUPPLIER_NOT_FOUND", "Supplier not found");
      }
      const lot = await tx.inventoryLot.create({ data: {
        itemId: id, supplierId: input.supplierId ?? null, lotCode: input.lotCode ?? null,
        quantityReceived: input.quantity, quantityRemaining: input.quantity,
        unitCostCents: input.unitCostCents ?? null, purchasedAt: new Date(input.purchasedAt),
        expiresAt: input.expiresAt ? new Date(input.expiresAt + "T00:00:00.000Z") : null,
        notes: input.notes ?? null,
      } });
      const movement = await tx.stockMovement.create({ data: {
        itemId: id, lotId: lot.id, movementType: "in", quantity: input.quantity,
        unitCostCents: input.unitCostCents ?? null, occurredAt: new Date(input.purchasedAt),
        reference: input.lotCode ?? "Lot purchase", notes: input.notes ?? null,
      } });
      const item = await tx.inventoryItem.update({ where: { id }, data: { quantityOnHand: { increment: input.quantity } } });
      if (input.unitCostCents != null) {
        const cents = BigInt(input.unitCostCents) * BigInt(asMilli(input.quantity)) / 1000n;
        if (cents > 0n) await tx.financeEntry.create({ data: {
          userId: auth.userId, entryType: "expense", occurredOn: new Date(input.purchasedAt.slice(0, 10) + "T00:00:00.000Z"),
          amountCents: cents, currency: "EUR", category: "Inventario",
          description: "Acquisto inventario: " + item.name, sourceStockMovementId: movement.id,
        } });
      }
      await tx.auditEvent.create({ data: { userId: auth.userId, action: "inventory.lot.created", entityType: "inventory_lot", entityId: lot.id } });
      return { lot, item, movement };
    });
    res.status(201).json(result);
  });

  router.get("/inventory/summary", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext;
    const days = parseBody(z.coerce.number().int().min(7).max(180).default(30), req.query.days);
    const now = new Date();
    const horizon = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    const since = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
    const [lowStock, expiredLots, expiringLots, usage] = await Promise.all([
      prisma.$queryRaw<Array<{ id: string; name: string; quantity_on_hand: string; minimum_quantity: string; unit: string }>>`
        SELECT id::text, name, quantity_on_hand::text, minimum_quantity::text, unit
        FROM inventory_items
        WHERE user_id = ${auth.userId}::uuid AND is_active = TRUE
          AND minimum_quantity IS NOT NULL AND quantity_on_hand <= minimum_quantity
        ORDER BY name ASC
      `,
      prisma.inventoryLot.findMany({ where: { item: { userId: auth.userId }, quantityRemaining: { gt: 0 }, expiresAt: { lt: new Date(now.toISOString().slice(0, 10) + "T00:00:00.000Z") } }, include: { item: { select: { id: true, name: true, unit: true } } }, orderBy: { expiresAt: "asc" } }),
      prisma.inventoryLot.findMany({ where: { item: { userId: auth.userId }, quantityRemaining: { gt: 0 }, expiresAt: { gte: new Date(now.toISOString().slice(0, 10) + "T00:00:00.000Z"), lte: horizon } }, include: { item: { select: { id: true, name: true, unit: true } } }, orderBy: { expiresAt: "asc" } }),
      prisma.$queryRaw<Array<{ item_id: string; consumed: string }>>`
        SELECT item_id::text, COALESCE(SUM(quantity), 0)::text AS consumed
        FROM stock_movements
        WHERE movement_type = 'out' AND occurred_at >= ${since}
          AND item_id IN (SELECT id FROM inventory_items WHERE user_id = ${auth.userId}::uuid)
        GROUP BY item_id
      `,
    ]);
    const consumption = usage.map((row) => {
      const averageDaily = Number(row.consumed) / days;
      return { itemId: row.item_id, averageDailyConsumption: averageDaily, forecastDaysRemaining: averageDaily > 0 ? null : null };
    });
    const items = await prisma.inventoryItem.findMany({ where: { userId: auth.userId, id: { in: consumption.map((x) => x.itemId) } }, select: { id: true, quantityOnHand: true, unit: true } });
    const balances = new Map(items.map((item) => [item.id, item]));
    res.status(200).json({
      periodDays: days, lowStock, expiredLots, expiringLots,
      consumption: consumption.map((row) => {
        const item = balances.get(row.itemId);
        const forecast = row.averageDailyConsumption > 0 && item ? Number(item.quantityOnHand) / row.averageDailyConsumption : null;
        return { ...row, forecastDaysRemaining: forecast, unit: item?.unit ?? null };
      }),
    });
  });


  const supplierPatchSchema = z.object({
    name: z.string().trim().min(1).max(160).optional(),
    email: z.string().trim().email().max(254).nullable().optional(),
    phone: z.string().trim().max(40).nullable().optional(),
    website: z.string().trim().url().max(255).nullable().optional(),
    notes: z.string().trim().max(5000).nullable().optional(),
  }).strict().refine((value) => Object.keys(value).length > 0, "At least one field is required");
  router.patch("/inventory/suppliers/:id", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext, id = routeUuid(req.params.id);
    const input = parseBody(supplierPatchSchema, req.body);
    const existing = await prisma.inventorySupplier.findFirst({ where: { id, userId: auth.userId }, select: { id: true } });
    if (!existing) throw new AppError(404, "INVENTORY_SUPPLIER_NOT_FOUND", "Supplier not found");
    res.status(200).json({ supplier: await prisma.inventorySupplier.update({ where: { id }, data: input }) });
  });
  router.delete("/inventory/suppliers/:id", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext, id = routeUuid(req.params.id);
    const deleted = await prisma.inventorySupplier.deleteMany({ where: { id, userId: auth.userId } });
    if (!deleted.count) throw new AppError(404, "INVENTORY_SUPPLIER_NOT_FOUND", "Supplier not found");
    res.status(204).send();
  });

  const lotPatchSchema = z.object({
    supplierId: z.string().uuid().nullable().optional(), lotCode: z.string().trim().max(120).nullable().optional(),
    unitCostCents: z.coerce.number().int().min(0).max(2_000_000_000).nullable().optional(),
    purchasedAt: z.string().datetime({ offset: true }).optional(),
    expiresAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
    notes: z.string().trim().max(5000).nullable().optional(),
  }).strict().refine((value) => Object.keys(value).length > 0, "At least one field is required");
  router.patch("/inventory/items/:id/lots/:lotId", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext, id = routeUuid(req.params.id), lotId = routeUuid(req.params.lotId);
    const input = parseBody(lotPatchSchema, req.body);
    const lot = await prisma.inventoryLot.findFirst({ where: { id: lotId, itemId: id, item: { userId: auth.userId } } });
    if (!lot) throw new AppError(404, "INVENTORY_LOT_NOT_FOUND", "Inventory lot not found");
    if (input.supplierId) {
      const supplier = await prisma.inventorySupplier.findFirst({ where: { id: input.supplierId, userId: auth.userId }, select: { id: true } });
      if (!supplier) throw new AppError(404, "INVENTORY_SUPPLIER_NOT_FOUND", "Supplier not found");
    }
    const updated = await prisma.inventoryLot.update({ where: { id: lotId }, data: {
      ...(input.supplierId !== undefined ? { supplierId: input.supplierId } : {}),
      ...(input.lotCode !== undefined ? { lotCode: input.lotCode } : {}),
      ...(input.unitCostCents !== undefined ? { unitCostCents: input.unitCostCents } : {}),
      ...(input.purchasedAt !== undefined ? { purchasedAt: new Date(input.purchasedAt) } : {}),
      ...(input.expiresAt !== undefined ? { expiresAt: input.expiresAt ? new Date(input.expiresAt + "T00:00:00.000Z") : null } : {}),
      ...(input.notes !== undefined ? { notes: input.notes } : {}),
    } });
    res.status(200).json({ lot: updated });
  });
  router.delete("/inventory/items/:id/lots/:lotId", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext, id = routeUuid(req.params.id), lotId = routeUuid(req.params.lotId);
    await prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{ quantity_received: string; quantity_remaining: string }>>`
        SELECT l.quantity_received::text, l.quantity_remaining::text FROM inventory_lots l
        JOIN inventory_items i ON i.id = l.item_id
        WHERE l.id = ${lotId}::uuid AND l.item_id = ${id}::uuid AND i.user_id = ${auth.userId}::uuid
        FOR UPDATE OF l, i
      `;
      const lot = rows[0];
      if (!lot) throw new AppError(404, "INVENTORY_LOT_NOT_FOUND", "Inventory lot not found");
      const used = await tx.stockMovement.count({ where: { lotId, movementType: { not: "in" } } });
      if (used || asMilli(lot.quantity_received) !== asMilli(lot.quantity_remaining)) {
        throw new AppError(409, "INVENTORY_LOT_HAS_HISTORY", "A lot with consumption or adjustments cannot be deleted");
      }
      const movements = await tx.stockMovement.findMany({ where: { lotId }, select: { id: true } });
      const movementIds = movements.map((movement) => movement.id);
      if (movementIds.length) {
        await tx.financeEntry.deleteMany({ where: { sourceStockMovementId: { in: movementIds } } });
        await tx.stockMovement.deleteMany({ where: { id: { in: movementIds } } });
      }
      await tx.inventoryItem.update({ where: { id }, data: { quantityOnHand: { decrement: Number(lot.quantity_remaining) } } });
      await tx.inventoryLot.delete({ where: { id: lotId } });
      await tx.auditEvent.create({ data: { userId: auth.userId, action: "inventory.lot.deleted", entityType: "inventory_lot", entityId: lotId } });
    });
    res.status(204).send();
  });

  const physicalCountSchema = z.object({
    countedQuantity: quantity, occurredAt: z.string().datetime({ offset: true }),
    notes: z.string().trim().max(5000).nullable().optional(),
  }).strict();
  router.post("/inventory/items/:id/lots/:lotId/count", requireSession, async (req, res) => {
    const auth = res.locals.auth as AuthContext, id = routeUuid(req.params.id), lotId = routeUuid(req.params.lotId);
    const input = parseBody(physicalCountSchema, req.body);
    const result = await prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{ quantity_remaining: string; quantity_received: string; item_quantity: string }>>`
        SELECT l.quantity_remaining::text, l.quantity_received::text, i.quantity_on_hand::text AS item_quantity
        FROM inventory_lots l JOIN inventory_items i ON i.id = l.item_id
        WHERE l.id = ${lotId}::uuid AND l.item_id = ${id}::uuid AND i.user_id = ${auth.userId}::uuid
        FOR UPDATE OF l, i
      `;
      const current = rows[0];
      if (!current) throw new AppError(404, "INVENTORY_LOT_NOT_FOUND", "Inventory lot not found");
      const previous = asMilli(current.quantity_remaining), counted = asMilli(input.countedQuantity), received = asMilli(current.quantity_received), delta = counted - previous;
      if (counted > received) throw new AppError(409, "INVENTORY_COUNT_EXCEEDS_LOT", "A lot count cannot exceed its originally received quantity; use an untracked stock adjustment for excess stock");
      if (delta !== 0) {
        await tx.inventoryLot.update({ where: { id: lotId }, data: { quantityRemaining: counted / scale } });
        await tx.stockMovement.create({ data: {
          itemId: id, lotId, movementType: "adjustment", quantity: Math.abs(delta) / scale,
          occurredAt: new Date(input.occurredAt), reference: "Physical inventory count",
          notes: input.notes ?? ("Physical count: " + previous / scale + " -> " + counted / scale),
        } });
        const total = asMilli(current.item_quantity) + delta;
        if (total < 0) throw new AppError(409, "INVENTORY_COUNT_INVALID", "Physical count would make total stock negative");
        await tx.inventoryItem.update({ where: { id }, data: { quantityOnHand: total / scale } });
      }
      await tx.auditEvent.create({ data: { userId: auth.userId, action: "inventory.physical_count", entityType: "inventory_lot", entityId: lotId, metadata: { previousQuantity: previous / scale, countedQuantity: counted / scale, delta: delta / scale } } });
      return { lot: await tx.inventoryLot.findUniqueOrThrow({ where: { id: lotId } }), delta: delta / scale };
    });
    res.status(200).json(result);
  });

  return router;
}
