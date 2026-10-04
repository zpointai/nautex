import { fail, logApiError, ok } from "@/lib/api/response";
import { executeIdempotentRequest } from "@/lib/api/idempotency";
import { ApiRequestError, readJsonObject } from "@/lib/api/request";
import { authorizeOrganizationRequest } from "@/lib/auth/authorization";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { listOperationalExceptions, updateOperationalException, type ExceptionAction, type ExceptionFilters } from "@/lib/exceptions/service";

/**
 * GET /api/v1/agents/exceptions
 *
 * Central human-intervention queue for Nautex exceptions.
 * Query params: status, severity, domain, source, objectType, creator, overdue,
 * risk, dateRange, q, sort, limit.
 */
export async function GET(req: Request) {
  try {
    const authorization = await authorizeOrganizationRequest(req, PERMISSIONS.APP_READ);
    if (!authorization.ok) return authorization.response;
    const url = new URL(req.url);
    const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit") || "100", 10), 1), 250);
    const filters: ExceptionFilters = {
      status: url.searchParams.get("status") || undefined,
      severity: url.searchParams.get("severity") || undefined,
      domain: url.searchParams.get("domain") || undefined,
      source: url.searchParams.get("source") || undefined,
      objectType: url.searchParams.get("objectType") || undefined,
      creator: url.searchParams.get("creator") || undefined,
      overdue: url.searchParams.get("overdue") || undefined,
      risk: url.searchParams.get("risk") || undefined,
      dateRange: url.searchParams.get("dateRange") || undefined,
      q: url.searchParams.get("q") || undefined,
      sort: url.searchParams.get("sort") || undefined,
      limit,
    };

    const result = await listOperationalExceptions(filters, authorization.context.organizationId);
    const status = result.exceptions.some((item) => item.dataSource === "demo")
      ? result.exceptions.some((item) => item.dataSource === "production")
        ? "partial"
        : "demo_data"
      : "real";

    return ok(result, { source: "prisma", status });
  } catch (error) {
    logApiError("GET /api/v1/agents/exceptions", error);
    return fail("AGENT_EXCEPTIONS_LIST_FAILED", "Failed to fetch exceptions.");
  }
}

/**
 * PATCH /api/v1/agents/exceptions
 *
 * Human status transition only. This route does not approve or modify linked
 * business records.
 * Body: { id, action: "review" | "resolve" | "dismiss" | "reopen", note?, reason? }
 */
export async function PATCH(req: Request) {
  try {
    const authorization = await authorizeOrganizationRequest(req, PERMISSIONS.EXCEPTIONS_MANAGE);
    if (!authorization.ok) return authorization.response;

    return await executeIdempotentRequest({
      request: req,
      organizationId: authorization.context.organizationId,
      route: "PATCH /api/v1/agents/exceptions",
      handler: async () => {
    const body = await readJsonObject(req);
    const id = typeof body.id === "string" ? body.id : "";
    const action = typeof body.action === "string" ? body.action : "";
    const actor = authorization.context.displayName;
    const note = typeof body.note === "string" ? body.note : undefined;
    const reason = typeof body.reason === "string" ? body.reason : undefined;

    if (!id || !["review", "resolve", "dismiss", "reopen"].includes(action)) {
      return fail("AGENT_EXCEPTION_INVALID_ACTION", "Valid id and action are required.", 400);
    }

    const result = await updateOperationalException({ organizationId: authorization.context.organizationId, id, action: action as ExceptionAction, actor, note, reason });
    return ok(result, { source: "prisma", status: "real" });
      },
    });
  } catch (error) {
    if (error instanceof ApiRequestError) return fail(error.code, error.message, error.status);
    logApiError("PATCH /api/v1/agents/exceptions", error);
    if (error instanceof Error && error.message === "EXCEPTION_NOT_FOUND") {
      return fail("AGENT_EXCEPTION_NOT_FOUND", "Exception not found.", 404);
    }
    if (error instanceof Error && error.message === "ACTION_REASON_REQUIRED") {
      return fail("AGENT_EXCEPTION_REASON_REQUIRED", "A note or reason is required for resolve and dismiss actions.", 400);
    }
    if (error instanceof Error && error.message === "ACTION_NOT_ALLOWED") {
      return fail("AGENT_EXCEPTION_ACTION_NOT_ALLOWED", "This exception status does not allow the requested action.", 409);
    }
    if (error instanceof Error && error.message === "INVALID_ACTION") {
      return fail("AGENT_EXCEPTION_INVALID_ACTION", "Unsupported exception action.", 400);
    }
    return fail("AGENT_EXCEPTION_UPDATE_FAILED", "Failed to update exception.");
  }
}
