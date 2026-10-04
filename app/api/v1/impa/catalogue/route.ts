import { fail, logApiError, ok } from "@/lib/api/response";
import { getImpaSummary, listImpaCatalogue } from "@/lib/impa-catalogue/service";
import { authorizeOrganizationRequest } from "@/lib/auth/authorization";

export async function GET(req: Request) {
  try {
    const authorization = await authorizeOrganizationRequest(req);
    if (!authorization.ok) return authorization.response;
    const organizationId = authorization.context.organizationId;
    const { searchParams } = new URL(req.url);
    const summaryOnly = searchParams.get("summary") === "true";
    const limit = Number(searchParams.get("limit") || 50);
    const offset = Number(searchParams.get("offset") || 0);
    const category = searchParams.get("category")?.trim();
    const q = searchParams.get("q")?.trim();

    if (summaryOnly) {
      return ok(await getImpaSummary(organizationId), { status: "postgres_catalogue" });
    }

    const page = await listImpaCatalogue({ organizationId, category, q, limit, offset });

    return ok(page.items, {
      status: "postgres_catalogue",
      total: page.total,
      limit: page.limit,
      offset: page.offset,
      count: page.items.length,
      hasMore: page.hasMore,
    });
  } catch (error) {
    logApiError("GET /api/v1/impa/catalogue", error);
    return fail("IMPA_CATALOGUE_FAILED", "Failed to fetch IMPA catalogue.", 500);
  }
}
