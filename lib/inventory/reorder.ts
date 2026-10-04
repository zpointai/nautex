import { getInventoryItem } from "@/lib/inventory/operations";
import { prisma } from "@/lib/prisma";

export interface InventoryReorderInput {
  quantity?: unknown;
  vessel?: unknown;
  port?: unknown;
  neededBy?: unknown;
}

function defaultNeededBy() {
  const date = new Date();
  date.setDate(date.getDate() + 7);
  return date.toISOString().slice(0, 10);
}

export async function createInventoryReorderRfq(
  inventoryItemId: string,
  body: InventoryReorderInput = {},
  organizationId?: string,
) {
  const item = await getInventoryItem(inventoryItemId, false, organizationId);
  if (!item) return null;

  const shortage = Math.max(1, item.reorderPoint - item.available);
  const quantity = Number.isFinite(Number(body.quantity)) && Number(body.quantity) > 0
    ? Math.round(Number(body.quantity))
    : Math.max(shortage, item.reorderPoint || 1);
  const vessel = typeof body.vessel === "string" && body.vessel.trim() ? body.vessel.trim() : "Warehouse Replenishment";
  const port = typeof body.port === "string" && body.port.trim() ? body.port.trim() : item.warehouse;
  const neededBy = typeof body.neededBy === "string" && body.neededBy.trim() ? body.neededBy.trim() : defaultNeededBy();

  const rfq = await prisma.rfq.create({
    data: {
      organizationId: organizationId ?? null,
      vessel,
      port,
      neededBy,
      status: "Draft",
      source: "inventory_reorder",
      lines: {
        create: {
          lineNumber: 1,
          description: item.description,
          quantity,
          unit: item.uom,
          impaCode: item.itemCode,
        },
      },
    },
    include: { lines: { orderBy: { lineNumber: "asc" } } },
  });

  return { rfq, quantity };
}
