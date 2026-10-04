import { authorizeOrganizationRequest } from "@/lib/auth/authorization";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { ApiRequestError, readJsonObject } from "@/lib/api/request";
import { fail, ok, logApiError } from "@/lib/api/response";
import { getAgentControls, setAgentEnabled } from "@/lib/agents/controls";

export async function GET(req: Request) {
  try {
    const auth = await authorizeOrganizationRequest(req, PERMISSIONS.APP_READ);
    if (!auth.ok) return auth.response;
    return ok(await getAgentControls(auth.context));
  } catch (error) { logApiError("GET agent controls", error); return fail("CONTROLS_UNAVAILABLE", "Could not load agent controls."); }
}
export async function PATCH(req: Request) {
  try {
    const auth = await authorizeOrganizationRequest(req, PERMISSIONS.AGENTS_APPROVE);
    if (!auth.ok) return auth.response;
    const body = await readJsonObject(req, 2048);
    if (Object.keys(body).some(key => !["agentId", "enabled", "revision"].includes(key)) || typeof body.agentId !== "string" || typeof body.enabled !== "boolean" || !Number.isSafeInteger(body.revision) || Number(body.revision) < 0) return fail("INVALID_CONTROL", "Agent, enabled state and current revision are required.", 400);
    return ok(await setAgentEnabled(auth.context, body.agentId, body.enabled, Number(body.revision)));
  } catch (error) {
    if (error instanceof ApiRequestError) return fail(error.code, error.message, error.status);
    logApiError("PATCH agent controls", error); return fail("CONTROL_FAILED", "Could not change this control.");
  }
}
