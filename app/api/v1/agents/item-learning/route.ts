import { authorizeOrganizationRequest, hasPermission } from "@/lib/auth/authorization";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { canManageAgents } from "@/lib/agents/controls";
import { ApiRequestError, readJsonObject } from "@/lib/api/request";
import { fail, ok } from "@/lib/api/response";
import { prisma } from "@/lib/prisma";
import { captureItemCorrection, reviewItemCorrection } from "@/lib/learning/item-service";
import { itemFingerprint } from "@/lib/learning/item-search";
export async function GET(request: Request) {
  const auth = await authorizeOrganizationRequest(request, PERMISSIONS.APP_READ);
  if (!auth.ok) return auth.response;
  const organizationId = auth.context.organizationId, search = (new URL(request.url).searchParams.get("search") ?? "").slice(0, 200);
  const [records, items] = await Promise.all([
    prisma.itemLearningCorrection.findMany({ where: { organizationId }, include: { inventoryItem: true }, orderBy: { createdAt: "desc" }, take: 100 }),
    prisma.inventoryItem.findMany({ where: { organizationId, ...(search ? { OR: [{ description: { contains: search, mode: "insensitive" } }, { itemCode: { contains: search, mode: "insensitive" } }] } : {}) }, select: { id: true, description: true, itemCode: true, uom: true }, orderBy: { description: "asc" }, take: 50 }),
  ]);
  return ok({ records: records.map(({ inventoryItem, ...row }) => ({ ...row, sourceCurrent: inventoryItem.organizationId === organizationId && row.sourceFingerprint === itemFingerprint(inventoryItem) })), items, canManage: canManageAgents(auth.context), canCreate: hasPermission(auth.context, PERMISSIONS.INVENTORY_WRITE) && !auth.context.roles.includes("system-agent") });
}
async function mutate(request: Request, capture: boolean) {
  const auth = await authorizeOrganizationRequest(request, capture ? PERMISSIONS.INVENTORY_WRITE : PERMISSIONS.AGENTS_APPROVE);
  if (!auth.ok) return auth.response;
  try {
    const body = await readJsonObject(request, 6000);
    if (capture) return ok(await captureItemCorrection(auth.context, body));
    if (typeof body.id !== "string" || typeof body.action !== "string" || !Number.isInteger(body.revision)) return fail("INVALID_REVIEW", "Correction, action and revision are required.", 400);
    return ok(await reviewItemCorrection(auth.context, body.id, Number(body.revision), body.action));
  } catch (error) { return error instanceof ApiRequestError ? fail(error.code, error.message, error.status) : fail("ITEM_LEARNING_FAILED", "Could not save the correction. Your input is retained; refresh before retrying.", 500); }
}
export const POST = (request: Request) => mutate(request, true);
export const PATCH = (request: Request) => mutate(request, false);
