import { fail, logApiError, ok } from "@/lib/api/response";
import { authorizeOrganizationRequest } from "@/lib/auth/authorization";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { createInventoryCycleCount, getInventoryItem, listInventoryCycleCounts } from "@/lib/inventory/operations";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;

  try {
    const authorization = await authorizeOrganizationRequest(req, PERMISSIONS.APP_READ);
    if (!authorization.ok) return authorization.response;
    const item = await getInventoryItem(id, false, authorization.context.organizationId);
    if (!item) return fail("INVENTORY_ITEM_NOT_FOUND", "Inventory item not found.", 404);
    return ok(await listInventoryCycleCounts(id, 20), { source: "postgres" });
  } catch (error) {
    logApiError("GET /api/v1/inventory/[id]/cycle-counts", error);
    return fail("CYCLE_COUNT_LIST_FAILED", "Failed to load cycle counts.", 500);
  }
}

export async function POST(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;

  try {
    const authorization = await authorizeOrganizationRequest(req, PERMISSIONS.INVENTORY_WRITE);
    if (!authorization.ok) return authorization.response;
    const item = await getInventoryItem(id, false, authorization.context.organizationId);
    if (!item) return fail("INVENTORY_ITEM_NOT_FOUND", "Inventory item not found.", 404);
    const body = (await req.json()) as Record<string, unknown>;
    const count = await createInventoryCycleCount({
      inventoryItemId: id,
      countedQuantity: Number(body.countedQuantity),
      note: typeof body.note === "string" ? body.note : null,
      countedBy: authorization.context.displayName,
    });
    if (!count) return fail("INVENTORY_ITEM_NOT_FOUND", "Inventory item not found.", 404);
    return ok(count, { source: "postgres" }, { status: 201 });
  } catch (error) {
    logApiError("POST /api/v1/inventory/[id]/cycle-counts", error);
    const message = error instanceof Error ? error.message : "Failed to record cycle count.";
    return fail("CYCLE_COUNT_CREATE_FAILED", message, 400);
  }
}
