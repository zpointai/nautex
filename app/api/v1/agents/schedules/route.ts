import { authorizeOrganizationRequest } from "@/lib/auth/authorization";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { ApiRequestError, readJsonObject } from "@/lib/api/request";
import { fail, ok } from "@/lib/api/response";
import { prisma } from "@/lib/prisma";
import { createAgentSchedule, setScheduleEnabled } from "@/lib/agents/schedules";
import { canManageAgents } from "@/lib/agents/controls";
export async function GET(request: Request) {
  const auth = await authorizeOrganizationRequest(request, PERMISSIONS.APP_READ);
  if (!auth.ok) return auth.response;
  return ok({ canManage: canManageAgents(auth.context), workerEnabled: process.env.NAUTEX_AGENT_SCHEDULER === "1", schedules: await prisma.agentSchedule.findMany({ where: { organizationId: auth.context.organizationId }, orderBy: { createdAt: "desc" }, take: 50 }) });
}
async function mutate(request: Request, create: boolean) {
  const auth = await authorizeOrganizationRequest(request, PERMISSIONS.AGENTS_APPROVE);
  if (!auth.ok) return auth.response;
  try {
    const body = await readJsonObject(request, 65536);
    if (create) return ok(await createAgentSchedule(auth.context, body));
    if (typeof body.id !== "string" || typeof body.enabled !== "boolean" || !Number.isInteger(body.revision)) return fail("INVALID_SCHEDULE", "Schedule, state and current revision are required.", 400);
    await setScheduleEnabled(auth.context, body.id, body.enabled, Number(body.revision));
    return ok({ updated: true });
  } catch (error) { return error instanceof ApiRequestError ? fail(error.code, error.message, error.status) : fail("SCHEDULE_FAILED", "Could not save the schedule. Refresh before retrying.", 500); }
}
export const POST = (request: Request) => mutate(request, true);
export const PATCH = (request: Request) => mutate(request, false);
