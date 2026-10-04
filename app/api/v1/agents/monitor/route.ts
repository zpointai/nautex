import { fail, logApiError, ok } from "@/lib/api/response";
import { getAgentMonitorSnapshot } from "@/lib/agents/monitor";
import { authorizeOrganizationRequest } from "@/lib/auth/authorization";
import { PERMISSIONS } from "@/lib/auth/permissions";

/**
 * GET /api/v1/agents/monitor
 *
 * Aggregates agent registry, run history, task history, approvals,
 * exceptions, learning memory, audit snippets, and usage readiness.
 */
export async function GET(req: Request) {
  try {
    const authorization = await authorizeOrganizationRequest(req, PERMISSIONS.APP_READ);
    if (!authorization.ok) return authorization.response;
    const snapshot = await getAgentMonitorSnapshot(authorization.context.organizationId);
    return ok(snapshot, {
      source: "prisma_agent_monitor",
      status: snapshot.dataSource === "demo" ? "demo_data" : "real",
    });
  } catch (error) {
    logApiError("GET /api/v1/agents/monitor", error);
    return fail("AGENT_MONITOR_SNAPSHOT_FAILED", "Failed to fetch agent monitor snapshot.");
  }
}
