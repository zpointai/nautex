import { fail, logApiError, ok, requestId } from "@/lib/api/response";
import { executeIdempotentRequest } from "@/lib/api/idempotency";
import { ApiRequestError, readJsonObject } from "@/lib/api/request";
import { authorizeOrganizationRequest } from "@/lib/auth/authorization";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { createSupplierInquiry, listSupplierInquiries } from "@/lib/supplier-inquiries/service";

export async function GET(req: Request) {
  try {
    const authorization = await authorizeOrganizationRequest(req, PERMISSIONS.APP_READ);
    if (!authorization.ok) return authorization.response;
    const url = new URL(req.url);
    const data = await listSupplierInquiries(authorization.context.organizationId, {
      rfqId: url.searchParams.get("rfqId") || undefined,
      supplierId: url.searchParams.get("supplierId") || undefined,
    });
    return ok(data, { source: "postgres" });
  } catch (error) {
    logApiError("GET /api/v1/supplier-inquiries", error);
    return fail("SUPPLIER_INQUIRY_LIST_FAILED", "Failed to load supplier inquiries.", 500);
  }
}

export async function POST(req: Request) {
  try {
    const authorization = await authorizeOrganizationRequest(req, PERMISSIONS.PROCUREMENT_WRITE);
    if (!authorization.ok) return authorization.response;
    return await executeIdempotentRequest({
      request: req,
      organizationId: authorization.context.organizationId,
      route: "POST /api/v1/supplier-inquiries",
      handler: async () => {
        const body = await readJsonObject(req);
        const rfqId = typeof body.rfqId === "string" ? body.rfqId.trim() : "";
        const supplierId = typeof body.supplierId === "string" ? body.supplierId.trim() : "";
        if (!rfqId || !supplierId) return fail("SUPPLIER_INQUIRY_CONTEXT_REQUIRED", "rfqId and supplierId are required.", 400);
        const responseDueAt = typeof body.responseDueAt === "string" && body.responseDueAt ? new Date(body.responseDueAt) : null;
        if (responseDueAt && Number.isNaN(responseDueAt.getTime())) return fail("RESPONSE_DUE_AT_INVALID", "responseDueAt must be a valid date.", 400);
        const rfqLineIds = Array.isArray(body.rfqLineIds)
          ? body.rfqLineIds.filter((value): value is string => typeof value === "string" && Boolean(value.trim())).map((value) => value.trim())
          : undefined;
        const data = await createSupplierInquiry({
          organizationId: authorization.context.organizationId,
          legalEntityId: authorization.context.activeLegalEntityId,
          rfqId,
          supplierId,
          rfqLineIds,
          subject: typeof body.subject === "string" ? body.subject : null,
          message: typeof body.message === "string" ? body.message : null,
          responseDueAt,
          sourceKey: typeof body.sourceKey === "string" ? body.sourceKey : null,
          actor: { id: authorization.context.userId, name: authorization.context.displayName, requestId: requestId(req) },
        });
        return ok(data, { source: "postgres", status: "draft" }, { status: 201 });
      },
    });
  } catch (error) {
    if (error instanceof ApiRequestError) return fail(error.code, error.message, error.status);
    logApiError("POST /api/v1/supplier-inquiries", error);
    return fail("SUPPLIER_INQUIRY_CREATE_FAILED", error instanceof Error ? error.message : "Failed to create supplier inquiry.", 409);
  }
}
