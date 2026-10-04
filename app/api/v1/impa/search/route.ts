import { fail, logApiError, ok } from "@/lib/api/response";
import { searchImpaCatalogue } from "@/lib/impa-catalogue/service";
import { authorizeOrganizationRequest } from "@/lib/auth/authorization";

/**
 * GET /api/v1/impa/search
 *
 * Searches the local Postgres IMPA catalogue. The catalogue can contain the
 * licensed full import or a smaller local dataset.
 */
export async function GET(req: Request) {
  const authorization = await authorizeOrganizationRequest(req);
  if (!authorization.ok) return authorization.response;
  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q")?.trim();

  if (!q || q.length < 2) {
    return fail("INVALID_QUERY", "Query must be at least 2 characters.", 400);
  }

  try {
    const limit = Number(searchParams.get("limit") || 25);
    const result = await searchImpaCatalogue({ organizationId: authorization.context.organizationId, q, limit });

    if (result.results.length === 0) {
      return ok(result, {
        status: "postgres_catalogue",
        message: "No matching IMPA item found in the local Nautex catalogue.",
      });
    }

    return ok(result, {
      status: "postgres_catalogue",
      matchCount: result.summary.totalCandidates,
    });
  } catch (error) {
    logApiError("GET /api/v1/impa/search", error);
    return fail("IMPA_SEARCH_FAILED", "Failed to search IMPA catalogue.", 500);
  }
}
