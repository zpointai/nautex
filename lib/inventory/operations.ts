import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { resolveUnitConversion, stockQuantity, frozenStockQuantity } from "./unit-conversions";

type Db = Prisma.TransactionClient | typeof prisma;

export type InventoryMovementType =
  | "initial_stock"
  | "receipt"
  | "issue"
  | "adjustment"
  | "count"
  | "reserve"
  | "release"
  | "reservation_issue"
  | "po_delivery"
  | "po_delivery_reversal"
  | "transfer_out"
  | "transfer_in";

export interface InventoryRecord {
  id: string;
  itemCode: string | null;
  catalogItemId: string | null;
  description: string;
  category: string | null;
  warehouse: string;
  locationBin: string | null;
  uom: string;
  onHand: number;
  reserved: number;
  inbound: number;
  available: number;
  reorderPoint: number;
  stockStatus: "critical" | "reorder" | "healthy";
  dangerousGoods: boolean;
  notes: string | null;
  lastCountedAt: Date | null;
  movementCount: number;
  lastMovementAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  movements?: InventoryMovementRecord[];
  cycleCounts?: InventoryCycleCountRecord[];
}

export interface InventoryMovementRecord {
  id: string;
  inventoryItemId: string;
  movementType: string;
  quantity: number;
  quantityBefore: number;
  quantityAfter: number;
  source: string;
  referenceType: string | null;
  referenceId: string | null;
  referenceLabel: string | null;
  idempotencyKey: string | null;
  note: string | null;
  actor: string;
  createdAt: Date;
}

export interface InventoryReservationRecord {
  orderUnit: string | null;
  stockUnit: string | null;
  stockPerOrderUnit: number;
  conversionId: string | null;
  id: string;
  inventoryItemId: string;
  orderId: string;
  orderLineId: string;
  quantity: number;
  status: "Active" | "Released" | "Issued";
  referenceLabel: string | null;
  note: string | null;
  actor: string;
  reservedAt: Date;
  releasedAt: Date | null;
  issuedAt: Date | null;
}

export interface InventoryCycleCountRecord {
  id: string;
  inventoryItemId: string;
  expectedQuantity: number;
  countedQuantity: number;
  variance: number;
  status: "PendingReview" | "Approved" | "Rejected";
  note: string | null;
  reviewNote: string | null;
  countedBy: string;
  reviewedBy: string | null;
  countedAt: Date;
  reviewedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ReservationCandidate {
  id: string;
  itemCode: string | null;
  description: string;
  warehouse: string;
  locationBin: string | null;
  uom: string;
  onHand: number;
  reserved: number;
  available: number;
  reorderPoint: number;
  stockStatus: "critical" | "reorder" | "healthy";
  dangerousGoods: boolean;
  matchReason: string;
}

export interface InventoryInput {
  itemCode?: string | null;
  catalogItemId?: string | null;
  description: string;
  category?: string | null;
  warehouse: string;
  locationBin?: string | null;
  uom: string;
  onHand: number;
  reserved?: number;
  inbound?: number;
  reorderPoint: number;
  dangerousGoods?: boolean;
  notes?: string | null;
  lastCountedAt?: Date | null;
}

export interface InventoryAdjustmentInput {
  movementType: InventoryMovementType;
  quantity?: number;
  countedQuantity?: number;
  source?: string;
  referenceType?: string | null;
  referenceId?: string | null;
  referenceLabel?: string | null;
  note?: string | null;
  actor?: string;
}

const inventorySelect = Prisma.sql`
  SELECT
    i."id",
    i."item_code" AS "itemCode",
    i."catalog_item_id" AS "catalogItemId",
    i."description",
    i."category",
    i."warehouse",
    i."location_bin" AS "locationBin",
    i."uom",
    i."on_hand" AS "onHand",
    i."reserved",
    i."inbound",
    GREATEST(i."on_hand" - i."reserved", 0)::int AS "available",
    i."reorder_point" AS "reorderPoint",
    CASE
      WHEN i."on_hand" - i."reserved" <= 0 THEN 'critical'
      WHEN i."on_hand" - i."reserved" <= i."reorder_point" THEN 'reorder'
      ELSE 'healthy'
    END AS "stockStatus",
    i."dangerous_goods" AS "dangerousGoods",
    i."notes",
    i."last_counted_at" AS "lastCountedAt",
    (SELECT COUNT(*)::int FROM "inventory_movements" m WHERE m."inventory_item_id" = i."id") AS "movementCount",
    (SELECT MAX(m."created_at") FROM "inventory_movements" m WHERE m."inventory_item_id" = i."id") AS "lastMovementAt",
    i."created_at" AS "createdAt",
    i."updated_at" AS "updatedAt"
  FROM "inventory_items" i
`;

const reservationSelect = Prisma.sql`
  SELECT
    r."id",
    r."inventory_item_id" AS "inventoryItemId",
    r."order_id" AS "orderId",
    r."order_line_id" AS "orderLineId",
    r."quantity",
    r."order_unit" AS "orderUnit", r."stock_unit" AS "stockUnit", r."stock_per_order_unit"::float8 AS "stockPerOrderUnit", r."conversion_id" AS "conversionId",
    r."status",
    r."reference_label" AS "referenceLabel",
    r."note",
    r."actor",
    r."reserved_at" AS "reservedAt",
    r."released_at" AS "releasedAt",
    r."issued_at" AS "issuedAt"
  FROM "inventory_reservations" r
`;

const cycleCountSelect = Prisma.sql`
  SELECT
    c."id",
    c."inventory_item_id" AS "inventoryItemId",
    c."expected_quantity" AS "expectedQuantity",
    c."counted_quantity" AS "countedQuantity",
    c."variance",
    c."status",
    c."note",
    c."review_note" AS "reviewNote",
    c."counted_by" AS "countedBy",
    c."reviewed_by" AS "reviewedBy",
    c."counted_at" AS "countedAt",
    c."reviewed_at" AS "reviewedAt",
    c."created_at" AS "createdAt",
    c."updated_at" AS "updatedAt"
  FROM "inventory_cycle_counts" c
`;

function cleanString(value: unknown) {
  if (value == null) return null;
  const text = String(value).trim();
  return text.length > 0 ? text : null;
}

export function parseInventoryInput(body: Record<string, unknown>, existing?: InventoryRecord): InventoryInput {
  const description = cleanString(body.description) ?? existing?.description;
  const warehouse = cleanString(body.warehouse) ?? existing?.warehouse;
  const uom = cleanString(body.uom) ?? existing?.uom;

  if (!description || !warehouse || !uom) {
    throw new Error("Required fields: description, warehouse, uom.");
  }

  const onHand = parseNonNegativeInt(body.onHand ?? existing?.onHand ?? 0, "onHand");
  const reserved = parseNonNegativeInt(body.reserved ?? existing?.reserved ?? 0, "reserved");
  const inbound = parseNonNegativeInt(body.inbound ?? existing?.inbound ?? 0, "inbound");
  const reorderPoint = parseNonNegativeInt(body.reorderPoint ?? existing?.reorderPoint ?? 0, "reorderPoint");
  const lastCountedAt =
    body.lastCountedAt === undefined
      ? existing?.lastCountedAt ?? null
      : body.lastCountedAt
        ? new Date(String(body.lastCountedAt))
        : null;

  if (lastCountedAt && Number.isNaN(lastCountedAt.getTime())) {
    throw new Error("lastCountedAt must be a valid date.");
  }

  return {
    itemCode: body.itemCode === undefined ? existing?.itemCode ?? null : cleanString(body.itemCode),
    catalogItemId: body.catalogItemId === undefined ? existing?.catalogItemId ?? null : cleanString(body.catalogItemId),
    description,
    category: body.category === undefined ? existing?.category ?? null : cleanString(body.category),
    warehouse,
    locationBin: body.locationBin === undefined ? existing?.locationBin ?? null : cleanString(body.locationBin),
    uom: uom.toUpperCase(),
    onHand,
    reserved,
    inbound,
    reorderPoint,
    dangerousGoods: body.dangerousGoods === undefined ? existing?.dangerousGoods ?? false : Boolean(body.dangerousGoods),
    notes: body.notes === undefined ? existing?.notes ?? null : cleanString(body.notes),
    lastCountedAt,
  };
}

export function parseNonNegativeInt(value: unknown, field: string) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw new Error(`${field} must be a non-negative number.`);
  return Math.round(number);
}

