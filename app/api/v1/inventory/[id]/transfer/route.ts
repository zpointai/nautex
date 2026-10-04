import { fail, logApiError, ok } from "@/lib/api/response";
import { authorizeOrganizationRequest } from "@/lib/auth/authorization";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { transferInventoryStock } from "@/lib/inventory/operations";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;

  try {
    const authorization = await authorizeOrganizationRequest(req, PERMISSIONS.INVENTORY_WRITE);
    if (!authorization.ok) return authorization.response;

    const body = (await req.json()) as Record<string, unknown>;
    const transfer = await transferInventoryStock({
      organizationId: authorization.context.organizationId,
      sourceItemId: id,
      destinationWarehouse: typeof body.destinationWarehouse === "string" ? body.destinationWarehouse : "",
      destinationBin: typeof body.destinationBin === "string" ? body.destinationBin : null,
      quantity: Number(body.quantity),
      note: typeof body.note === "string" ? body.note : null,
      actor: authorization.context.displayName,
    });
    if (!transfer) return fail("INVENTORY_ITEM_NOT_FOUND", "Inventory item not found.", 404);
    return ok(transfer, { source: "postgres" }, { status: 201 });
  } catch (error) {
    logApiError("POST /api/v1/inventory/[id]/transfer", error);
    const message = error instanceof Error ? error.message : "Failed to transfer inventory.";
    return fail("INVENTORY_TRANSFER_FAILED", message, 400);
  }
}
