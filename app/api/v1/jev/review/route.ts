import { authorizeOrganizationRequest, hasPermission } from "@/lib/auth/authorization";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { ApiRequestError, readJsonObject } from "@/lib/api/request";
import { fail, ok } from "@/lib/api/response";
import { reviewWithJev } from "@/lib/ai/jev-review";
import { jevStatus } from "@/lib/ai/jev-settings";
export async function GET(request: Request) {
  const auth = await authorizeOrganizationRequest(request, PERMISSIONS.APP_READ);
  if (!auth.ok) return auth.response;
  return ok({ ...await jevStatus(auth.context.organizationId), canReview: hasPermission(auth.context, PERMISSIONS.APP_WRITE) && !auth.context.roles.includes("system-agent") }, undefined, { headers: { "Cache-Control": "no-store" } });
}
export async function POST(request: Request) {
  const auth = await authorizeOrganizationRequest(request, PERMISSIONS.APP_WRITE);
  if (!auth.ok) return auth.response;
  try {
    const advice = await reviewWithJev(auth.context, await readJsonObject(request, 4096), request.signal);
    const currentAuth = await authorizeOrganizationRequest(request, PERMISSIONS.APP_WRITE);
    if (!currentAuth.ok) return currentAuth.response;
    return ok(advice);
  } catch (e) { return e instanceof ApiRequestError ? fail(e.code, e.message, e.status) : fail("JEV_REVIEW_FAILED", "The review could not be recorded. Ordinary search remains available.", 500); }
}
