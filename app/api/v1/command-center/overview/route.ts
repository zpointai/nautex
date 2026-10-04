import { fail, logApiError, ok } from "@/lib/api/response";
import { authorizeOrganizationRequest } from "@/lib/auth/authorization";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { getCommandCenterOverview, parseCommandCenterMode } from "@/lib/command-center/metrics";
import { resolveOrganizationDataViewMode } from "@/lib/data-environment";

export async function GET(req: Request) {
  try {
    const authorization = await authorizeOrganizationRequest(req, PERMISSIONS.APP_READ);
    if (!authorization.ok) return authorization.response;

    const url = new URL(req.url);
    const requestedMode = url.searchParams.get("mode");
    const resolvedMode = authorization.context.organizationDataMode
      ? resolveOrganizationDataViewMode(requestedMode, authorization.context.organizationDataMode)
      : "operational";
    const parsedMode = parseCommandCenterMode(resolvedMode);
    const overview = await getCommandCenterOverview({
      mode: parsedMode.mode,
      requestedMode,
      organizationId: authorization.context.organizationId,
      organizationName: authorization.context.organizationName,
    });

    return ok(overview, {
      source: "postgres",
      status: overview.provenance.usedDataProvenance ? "real" : "partial",
      mode: overview.mode,
      ...((parsedMode.fallbackApplied || (requestedMode && requestedMode !== parsedMode.mode))
        ? { requestedMode, fallback: parsedMode.mode }
        : {}),
    });
  } catch (error) {
    logApiError("GET /api/v1/command-center/overview", error);
    return fail("COMMAND_CENTER_OVERVIEW_FAILED", "Unable to load Command Center overview.");
  }
}
