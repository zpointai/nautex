import { fail, logApiError, ok } from "@/lib/api/response";
import { authorizeOrganizationRequest } from "@/lib/auth/authorization";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/v1/agents/runs
 *
 * Returns recent agent runs with their tasks.
 * Query params: ?limit=20&status=Running&agent=classification
 */
export async function GET(req: Request) {
  try {
    const authorization = await authorizeOrganizationRequest(req, PERMISSIONS.APP_READ);
    if (!authorization.ok) return authorization.response;
    const url = new URL(req.url);
    const limit = Math.min(parseInt(url.searchParams.get("limit") || "20"), 100);
    const status = url.searchParams.get("status");
    const agent = url.searchParams.get("agent");

    const where: Record<string, unknown> = { organizationId: authorization.context.organizationId };
    if (status) where.status = status;
    if (agent) where.agent = agent;

    const runs = await prisma.agentRun.findMany({
      where,
      include: {
        tasks: {
          orderBy: { startedAt: "asc" },
          include: {
            approvals: true,
            exceptions: true,
          },
        },
      },
      orderBy: { startedAt: "desc" },
      take: limit,
    });

    return ok(runs, { source: "prisma", status: "demo_data" });
  } catch (error) {
    logApiError("GET /api/v1/agents/runs", error);
    return fail("AGENT_RUNS_LIST_FAILED", "Failed to fetch agent runs.");
  }
}