function parsePositiveInt(value: unknown, field: string) {
  const number = parseNonNegativeInt(value, field);
  if (number <= 0) throw new Error(`${field} must be greater than zero.`);
  return number;
}

function movementRows(rows: InventoryMovementRecord[]) {
  return rows.map((row) => ({ ...row, quantity: Number(row.quantity), quantityBefore: Number(row.quantityBefore), quantityAfter: Number(row.quantityAfter) }));
}

function reservationRows(rows: InventoryReservationRecord[]) {
  return rows.map((row) => ({ ...row, quantity: Number(row.quantity) }));
}

function cycleCountRows(rows: InventoryCycleCountRecord[]) {
  return rows.map((row) => ({
    ...row,
    expectedQuantity: Number(row.expectedQuantity),
    countedQuantity: Number(row.countedQuantity),
    variance: Number(row.variance),
  }));
}

export async function listInventory(organizationId?: string) {
  const scope = organizationId ? Prisma.sql`WHERE i."organization_id" = ${organizationId}` : Prisma.empty;
  return prisma.$queryRaw<InventoryRecord[]>(Prisma.sql`${inventorySelect} ${scope} ORDER BY LOWER(i."description") ASC, i."warehouse" ASC`);
}

export async function getInventoryItem(id: string, includeMovements = true, organizationId?: string) {
  const scope = organizationId ? Prisma.sql`AND i."organization_id" = ${organizationId}` : Prisma.empty;
  const rows = await prisma.$queryRaw<InventoryRecord[]>(Prisma.sql`${inventorySelect} WHERE i."id" = ${id} ${scope} LIMIT 1`);
  const item = rows[0] ?? null;
  if (!item || !includeMovements) return item;
  const [movements, cycleCounts] = await Promise.all([
    listInventoryMovements(id, 30),
    listInventoryCycleCounts(id, 10),
  ]);
  item.movements = movements;
  item.cycleCounts = cycleCounts;
  return item;
}

export async function listInventoryMovements(inventoryItemId: string, limit = 30) {
  const rows = await prisma.$queryRaw<InventoryMovementRecord[]>(Prisma.sql`
    SELECT
      "id",
      "inventory_item_id" AS "inventoryItemId",
      "movement_type" AS "movementType",
      "quantity",
      "quantity_before" AS "quantityBefore",
      "quantity_after" AS "quantityAfter",
      "source",
      "reference_type" AS "referenceType",
      "reference_id" AS "referenceId",
      "reference_label" AS "referenceLabel",
      "idempotency_key" AS "idempotencyKey",
      "note",
      "actor",
      "created_at" AS "createdAt"
    FROM "inventory_movements"
    WHERE "inventory_item_id" = ${inventoryItemId}
    ORDER BY "created_at" DESC
    LIMIT ${limit}
  `);
  return movementRows(rows);
}

export async function listInventoryCycleCounts(inventoryItemId: string, limit = 10) {
  const rows = await prisma.$queryRaw<InventoryCycleCountRecord[]>(Prisma.sql`
    ${cycleCountSelect}
    WHERE c."inventory_item_id" = ${inventoryItemId}
    ORDER BY c."counted_at" DESC
    LIMIT ${limit}
  `);
  return cycleCountRows(rows);
}

