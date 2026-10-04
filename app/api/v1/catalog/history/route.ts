import { fail, logApiError, ok } from "@/lib/api/response";
import { getItemSearchHistory } from "@/lib/item-search/service";
import { authorizeOrganizationRequest } from "@/lib/auth/authorization";

export async function GET(req: Request) {
  const authorization = await authorizeOrganizationRequest(req);
  if (!authorization.ok) return authorization.response;
  const { searchParams } = new URL(req.url);
  const limit = Math.min(Number(searchParams.get("limit") || 20), 50);

  try {
    return ok(await getItemSearchHistory(authorization.context.organizationId, limit), { source: "postgres" });
  } catch (error) {
    logApiError("GET /api/v1/catalog/history", error);
    return fail("CATALOG_HISTORY_FAILED", "Failed to load catalog history.", 500);
  }
}
