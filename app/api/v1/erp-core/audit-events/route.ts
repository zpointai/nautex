import { fail, logApiError, ok } from "@/lib/api/response";
import { authorizeOrganizationRequest } from "@/lib/auth/authorization";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { listAuditEventsForEntity } from "@/lib/erp-core/audit";

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
    const limit = Number(searchParams.get("limit") ?? 50);

    if (!entityType || !entityId) {
      return fail("ERP_AUDIT_ENTITY_REQUIRED", "entityType and entityId are required.", 400);
    }

    const data = await listAuditEventsForEntity(
      entityType,
      entityId,
      Number.isFinite(limit) ? limit : 50,
      authorization.context.organizationId,
    );

    return ok(data, { source: "postgres", status: "real" });
  } catch (error) {
    logApiError("GET /api/v1/erp-core/audit-events", error);
    return fail("ERP_AUDIT_EVENTS_LIST_FAILED", "Failed to fetch ERP audit events.");
  }
}