export async function findReservationCandidates(params: { itemCode?: string | null; description: string; organizationId?: string }) {
  const itemCode = params.itemCode?.trim() || null;
  const description = params.description.trim();
  const rows = await prisma.$queryRaw<ReservationCandidate[]>(Prisma.sql`
    SELECT
      i."id",
      i."item_code" AS "itemCode",
      i."description",
      i."warehouse",
      i."location_bin" AS "locationBin",
      i."uom",
      i."on_hand" AS "onHand",
      i."reserved",
      GREATEST(i."on_hand" - i."reserved", 0)::int AS "available",
      i."reorder_point" AS "reorderPoint",
      CASE
        WHEN i."on_hand" - i."reserved" <= 0 THEN 'critical'
        WHEN i."on_hand" - i."reserved" <= i."reorder_point" THEN 'reorder'
        ELSE 'healthy'
      END AS "stockStatus",
      i."dangerous_goods" AS "dangerousGoods",
      CASE
        WHEN ${itemCode}::text IS NOT NULL AND i."item_code" = ${itemCode} THEN 'item_code'
        WHEN LOWER(i."description") = LOWER(${description}) THEN 'description'
        ELSE 'description_contains'
      END AS "matchReason"
    FROM "inventory_items" i
    WHERE
      ${params.organizationId ? Prisma.sql`i."organization_id" = ${params.organizationId} AND` : Prisma.empty}
      ((${itemCode}::text IS NOT NULL AND i."item_code" = ${itemCode})
      OR LOWER(i."description") = LOWER(${description})
      OR LOWER(i."description") LIKE LOWER(${`%${description}%`}))
    ORDER BY
      CASE
        WHEN ${itemCode}::text IS NOT NULL AND i."item_code" = ${itemCode} THEN 0
        WHEN LOWER(i."description") = LOWER(${description}) THEN 1
        ELSE 2
      END,
      GREATEST(i."on_hand" - i."reserved", 0) DESC,
      i."updated_at" DESC
    LIMIT 8
  `);

  return rows.map((row) => ({
    ...row,
    onHand: Number(row.onHand),
    reserved: Number(row.reserved),
    available: Number(row.available),
    reorderPoint: Number(row.reorderPoint),
  }));
}

export async function listReservationsForOrder(orderId: string) {
  const rows = await prisma.$queryRaw<InventoryReservationRecord[]>(Prisma.sql`
    ${reservationSelect}
    WHERE r."order_id" = ${orderId}
    ORDER BY r."reserved_at" DESC
  `);
  return reservationRows(rows);
}

export async function getActiveReservationForLine(orderLineId: string, db: Db = prisma) {
  const rows = await db.$queryRaw<InventoryReservationRecord[]>(Prisma.sql`
    ${reservationSelect}
    WHERE r."order_line_id" = ${orderLineId} AND r."status" = 'Active'
    LIMIT 1
  `);
  return reservationRows(rows)[0] ?? null;
}

export async function getReservation(id: string) {
  const rows = await prisma.$queryRaw<InventoryReservationRecord[]>(Prisma.sql`
    ${reservationSelect}
    WHERE r."id" = ${id}
    LIMIT 1
  `);
  return reservationRows(rows)[0] ?? null;
}

export async function searchCatalogForInventory(query: string) {
  const q = query.trim();
  if (q.length < 2) return [];
  return prisma.item.findMany({
    where: {
      isDeleted: false,
      OR: [
        { description: { contains: q, mode: "insensitive" } },
        { impaCode: { contains: q, mode: "insensitive" } },
        { hsCodeEu: { contains: q, mode: "insensitive" } },
        { hsCodeUs: { contains: q, mode: "insensitive" } },
        { category: { contains: q, mode: "insensitive" } },
      ],
    },
    orderBy: [{ impaCode: "asc" }, { description: "asc" }],
    take: 12,
  });
}

export async function linkInventoryToCatalogItem(inventoryItemId: string, catalogItemId: string, organizationId?: string) {
  const catalogItem = await prisma.item.findUnique({ where: { id: catalogItemId } });
  if (!catalogItem || catalogItem.isDeleted) throw new Error("Catalog item not found.");

  await prisma.$executeRaw(Prisma.sql`
    UPDATE "inventory_items"
    SET
      "catalog_item_id" = ${catalogItem.id},
      "item_code" = ${catalogItem.impaCode},
      "category" = COALESCE(${catalogItem.category}, "category"),
      "uom" = COALESCE(${catalogItem.unit}, "uom"),
      "updated_at" = CURRENT_TIMESTAMP
    WHERE "id" = ${inventoryItemId}
      ${organizationId ? Prisma.sql`AND "organization_id" = ${organizationId}` : Prisma.empty}
  `);

  return getInventoryItem(inventoryItemId, true, organizationId);
}

export async function unlinkInventoryCatalogItem(inventoryItemId: string, organizationId?: string) {
  await prisma.$executeRaw(Prisma.sql`
    UPDATE "inventory_items"
    SET "catalog_item_id" = NULL, "updated_at" = CURRENT_TIMESTAMP
    WHERE "id" = ${inventoryItemId}
      ${organizationId ? Prisma.sql`AND "organization_id" = ${organizationId}` : Prisma.empty}
  `);
  return getInventoryItem(inventoryItemId, true, organizationId);
}

export async function createInventoryItem(input: InventoryInput, organizationId?: string) {
  const id = randomUUID();
  await prisma.$transaction(async (tx) => {
    await insertInventoryItem(tx, id, input, organizationId);
    if (input.onHand > 0) {
      await insertMovement(tx, {
        inventoryItemId: id,
        movementType: "initial_stock",
        quantity: input.onHand,
        quantityBefore: 0,
        quantityAfter: input.onHand,
        source: "manual",
        note: "Opening stock balance",
      });
    }
  });
  return getInventoryItem(id, true, organizationId);
}

