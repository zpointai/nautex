import { fail, logApiError, ok } from "@/lib/api/response";
import { getImpaItemDetail } from "@/lib/impa-catalogue/service";
import { authorizeOrganizationRequest } from "@/lib/auth/authorization";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const authorization = await authorizeOrganizationRequest(_req);
  if (!authorization.ok) return authorization.response;
  const { id } = await ctx.params;

  try {
    const detail = await getImpaItemDetail(id, authorization.context.organizationId);
    if (!detail) return fail("IMPA_ITEM_NOT_FOUND", "IMPA item not found.", 404);
    return ok(detail, { status: "postgres_catalogue" });
  } catch (error) {
    logApiError("GET /api/v1/impa/items/[id]", error);
    return fail("IMPA_ITEM_DETAIL_FAILED", "Failed to fetch IMPA item detail.", 500);
  }
}
