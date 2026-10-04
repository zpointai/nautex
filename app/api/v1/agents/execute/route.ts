import { authorizeOrganizationRequest } from "@/lib/auth/authorization";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { ApiRequestError, readJsonObject } from "@/lib/api/request";
import { fail, ok, logApiError } from "@/lib/api/response";
import { cancelAgentRun, executeAgentPreview, recoverExpiredAgentRuns } from "@/lib/agents/execution";
import { prisma } from "@/lib/prisma";

export async function GET(req: Request) {
  try {
    const auth = await authorizeOrganizationRequest(req, PERMISSIONS.APP_READ);
    if (!auth.ok) return auth.response;
    await recoverExpiredAgentRuns(auth.context.organizationId);
    return ok(await prisma.agentRun.findMany({ where: { organizationId: auth.context.organizationId, trigger: { in: ["monitor", "scheduled"] } }, orderBy: { startedAt: "desc" }, take: 30, include: { tasks: true } }));
  } catch (error) { logApiError("GET agent execution", error); return fail("RUNS_UNAVAILABLE", "Could not load execution history."); }
}
export async function POST(req: Request) {
  try {
    const auth = await authorizeOrganizationRequest(req, PERMISSIONS.APP_WRITE);
    if (!auth.ok) return auth.response;
    return ok(await executeAgentPreview(auth.context, await readJsonObject(req, 65536), req.signal));
  } catch (error) {
    if (error instanceof ApiRequestError) return fail(error.code, error.message, error.status);
    logApiError("POST agent execution", error); return fail("EXECUTION_FAILED", "Could not start this agent run.");
  }
}
export async function PATCH(req: Request) {
  try {
    const auth = await authorizeOrganizationRequest(req, PERMISSIONS.APP_READ);
    if (!auth.ok) return auth.response;
    const body = await readJsonObject(req, 2048);
    if (Object.keys(body).some(key => key !== "id") || typeof body.id !== "string" || body.id.length > 128) return fail("INVALID_RUN", "Run ID is required.", 400);
    return ok(await cancelAgentRun(auth.context, body.id));
  } catch (error) {
    if (error instanceof ApiRequestError) return fail(error.code, error.message, error.status);
    logApiError("PATCH agent execution", error); return fail("CANCEL_FAILED", "Could not cancel this run.");
  }
}