export async function updateInventoryItem(id: string, input: InventoryInput, organizationId?: string) {
  const existing = await getInventoryItem(id, false, organizationId);
  if (!existing) return null;

  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw(Prisma.sql`
      UPDATE "inventory_items"
      SET
        "item_code" = ${input.itemCode},
        "catalog_item_id" = ${input.catalogItemId},
        "description" = ${input.description},
        "category" = ${input.category},
        "warehouse" = ${input.warehouse},
        "location_bin" = ${input.locationBin},
        "uom" = ${input.uom},
        "on_hand" = ${input.onHand},
        "reserved" = ${input.reserved ?? 0},
        "inbound" = ${input.inbound ?? 0},
        "reorder_point" = ${input.reorderPoint},
        "dangerous_goods" = ${input.dangerousGoods ?? false},
        "notes" = ${input.notes},
        "last_counted_at" = ${input.lastCountedAt},
        "updated_at" = CURRENT_TIMESTAMP
      WHERE "id" = ${id} ${organizationId ? Prisma.sql`AND "organization_id" = ${organizationId}` : Prisma.empty}
    `);

    const delta = input.onHand - existing.onHand;
    if (delta !== 0) {
      await insertMovement(tx, {
        inventoryItemId: id,
        movementType: "adjustment",
        quantity: delta,
        quantityBefore: existing.onHand,
        quantityAfter: input.onHand,
        source: "manual",
        note: "Stock balance edited from inventory record",
      });
    }
  });

  return getInventoryItem(id, true, organizationId);
}

export async function deleteInventoryItem(id: string, organizationId?: string) {
  const existing = await getInventoryItem(id, false, organizationId);
  if (!existing) return null;
  await prisma.$executeRaw(Prisma.sql`DELETE FROM "inventory_items" WHERE "id" = ${id} ${organizationId ? Prisma.sql`AND "organization_id" = ${organizationId}` : Prisma.empty}`);
  return existing;
}

export async function transferInventoryStock(params: {
  organizationId?: string;
  sourceItemId: string;
  destinationWarehouse: string;
  destinationBin?: string | null;
  quantity: number;
  note?: string | null;
  actor?: string;
}) {
  const destinationWarehouse = cleanString(params.destinationWarehouse);
  const destinationBin = cleanString(params.destinationBin);
  const quantity = parsePositiveInt(params.quantity, "quantity");
  if (!destinationWarehouse) throw new Error("destinationWarehouse is required.");

  const result = await prisma.$transaction(async (tx) => {
    const sourceRows = await tx.$queryRaw<InventoryRecord[]>(Prisma.sql`
      ${inventorySelect}
      WHERE i."id" = ${params.sourceItemId}
        ${params.organizationId ? Prisma.sql`AND i."organization_id" = ${params.organizationId}` : Prisma.empty}
      LIMIT 1
      FOR UPDATE OF i
    `);
    const source = sourceRows[0];
    if (!source) return null;
    if (source.warehouse === destinationWarehouse && (source.locationBin ?? null) === destinationBin) {
      throw new Error("Destination must differ from the current warehouse and bin.");
    }
    if (source.available < quantity) {
      throw new Error(`Only ${source.available} ${source.uom} available to transfer.`);
    }

    const destinationRows = await tx.$queryRaw<InventoryRecord[]>(Prisma.sql`
      ${inventorySelect}
      WHERE i."id" <> ${source.id}
        ${params.organizationId ? Prisma.sql`AND i."organization_id" = ${params.organizationId}` : Prisma.empty}
        AND i."warehouse" = ${destinationWarehouse}
        AND COALESCE(i."location_bin", '') = COALESCE(${destinationBin}, '')
        AND (
          (${source.catalogItemId}::text IS NOT NULL AND i."catalog_item_id" = ${source.catalogItemId})
          OR (${source.catalogItemId}::text IS NULL AND ${source.itemCode}::text IS NOT NULL AND i."item_code" = ${source.itemCode})
          OR (${source.catalogItemId}::text IS NULL AND ${source.itemCode}::text IS NULL AND LOWER(i."description") = LOWER(${source.description}))
        )
      LIMIT 1
      FOR UPDATE OF i
    `);

    let destination = destinationRows[0] ?? null;
    if (!destination) {
      const destinationId = randomUUID();
      await insertInventoryItem(tx, destinationId, {
        itemCode: source.itemCode,
        catalogItemId: source.catalogItemId,
        description: source.description,
        category: source.category,
        warehouse: destinationWarehouse,
        locationBin: destinationBin,
        uom: source.uom,
        onHand: 0,
        reserved: 0,
        inbound: 0,
        reorderPoint: 0,
        dangerousGoods: source.dangerousGoods,
        notes: source.notes,
      }, params.organizationId);
      destination = await getInventoryItemForDb(tx, destinationId);
    }
    if (!destination) throw new Error("Failed to create destination inventory record.");

    const transferId = randomUUID();
    const nextSourceOnHand = source.onHand - quantity;
    const nextDestinationOnHand = destination.onHand + quantity;

    await tx.$executeRaw(Prisma.sql`
      UPDATE "inventory_items" SET "on_hand" = ${nextSourceOnHand}, "updated_at" = CURRENT_TIMESTAMP WHERE "id" = ${source.id}
    `);
    await tx.$executeRaw(Prisma.sql`
      UPDATE "inventory_items" SET "on_hand" = ${nextDestinationOnHand}, "updated_at" = CURRENT_TIMESTAMP WHERE "id" = ${destination.id}
    `);
    await tx.$executeRaw(Prisma.sql`
      INSERT INTO "inventory_transfers" (
        "id", "source_item_id", "destination_item_id", "quantity", "source_warehouse", "source_bin",
        "destination_warehouse", "destination_bin", "note", "actor", "created_at"
      ) VALUES (
        ${transferId}, ${source.id}, ${destination.id}, ${quantity}, ${source.warehouse}, ${source.locationBin},
        ${destinationWarehouse}, ${destinationBin}, ${params.note ?? null}, ${params.actor ?? "operator"}, CURRENT_TIMESTAMP
      )
    `);

    const referenceLabel = `${source.warehouse}${source.locationBin ? ` / ${source.locationBin}` : ""} -> ${destinationWarehouse}${destinationBin ? ` / ${destinationBin}` : ""}`;
    await insertMovement(tx, {
      inventoryItemId: source.id,
      movementType: "transfer_out",
      quantity: -quantity,
      quantityBefore: source.onHand,
      quantityAfter: nextSourceOnHand,
      source: "warehouse_transfer",
      referenceType: "inventory_transfer",
      referenceId: transferId,
      referenceLabel,
      idempotencyKey: `inventory-transfer:${transferId}:out`,
      note: params.note ?? "Stock transferred to another warehouse location.",
      actor: params.actor ?? "operator",
    });
    await insertMovement(tx, {
      inventoryItemId: destination.id,
      movementType: "transfer_in",
      quantity,
      quantityBefore: destination.onHand,
      quantityAfter: nextDestinationOnHand,
      source: "warehouse_transfer",
      referenceType: "inventory_transfer",
      referenceId: transferId,
      referenceLabel,
      idempotencyKey: `inventory-transfer:${transferId}:in`,
      note: params.note ?? "Stock received from another warehouse location.",
      actor: params.actor ?? "operator",
    });

    return { transferId, sourceItemId: source.id, destinationItemId: destination.id };
  });

  if (!result) return null;
  const [source, destination] = await Promise.all([
    getInventoryItem(result.sourceItemId, true, params.organizationId),
    getInventoryItem(result.destinationItemId, true, params.organizationId),
  ]);
  return { id: result.transferId, source, destination };
}

