import { Router } from "express";
import { z } from "zod";
import { AppError } from "../../errors/app-error.js";
import { prisma } from "../../db/prisma.js";
import { requireSession, type AuthContext } from "../auth/session.js";

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
const quantity = z.coerce.number().finite().min(0).max(999_999_999.999).refine((n) => Number.isInteger(n * scale), "Quantity supports at most 3 decimal places");
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
const movementSchema = z.object({
  movementType: z.enum(movementTypes),
  quantity: z.coerce.number().finite().min(0).max(999_999_999.999).refine((n) => Number.isInteger(n * scale), "Quantity supports at most 3 decimal places"),
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
  const parsed = Math.round(Number(value) * scale);
  if (!Number.isSafeInteger(parsed)) throw new AppError(400, "QUANTITY_OUT_OF_RANGE", "Quantity exceeds supported precision");
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
      where.OR = [
        { name: { contains: search, mode: "insensitive" } },
        { category: { equals: categories.find((category) => category === search), mode: "insensitive" } },
        { unit: { contains: search, mode: "insensitive" } },
        { notes: { contains: search, mode: "insensitive" } },
      ].filter((condition) => !("category" in condition) || Boolean(condition.category.equals));
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
      if (newAmount > 999_999_999_999) throw new AppError(400, "QUANTITY_OUT_OF_RANGE", "Resulting stock exceeds the supported precision");
      const movement = await tx.stockMovement.create({
        data: {
          itemId: id, movementType: input.movementType, quantity: input.quantity,
          unitCostCents: input.unitCostCents ?? null, occurredAt: new Date(input.occurredAt),
          reference: input.reference ?? null, notes: input.notes ?? null,
        },
      });
      const item = await tx.inventoryItem.update({ where: { id }, data: { quantityOnHand: newAmount / scale } });
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

  return router;
}
