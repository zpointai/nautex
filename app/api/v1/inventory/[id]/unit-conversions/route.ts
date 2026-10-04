import { authorizeOrganizationRequest, hasPermission } from "@/lib/auth/authorization";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { ApiRequestError, readJsonObject } from "@/lib/api/request";
import { fail, ok } from "@/lib/api/response";
import { prisma } from "@/lib/prisma";
import { reviewUnitConversion } from "@/lib/inventory/unit-conversions";
type Route = { params: Promise<{ id: string }> };
export async function GET(req: Request, route: Route) {
  const auth = await authorizeOrganizationRequest(req, PERMISSIONS.APP_READ); if (!auth.ok) return auth.response;
  const { id } = await route.params;
  if (!await prisma.inventoryItem.count({ where: { id, organizationId: auth.context.organizationId } })) return fail("NOT_FOUND", "Inventory item not found.", 404);
  const human = !auth.context.roles.includes("system-agent");
  return ok({ rows: await prisma.inventoryUnitConversion.findMany({ where: { inventoryItemId: id }, orderBy: { createdAt: "desc" } }), canPropose: human && hasPermission(auth.context, PERMISSIONS.INVENTORY_WRITE), canReview: human && hasPermission(auth.context, PERMISSIONS.INVENTORY_APPROVE) });
}
export async function POST(req: Request, route: Route) {
  const auth = await authorizeOrganizationRequest(req, PERMISSIONS.APP_READ); if (!auth.ok) return auth.response;
  try {
    const body = await readJsonObject(req, 5000), { id } = await route.params;
    if (!["propose", "approve", "revoke"].includes(String(body.action)) || typeof body.reason !== "string") return fail("INVALID_CONVERSION", "Choose a supported review action and reason.", 400);
    if (body.action === "propose" && (typeof body.orderUnit !== "string" || typeof body.factor !== "number")) return fail("INVALID_CONVERSION", "Enter an order unit and numeric ratio.", 400);
    if (body.action !== "propose" && typeof body.id !== "string") return fail("INVALID_CONVERSION", "Select a conversion to review.", 400);
    return ok(await reviewUnitConversion(auth.context, id, { action: body.action as "propose" | "approve" | "revoke", reason: body.reason, id: body.id as string | undefined, orderUnit: body.orderUnit as string | undefined, factor: body.factor as number | undefined }));
  } catch (e) { return fail("CONVERSION_FAILED", e instanceof Error ? e.message : "Conversion review failed.", e instanceof ApiRequestError ? e.status : 409); }
}