export async function createInventoryCycleCount(params: {
  inventoryItemId: string;
  countedQuantity: number;
  note?: string | null;
  countedBy?: string;
}) {
  const countedQuantity = parseNonNegativeInt(params.countedQuantity, "countedQuantity");
  const countId = await prisma.$transaction(async (tx) => {
    const itemRows = await tx.$queryRaw<InventoryRecord[]>(Prisma.sql`
      ${inventorySelect} WHERE i."id" = ${params.inventoryItemId} LIMIT 1 FOR UPDATE OF i
    `);
    const item = itemRows[0];
    if (!item) return null;

    const pending = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT "id" FROM "inventory_cycle_counts"
      WHERE "inventory_item_id" = ${params.inventoryItemId} AND "status" = 'PendingReview'
      LIMIT 1
    `);
    if (pending[0]) throw new Error("This item already has a cycle count awaiting review.");

    const id = randomUUID();
    await tx.$executeRaw(Prisma.sql`
      INSERT INTO "inventory_cycle_counts" (
        "id", "inventory_item_id", "expected_quantity", "counted_quantity", "variance", "status",
        "note", "counted_by", "counted_at", "created_at", "updated_at"
      ) VALUES (
        ${id}, ${item.id}, ${item.onHand}, ${countedQuantity}, ${countedQuantity - item.onHand},
        'PendingReview', ${params.note ?? null}, ${params.countedBy ?? "operator"}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      )
    `);
    return id;
  });

  if (!countId) return null;
  const rows = await prisma.$queryRaw<InventoryCycleCountRecord[]>(Prisma.sql`${cycleCountSelect} WHERE c."id" = ${countId} LIMIT 1`);
  return cycleCountRows(rows)[0] ?? null;
}

export async function reviewInventoryCycleCount(params: {
  inventoryItemId: string;
  countId: string;
  decision: "approve" | "reject";
  reviewNote?: string | null;
  reviewedBy?: string;
}) {
  const result = await prisma.$transaction(async (tx) => {
    const countRows = await tx.$queryRaw<InventoryCycleCountRecord[]>(Prisma.sql`
      ${cycleCountSelect}
      WHERE c."id" = ${params.countId} AND c."inventory_item_id" = ${params.inventoryItemId}
      LIMIT 1
      FOR UPDATE OF c
    `);
    const count = cycleCountRows(countRows)[0];
    if (!count) return null;
    if (count.status !== "PendingReview") throw new Error("This cycle count has already been reviewed.");

    const itemRows = await tx.$queryRaw<InventoryRecord[]>(Prisma.sql`
      ${inventorySelect} WHERE i."id" = ${params.inventoryItemId} LIMIT 1 FOR UPDATE OF i
    `);
    const item = itemRows[0];
    if (!item) return null;

    if (params.decision === "approve") {
      if (item.onHand !== count.expectedQuantity) {
        throw new Error("Stock changed after this count was recorded. Reject it and start a new cycle count.");
      }
      await tx.$executeRaw(Prisma.sql`
        UPDATE "inventory_items"
        SET "on_hand" = ${count.countedQuantity}, "last_counted_at" = CURRENT_TIMESTAMP, "updated_at" = CURRENT_TIMESTAMP
        WHERE "id" = ${item.id}
      `);
      await insertMovement(tx, {
        inventoryItemId: item.id,
        movementType: "count",
        quantity: count.variance,
        quantityBefore: item.onHand,
        quantityAfter: count.countedQuantity,
        source: "cycle_count",
        referenceType: "inventory_cycle_count",
        referenceId: count.id,
        referenceLabel: `Cycle count ${count.id.slice(0, 8)}`,
        idempotencyKey: `inventory-cycle-count:${count.id}:approved`,
        note: params.reviewNote ?? count.note ?? "Cycle count variance approved.",
        actor: params.reviewedBy ?? "operator",
      });
    }

    const status = params.decision === "approve" ? "Approved" : "Rejected";
    await tx.$executeRaw(Prisma.sql`
      UPDATE "inventory_cycle_counts"
      SET "status" = ${status}::"InventoryCycleCountStatus", "review_note" = ${params.reviewNote ?? null},
          "reviewed_by" = ${params.reviewedBy ?? "operator"}, "reviewed_at" = CURRENT_TIMESTAMP, "updated_at" = CURRENT_TIMESTAMP
      WHERE "id" = ${count.id}
    `);
    return count.id;
  });

  if (!result) return null;
  const [item, countRows] = await Promise.all([
    getInventoryItem(params.inventoryItemId),
    prisma.$queryRaw<InventoryCycleCountRecord[]>(Prisma.sql`${cycleCountSelect} WHERE c."id" = ${result} LIMIT 1`),
  ]);
  return { item, count: cycleCountRows(countRows)[0] ?? null };
}

export async function adjustInventoryItem(id: string, input: InventoryAdjustmentInput) {
  const changed = await prisma.$transaction(async (tx) => {
    const existing = await getInventoryItemForDb(tx, id);
    if (!existing) return false;

    const result = calculateAdjustment(existing, input);
    await tx.$executeRaw(Prisma.sql`
      UPDATE "inventory_items"
      SET
        "on_hand" = ${result.onHand},
        "reserved" = ${result.reserved},
        "last_counted_at" = ${input.movementType === "count" ? new Date() : existing.lastCountedAt},
        "updated_at" = CURRENT_TIMESTAMP
      WHERE "id" = ${id}
    `);

    await insertMovement(tx, {
      inventoryItemId: id,
      movementType: input.movementType,
      quantity: result.movementQuantity,
      quantityBefore: existing.onHand,
      quantityAfter: result.onHand,
      source: input.source ?? "manual",
      referenceType: input.referenceType ?? null,
      referenceId: input.referenceId ?? null,
      referenceLabel: input.referenceLabel ?? null,
      note: input.note ?? null,
      actor: input.actor ?? "operator",
    });

    return true;
  });

  if (!changed) return null;
  return getInventoryItem(id);
}

export async function reserveInventoryForLine(params: {
  inventoryItemId: string;
  orderId: string;
  orderLineId: string;
  quantity: number;
  referenceLabel?: string | null;
  note?: string | null;
  actor?: string;
}) {
  const orderQuantity = params.quantity;

  const reservationId = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`inventory-line:${params.orderLineId}`}))`;
    const line = await tx.purchaseOrderLine.findFirst({ where: { id: params.orderLineId, orderId: params.orderId } });
    if (!line) throw new Error("Purchase order line not found for this order.");
    const existingReservation = await getActiveReservationForLine(params.orderLineId, tx);
    if (existingReservation) throw new Error("This order line already has an active inventory reservation.");

    const item = await getInventoryItemForDb(tx, params.inventoryItemId);
    if (!item) throw new Error("Inventory item not found.");
    const conversion = await resolveUnitConversion(tx, item, line.uom);
    const quantity = stockQuantity(orderQuantity, conversion.stockPerOrderUnit);
    if (orderQuantity > line.qtyOrdered - line.qtyDelivered) throw new Error("Reservation exceeds the remaining order quantity.");
    if (item.available < quantity) throw new Error(`Only ${item.available} ${item.uom} available to reserve.`);

    const id = randomUUID();
    await tx.$executeRaw(Prisma.sql`
      INSERT INTO "inventory_reservations" (
        "id", "inventory_item_id", "order_id", "order_line_id", "quantity", "status",
        "reference_label", "note", "actor", "reserved_at", "order_unit", "stock_unit", "stock_per_order_unit", "conversion_id"
      )
      VALUES (
        ${id}, ${params.inventoryItemId}, ${params.orderId}, ${params.orderLineId}, ${quantity}, 'Active',
        ${params.referenceLabel ?? null}, ${params.note ?? null}, ${params.actor ?? "operator"}, CURRENT_TIMESTAMP, ${conversion.orderUnit}, ${conversion.stockUnit}, ${conversion.stockPerOrderUnit}, ${conversion.conversionId}
      )
    `);

    await tx.$executeRaw(Prisma.sql`
      UPDATE "inventory_items"
      SET "reserved" = "reserved" + ${quantity}, "updated_at" = CURRENT_TIMESTAMP
      WHERE "id" = ${params.inventoryItemId}
    `);

    await insertMovement(tx, {
      inventoryItemId: params.inventoryItemId,
      movementType: "reserve",
      quantity,
      quantityBefore: item.onHand,
      quantityAfter: item.onHand,
      source: "purchase_order",
      referenceType: "purchase_order_line",
      referenceId: params.orderLineId,
      referenceLabel: params.referenceLabel ?? null,
      note: params.note ?? "Stock reserved for purchase order line.",
      actor: params.actor ?? "operator",
    });

    return id;
  });

  return getReservation(reservationId);
}

