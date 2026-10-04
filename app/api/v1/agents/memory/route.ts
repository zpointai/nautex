import { fail, logApiError, ok } from "@/lib/api/response";
import { authorizeOrganizationRequest } from "@/lib/auth/authorization";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { learningSummary } from "@/lib/learning/service";

export async function GET(req: Request) {
  try {
    const authorization = await authorizeOrganizationRequest(req, PERMISSIONS.APP_READ);
    if (!authorization.ok) return authorization.response;
    const url = new URL(req.url);
    const parsed = Number(url.searchParams.get("limit") || "25");
    const limit = Number.isSafeInteger(parsed) ? Math.max(1, Math.min(parsed, 100)) : 25;
    const includeSummary = url.searchParams.get("summary") !== "false";

    const summary = await learningSummary(authorization.context.organizationId, limit);
    if (!includeSummary) return ok(summary.records, { source: "organization_scoped_corrections" });
    return ok(
      summary,
      {
        source: "organization_scoped_memory",
        status: "partial",
        organizationId: authorization.context.organizationId,
        limit,
        message: "Reviewed supplier corrections only. Historical unowned feedback is excluded. Activation is explicit and reversible.",
      },
    );
  } catch (error) {
    logApiError("GET /api/v1/agents/memory", error);
    return fail("AGENT_MEMORY_LIST_FAILED", "Failed to fetch agent memory.");
  }
}
