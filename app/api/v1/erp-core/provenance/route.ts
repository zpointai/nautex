import { fail, logApiError, ok } from "@/lib/api/response";
import { authorizeOrganizationRequest } from "@/lib/auth/authorization";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { getProvenance } from "@/lib/erp-core/provenance";

function requireParam(searchParams: URLSearchParams, name: string) {
  const value = searchParams.get(name)?.trim();
  return value || null;
}

export async function GET(req: Request) {
  try {
    const authorization = await authorizeOrganizationRequest(req, PERMISSIONS.APP_READ);
    if (!authorization.ok) return authorization.response;
    const { searchParams } = new URL(req.url);
    const entityType = requireParam(searchParams, "entityType");
    const entityId = requireParam(searchParams, "entityId");

    if (!entityType || !entityId) {
      return fail("ERP_PROVENANCE_ENTITY_REQUIRED", "entityType and entityId are required.", 400);
    }

    const data = await getProvenance(entityType, entityId, authorization.context.organizationId);
    return ok(data, { source: "postgres", status: data ? "real" : "not_found" });
  } catch (error) {
    logApiError("GET /api/v1/erp-core/provenance", error);
    return fail("ERP_PROVENANCE_LOOKUP_FAILED", "Failed to fetch ERP provenance.");
  }
}