export async function releaseInventoryReservation(orderLineId: string, note?: string | null, actor = "operator") {
  const reservationId = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`inventory-line:${orderLineId}`}))`;
    const reservation = await getActiveReservationForLine(orderLineId, tx);
    if (!reservation) return null;

    const item = await getInventoryItemForDb(tx, reservation.inventoryItemId);
    if (!item) throw new Error("Inventory item not found.");

    await tx.$executeRaw(Prisma.sql`
      UPDATE "inventory_reservations"
      SET "status" = 'Released', "released_at" = CURRENT_TIMESTAMP, "note" = COALESCE(${note ?? null}, "note")
      WHERE "id" = ${reservation.id}
    `);

    await tx.$executeRaw(Prisma.sql`
      UPDATE "inventory_items"
      SET "reserved" = GREATEST("reserved" - ${reservation.quantity}, 0), "updated_at" = CURRENT_TIMESTAMP
      WHERE "id" = ${reservation.inventoryItemId}
    `);

    await insertMovement(tx, {
      inventoryItemId: reservation.inventoryItemId,
      movementType: "release",
      quantity: reservation.quantity,
      quantityBefore: item.onHand,
      quantityAfter: item.onHand,
      source: "purchase_order",
      referenceType: "purchase_order_line",
      referenceId: orderLineId,
      referenceLabel: reservation.referenceLabel,
      note: note ?? "Inventory reservation released.",
      actor,
    });

    return reservation.id;
  });

  return reservationId ? getReservation(reservationId) : null;
}

export async function issueReservedInventoryForLine(params: {
  tx?: Prisma.TransactionClient;
  orderLineId: string;
  deliveredDelta: number;
  idempotencyKey?: string | null;
  note?: string | null;
  actor?: string;
}) {
  const delta = params.deliveredDelta;
  if (delta <= 0) return null;

  const run = async (tx: Prisma.TransactionClient) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`inventory-line:${params.orderLineId}`}))`;
    if (params.idempotencyKey && await movementExistsForKey(tx, params.idempotencyKey)) return null;

    const reservation = await getActiveReservationForLine(params.orderLineId, tx);
    if (!reservation) return null;

    const item = await getInventoryItemForDb(tx, reservation.inventoryItemId);
    if (!item) throw new Error("Inventory item not found.");

    const line = await tx.purchaseOrderLine.findUniqueOrThrow({ where: { id: params.orderLineId } });
    const issueQty = frozenStockQuantity(delta, reservation, line.uom, item.uom);
    if (issueQty > reservation.quantity || issueQty > item.onHand || issueQty > item.reserved) throw new Error("Reserved inventory does not cover this delivery quantity.");
    const remainingReservation = reservation.quantity - issueQty;
    const nextOnHand = Math.max(0, item.onHand - issueQty);
    const nextReserved = Math.max(0, item.reserved - issueQty);

    await tx.$executeRaw(Prisma.sql`
      UPDATE "inventory_items"
      SET "on_hand" = ${nextOnHand}, "reserved" = ${nextReserved}, "updated_at" = CURRENT_TIMESTAMP
      WHERE "id" = ${reservation.inventoryItemId}
    `);

    if (remainingReservation > 0) {
      await tx.$executeRaw(Prisma.sql`
        UPDATE "inventory_reservations"
        SET "quantity" = ${remainingReservation}
        WHERE "id" = ${reservation.id}
      `);
    } else {
      await tx.$executeRaw(Prisma.sql`
        UPDATE "inventory_reservations"
        SET "quantity" = 0, "status" = 'Issued', "issued_at" = CURRENT_TIMESTAMP
        WHERE "id" = ${reservation.id}
      `);
    }

    await insertMovement(tx, {
      inventoryItemId: reservation.inventoryItemId,
      movementType: "reservation_issue",
      quantity: -issueQty,
      quantityBefore: item.onHand,
      quantityAfter: nextOnHand,
      source: "purchase_order",
      referenceType: "purchase_order_line",
      referenceId: params.orderLineId,
      referenceLabel: reservation.referenceLabel,
      idempotencyKey: params.idempotencyKey ?? null,
      note: params.note ?? "Reserved stock issued to purchase order delivery.",
      actor: params.actor ?? "operator",
    });

    return {
      reservationId: reservation.id,
      inventoryItemId: reservation.inventoryItemId,
      issuedQuantity: issueQty,
      remainingReservation,
      quantityBefore: item.onHand,
      quantityAfter: nextOnHand,
    };
  };
  return params.tx ? run(params.tx) : prisma.$transaction(run);
}

