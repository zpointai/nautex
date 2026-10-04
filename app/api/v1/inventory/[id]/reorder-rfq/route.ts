import { fail, logApiError, ok } from "@/lib/api/response";
import { authorizeOrganizationRequest } from "@/lib/auth/authorization";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { createInventoryReorderRfq } from "@/lib/inventory/reorder";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;

  try {
    const authorization = await authorizeOrganizationRequest(req, PERMISSIONS.PROCUREMENT_WRITE);
    if (!authorization.ok) return authorization.response;
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const result = await createInventoryReorderRfq(id, body, authorization.context.organizationId);
    if (!result) return fail("INVENTORY_ITEM_NOT_FOUND", "Inventory item not found.", 404);
    return ok(result, { source: "postgres" }, { status: 201 });
  } catch (error) {
    logApiError("POST /api/v1/inventory/[id]/reorder-rfq", error);
    const message = error instanceof Error ? error.message : "Failed to create reorder RFQ.";
    return fail("REORDER_RFQ_FAILED", message, 400);
  }
}
