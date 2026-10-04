import { fail, logApiError, ok } from "@/lib/api/response";
import { authorizeOrganizationRequest } from "@/lib/auth/authorization";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { adjustInventoryItem, getInventoryItem, type InventoryMovementType } from "@/lib/inventory/operations";

type Ctx = { params: Promise<{ id: string }> };

const MOVEMENT_TYPES = new Set<InventoryMovementType>([
  "receipt",
  "issue",
  "adjustment",
  "count",
  "reserve",
  "release",
]);

export async function POST(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;

  try {
    const authorization = await authorizeOrganizationRequest(req, PERMISSIONS.INVENTORY_WRITE);
    if (!authorization.ok) return authorization.response;
    if (!await getInventoryItem(id, false, authorization.context.organizationId)) {
      return fail("INVENTORY_ITEM_NOT_FOUND", "Inventory item not found.", 404);
    }

    const body = (await req.json()) as Record<string, unknown>;
    const movementType = String(body.movementType || "");
    if (!MOVEMENT_TYPES.has(movementType as InventoryMovementType)) {
      return fail("INVALID_MOVEMENT_TYPE", "Unsupported inventory movement type.", 400);
    }

    const item = await adjustInventoryItem(id, {
      movementType: movementType as InventoryMovementType,
      quantity: body.quantity === undefined ? undefined : Number(body.quantity),
      countedQuantity: body.countedQuantity === undefined ? undefined : Number(body.countedQuantity),
      source: typeof body.source === "string" ? body.source : "manual",
      referenceType: typeof body.referenceType === "string" ? body.referenceType : null,
      referenceId: typeof body.referenceId === "string" ? body.referenceId : null,
      referenceLabel: typeof body.referenceLabel === "string" ? body.referenceLabel : null,
      note: typeof body.note === "string" ? body.note : null,
      actor: authorization.context.displayName,
    });

    if (!item) return fail("INVENTORY_ITEM_NOT_FOUND", "Inventory item not found.", 404);
    return ok(item, { source: "postgres" });
  } catch (error) {
    logApiError("POST /api/v1/inventory/[id]/adjust", error);
    const message = error instanceof Error ? error.message : "Failed to adjust inventory.";
    return fail("INVENTORY_ADJUST_FAILED", message, 400);
  }
}
