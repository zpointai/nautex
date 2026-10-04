import { fail, logApiError, ok } from "@/lib/api/response";
import { authorizeOrganizationRequest } from "@/lib/auth/authorization";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { listSalesOrders } from "@/lib/sales-orders/service";

export async function GET(req: Request) {
  try {
    const authorization = await authorizeOrganizationRequest(req, PERMISSIONS.APP_READ);
    if (!authorization.ok) return authorization.response;
    const url = new URL(req.url);
    const data = await listSalesOrders(authorization.context.organizationId, {
      customerId: url.searchParams.get("customerId") || undefined,
      quoteId: url.searchParams.get("quoteId") || undefined,
    });
    return ok(data, { source: "postgres" });
  } catch (error) {
    logApiError("GET /api/v1/sales-orders", error);
    return fail("SALES_ORDER_LIST_FAILED", "Failed to load sales orders.", 500);
  }
}
