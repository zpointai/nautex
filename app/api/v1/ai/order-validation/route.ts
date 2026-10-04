import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { fail, logApiError, ok } from "@/lib/api/response";
import { authorizeOrganizationRequest } from "@/lib/auth/authorization";

export async function GET(req: NextRequest) {
  try {
    const authorization = await authorizeOrganizationRequest(req);
    if (!authorization.ok) return authorization.response;
    const orders = await prisma.purchaseOrder.findMany({
      where: { organizationId: authorization.context.organizationId },
      select: { id: true, poNumber: true },
    });
    const orderIds = orders.flatMap((order) => [order.id, order.poNumber]);
    const id = req.nextUrl.searchParams.get("orderId");

    if (!id) {
      const data = await prisma.aiCheckResult.findMany({ where: { orderId: { in: orderIds } }, orderBy: { createdAt: "desc" }, take: 200 });
      return ok(data, { source: "postgres", demoReady: data.length > 0 });
    }

    const result = orderIds.includes(id) ? await prisma.aiCheckResult.findFirst({ where: { orderId: id } }) : null;
    if (!result) {
      return fail("AI_CHECK_NOT_FOUND", "No AI validation found for this order.", 404);
    }
    return ok(result, { source: "postgres" });
  } catch (error) {
    logApiError("GET /api/v1/ai/order-validation", error);
    return fail("AI_CHECK_LIST_FAILED", "Failed to fetch AI validation results.", 500);
  }
}