export async function applyPurchaseOrderDeliveryToInventory(params: {
  tx?: Prisma.TransactionClient;
  organizationId?: string;
  lineId: string;
  lineNumber: number;
  itemCode: string | null;
  description: string;
  uom: string;
  deliveredDelta: number;
  idempotencyKey?: string | null;
  poId: string;
  poNumber: string;
  warehouse?: string | null;
  actor?: string;
}) {
  if (params.deliveredDelta === 0) return null;

  const run = async (tx: Prisma.TransactionClient) => {
    if (params.idempotencyKey && await movementExistsForKey(tx, params.idempotencyKey)) return null;

    let item = await findInventoryMatch(tx, params.itemCode, params.description, params.warehouse ?? null, params.organizationId);

    if (!item && params.deliveredDelta > 0) {
      const id = randomUUID();
      await insertInventoryItem(tx, id, {
        itemCode: params.itemCode,
        description: params.description,
        warehouse: params.warehouse || "PO Receipts",
        uom: params.uom || "EA",
        onHand: 0,
        reorderPoint: 0,
        reserved: 0,
        inbound: 0,
        dangerousGoods: false,
        notes: `Created from delivery receipt ${params.poNumber}.`,
      }, params.organizationId);
      item = await getInventoryItemForDb(tx, id);
    }

    if (!item) return null;
    item = await getInventoryItemForDb(tx, item.id);
    if (!item) throw new Error("Inventory item no longer exists.");
    const conversion = await resolveUnitConversion(tx, item, params.uom);
    const delta = Math.sign(params.deliveredDelta) * stockQuantity(Math.abs(params.deliveredDelta), conversion.stockPerOrderUnit);
    if (item.onHand + delta < item.reserved) throw new Error("The reversal would consume reserved or unavailable stock.");

    const nextOnHand = Math.max(0, item.onHand + delta);
    await tx.$executeRaw(Prisma.sql`
      UPDATE "inventory_items"
      SET "on_hand" = ${nextOnHand}, "updated_at" = CURRENT_TIMESTAMP
      WHERE "id" = ${item.id}
    `);

    await insertMovement(tx, {
      inventoryItemId: item.id,
      movementType: delta > 0 ? "po_delivery" : "po_delivery_reversal",
      quantity: delta,
      quantityBefore: item.onHand,
      quantityAfter: nextOnHand,
      source: "purchase_order",
      referenceType: "purchase_order_line",
      referenceId: params.lineId,
      referenceLabel: `${params.poNumber} line ${params.lineNumber}`,
      idempotencyKey: params.idempotencyKey ?? null,
      note: delta > 0 ? "Delivery quantity received from purchase order." : "Delivered quantity reduced on purchase order.",
      actor: params.actor ?? "operator",
    });

    return { inventoryItemId: item.id, quantityBefore: item.onHand, quantityAfter: nextOnHand };
  };
  return params.tx ? run(params.tx) : prisma.$transaction(run);
}

