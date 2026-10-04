import { fail, logApiError, ok } from "@/lib/api/response";
import { authorizeOrganizationRequest } from "@/lib/auth/authorization";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { deleteInventoryItem, getInventoryItem, parseInventoryInput, updateInventoryItem } from "@/lib/inventory/operations";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;

  try {
    const authorization = await authorizeOrganizationRequest(req, PERMISSIONS.APP_READ);
    if (!authorization.ok) return authorization.response;
    const item = await getInventoryItem(id, true, authorization.context.organizationId);
    if (!item) return fail("INVENTORY_ITEM_NOT_FOUND", "Inventory item not found.", 404);
    return ok(item, { source: "postgres" });
  } catch (error) {
    logApiError("GET /api/v1/inventory/[id]", error);
    return fail("INVENTORY_ITEM_FAILED", "Failed to fetch inventory item.", 500);
  }
}

export async function PATCH(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;

  try {
    const authorization = await authorizeOrganizationRequest(req, PERMISSIONS.INVENTORY_WRITE);
    if (!authorization.ok) return authorization.response;
    const existing = await getInventoryItem(id, false, authorization.context.organizationId);
    if (!existing) return fail("INVENTORY_ITEM_NOT_FOUND", "Inventory item not found.", 404);

    const body = (await req.json()) as Record<string, unknown>;
    const item = await updateInventoryItem(id, parseInventoryInput(body, existing), authorization.context.organizationId);
    return ok(item, { source: "postgres" });
  } catch (error) {
    logApiError("PATCH /api/v1/inventory/[id]", error);
    const message = error instanceof Error ? error.message : "Failed to update inventory item.";
    return fail("INVENTORY_UPDATE_FAILED", message, 400);
  }
}

export async function DELETE(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;

  try {
    const authorization = await authorizeOrganizationRequest(req, PERMISSIONS.INVENTORY_WRITE);
    if (!authorization.ok) return authorization.response;
    const deleted = await deleteInventoryItem(id, authorization.context.organizationId);
    if (!deleted) return fail("INVENTORY_ITEM_NOT_FOUND", "Inventory item not found.", 404);
    return ok({ id: deleted.id }, { source: "postgres" });
  } catch (error) {
    logApiError("DELETE /api/v1/inventory/[id]", error);
    return fail("INVENTORY_DELETE_FAILED", "Failed to delete inventory item.", 409);
  }
}
