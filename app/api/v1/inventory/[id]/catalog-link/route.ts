import { fail, logApiError, ok } from "@/lib/api/response";
import { authorizeOrganizationRequest } from "@/lib/auth/authorization";
import { PERMISSIONS } from "@/lib/auth/permissions";
import {
  getInventoryItem,
  linkInventoryToCatalogItem,
  searchCatalogForInventory,
  unlinkInventoryCatalogItem,
} from "@/lib/inventory/operations";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;

  try {
    const authorization = await authorizeOrganizationRequest(req, PERMISSIONS.APP_READ);
    if (!authorization.ok) return authorization.response;
    const item = await getInventoryItem(id, false, authorization.context.organizationId);
    if (!item) return fail("INVENTORY_ITEM_NOT_FOUND", "Inventory item not found.", 404);

    const { searchParams } = new URL(req.url);
    const query = searchParams.get("q") || item.itemCode || item.description;
    const candidates = await searchCatalogForInventory(query);
    return ok(candidates, { source: "postgres", query });
  } catch (error) {
    logApiError("GET /api/v1/inventory/[id]/catalog-link", error);
    return fail("CATALOG_LINK_LOOKUP_FAILED", "Failed to search catalog candidates.", 500);
  }
}

export async function POST(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;

  try {
    const authorization = await authorizeOrganizationRequest(req, PERMISSIONS.INVENTORY_WRITE);
    if (!authorization.ok) return authorization.response;
    const body = (await req.json()) as Record<string, unknown>;
    const catalogItemId = typeof body.catalogItemId === "string" ? body.catalogItemId : "";
    if (!catalogItemId) return fail("CATALOG_ITEM_REQUIRED", "catalogItemId is required.", 400);

    const item = await linkInventoryToCatalogItem(id, catalogItemId, authorization.context.organizationId);
    if (!item) return fail("INVENTORY_ITEM_NOT_FOUND", "Inventory item not found.", 404);
    return ok(item, { source: "postgres" });
  } catch (error) {
    logApiError("POST /api/v1/inventory/[id]/catalog-link", error);
    const message = error instanceof Error ? error.message : "Failed to link catalog item.";
    return fail("CATALOG_LINK_FAILED", message, 400);
  }
}

export async function DELETE(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;

  try {
    const authorization = await authorizeOrganizationRequest(req, PERMISSIONS.INVENTORY_WRITE);
    if (!authorization.ok) return authorization.response;
    const item = await unlinkInventoryCatalogItem(id, authorization.context.organizationId);
    if (!item) return fail("INVENTORY_ITEM_NOT_FOUND", "Inventory item not found.", 404);
    return ok(item, { source: "postgres" });
  } catch (error) {
    logApiError("DELETE /api/v1/inventory/[id]/catalog-link", error);
    return fail("CATALOG_UNLINK_FAILED", "Failed to unlink catalog item.", 400);
  }
}
