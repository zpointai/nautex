import { fail, logApiError, ok } from "@/lib/api/response";
import { authorizeOrganizationRequest } from "@/lib/auth/authorization";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { getInventoryItem, reviewInventoryCycleCount } from "@/lib/inventory/operations";

type Ctx = { params: Promise<{ id: string; countId: string }> };

export async function POST(req: Request, ctx: Ctx) {
  const { id, countId } = await ctx.params;

  try {
    const authorization = await authorizeOrganizationRequest(req, PERMISSIONS.INVENTORY_APPROVE);
    if (!authorization.ok) return authorization.response;
    if (!await getInventoryItem(id, false, authorization.context.organizationId)) {
      return fail("INVENTORY_ITEM_NOT_FOUND", "Inventory item not found.", 404);
    }

    const body = (await req.json()) as Record<string, unknown>;
    const decision = body.decision === "approve" || body.decision === "reject" ? body.decision : null;
    if (!decision) return fail("INVALID_CYCLE_COUNT_DECISION", "decision must be approve or reject.", 400);

    const result = await reviewInventoryCycleCount({
      inventoryItemId: id,
      countId,
      decision,
      reviewNote: typeof body.reviewNote === "string" ? body.reviewNote : null,
      reviewedBy: authorization.context.displayName,
    });
    if (!result) return fail("CYCLE_COUNT_NOT_FOUND", "Cycle count not found.", 404);
    return ok(result, { source: "postgres" });
  } catch (error) {
    logApiError("POST /api/v1/inventory/[id]/cycle-counts/[countId]/decision", error);
    const message = error instanceof Error ? error.message : "Failed to review cycle count.";
    return fail("CYCLE_COUNT_REVIEW_FAILED", message, 400);
  }
}
