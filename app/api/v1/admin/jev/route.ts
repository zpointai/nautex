import { authorizeOrganizationRequest } from "@/lib/auth/authorization";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { ApiRequestError, readJsonObject } from "@/lib/api/request";
import { fail, ok } from "@/lib/api/response";
import { changeJevSettings, jevStatus } from "@/lib/ai/jev-settings";
export async function GET(request: Request) {
  const auth = await authorizeOrganizationRequest(request, PERMISSIONS.ADMIN_USERS);
  if (!auth.ok) return auth.response;
  return ok(await jevStatus(auth.context.organizationId, true), undefined, { headers: { "Cache-Control": "no-store" } });
}
export async function POST(request: Request) {
  const auth = await authorizeOrganizationRequest(request, PERMISSIONS.ADMIN_USERS);
  if (!auth.ok) return auth.response;
  try { await changeJevSettings(auth.context, await readJsonObject(request, 6144)); return ok(await jevStatus(auth.context.organizationId, true)); }
  catch (e) { return e instanceof ApiRequestError ? fail(e.code, e.message, e.status) : fail("JEV_SETTINGS_FAILED", "Jev settings could not be saved.", 500); }
}
