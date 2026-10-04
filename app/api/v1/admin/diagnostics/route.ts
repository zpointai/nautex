import { authorizeOrganizationRequest } from "@/lib/auth/authorization";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { fail, ok } from "@/lib/api/response";
import { supportDiagnostics } from "@/lib/system/diagnostics";

export async function GET(request: Request) {
  const authorization = await authorizeOrganizationRequest(request, PERMISSIONS.ADMIN_USERS);
  if (!authorization.ok) return authorization.response;
  if (authorization.context.roles.includes("system-agent")) return fail("PERMISSION_DENIED", "Diagnostics are available to human administrators.", 403);
  return ok(await supportDiagnostics(), undefined, { headers: { "Cache-Control": "no-store" } });
}