async function getInventoryItemForDb(db: Db, id: string) {
  const rows = await db.$queryRaw<InventoryRecord[]>(Prisma.sql`${inventorySelect} WHERE i."id" = ${id} LIMIT 1 FOR UPDATE OF i`);
  return rows[0] ?? null;
}

async function findInventoryMatch(db: Db, itemCode: string | null, description: string, warehouse: string | null, organizationId?: string) {
  const codeRows = itemCode
    ? await db.$queryRaw<InventoryRecord[]>(Prisma.sql`
        ${inventorySelect}
        WHERE i."item_code" = ${itemCode}
          ${organizationId ? Prisma.sql`AND i."organization_id" = ${organizationId}` : Prisma.empty}
        ORDER BY
          CASE WHEN ${warehouse}::text IS NOT NULL AND i."warehouse" = ${warehouse} THEN 0 ELSE 1 END,
          i."updated_at" DESC
        LIMIT 1
      `)
    : [];
  if (codeRows[0]) return codeRows[0];

  const descriptionRows = await db.$queryRaw<InventoryRecord[]>(Prisma.sql`
    ${inventorySelect}
    WHERE LOWER(i."description") = LOWER(${description})
      ${organizationId ? Prisma.sql`AND i."organization_id" = ${organizationId}` : Prisma.empty}
    ORDER BY
      CASE WHEN ${warehouse}::text IS NOT NULL AND i."warehouse" = ${warehouse} THEN 0 ELSE 1 END,
      i."updated_at" DESC
    LIMIT 1
  `);
  return descriptionRows[0] ?? null;
}

async function insertInventoryItem(db: Db, id: string, input: InventoryInput, organizationId?: string) {
  await db.$executeRaw(Prisma.sql`
    INSERT INTO "inventory_items" (
      "id", "organization_id", "item_code", "catalog_item_id", "description", "category", "warehouse", "location_bin",
      "uom", "on_hand", "reserved", "inbound", "reorder_point", "dangerous_goods", "notes", "last_counted_at",
      "created_at", "updated_at"
    )
    VALUES (
      ${id}, ${organizationId ?? null}, ${input.itemCode ?? null}, ${input.catalogItemId ?? null}, ${input.description}, ${input.category ?? null},
      ${input.warehouse}, ${input.locationBin ?? null}, ${input.uom}, ${input.onHand}, ${input.reserved ?? 0},
      ${input.inbound ?? 0}, ${input.reorderPoint}, ${input.dangerousGoods ?? false}, ${input.notes ?? null},
      ${input.lastCountedAt ?? null}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    )
  `);
}

async function insertMovement(db: Db, input: {
  inventoryItemId: string;
  movementType: InventoryMovementType;
  quantity: number;
  quantityBefore: number;
  quantityAfter: number;
  source?: string;
  referenceType?: string | null;
  referenceId?: string | null;
  referenceLabel?: string | null;
  idempotencyKey?: string | null;
  note?: string | null;
  actor?: string;
}) {
  await db.$executeRaw(Prisma.sql`
    INSERT INTO "inventory_movements" (
      "id", "inventory_item_id", "movement_type", "quantity", "quantity_before", "quantity_after",
      "source", "reference_type", "reference_id", "reference_label", "idempotency_key", "note", "actor", "created_at"
    )
    VALUES (
      ${randomUUID()}, ${input.inventoryItemId}, ${input.movementType}, ${Math.round(input.quantity)},
      ${Math.round(input.quantityBefore)}, ${Math.round(input.quantityAfter)}, ${input.source ?? "manual"},
      ${input.referenceType ?? null}, ${input.referenceId ?? null}, ${input.referenceLabel ?? null},
      ${input.idempotencyKey ?? null}, ${input.note ?? null}, ${input.actor ?? "operator"}, CURRENT_TIMESTAMP
    )
  `);
}

async function movementExistsForKey(db: Db, idempotencyKey: string) {
  await db.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${idempotencyKey}))`);
  const rows = await db.$queryRaw<Array<{ exists: boolean }>>(Prisma.sql`
    SELECT EXISTS(
      SELECT 1 FROM "inventory_movements" WHERE "idempotency_key" = ${idempotencyKey}
    ) AS "exists"
  `);
  return rows[0]?.exists === true;
}

function calculateAdjustment(existing: InventoryRecord, input: InventoryAdjustmentInput) {
  const movementType = input.movementType;
  const rawQuantity = input.quantity ?? 0;
  const quantity = parseNonNegativeInt(rawQuantity, "quantity");

  if (movementType === "count") {
    const countedQuantity = parseNonNegativeInt(input.countedQuantity, "countedQuantity");
    return {
      onHand: countedQuantity,
      reserved: existing.reserved,
      movementQuantity: countedQuantity - existing.onHand,
    };
  }

  if (quantity <= 0) throw new Error("quantity must be greater than zero.");

  if (movementType === "receipt" || movementType === "adjustment") {
    return { onHand: existing.onHand + quantity, reserved: existing.reserved, movementQuantity: quantity };
  }

  if (movementType === "issue") {
    return { onHand: Math.max(0, existing.onHand - quantity), reserved: existing.reserved, movementQuantity: -quantity };
  }

  if (movementType === "reserve") {
    return { onHand: existing.onHand, reserved: existing.reserved + quantity, movementQuantity: 0 };
  }

  if (movementType === "release") {
    return { onHand: existing.onHand, reserved: Math.max(0, existing.reserved - quantity), movementQuantity: 0 };
  }

  throw new Error("Unsupported inventory movement type.");
}
