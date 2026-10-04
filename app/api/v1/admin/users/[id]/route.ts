import { fail, logApiError, ok } from "@/lib/api/response";
import { ApiRequestError, readJsonObject } from "@/lib/api/request";
import { authorizeOrganizationRequest } from "@/lib/auth/authorization";
import { isLocalAuthMode } from "@/lib/auth/config";
import { updateEmployee } from "@/lib/auth/employee-admin";
import { PERMISSIONS } from "@/lib/auth/permissions";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const authorization = await authorizeOrganizationRequest(request, PERMISSIONS.ADMIN_USERS);
  if (!authorization.ok) return authorization.response;
  if (!isLocalAuthMode()) return fail("LOCAL_AUTH_DISABLED", "Local employee accounts are available only in local authentication mode.", 409);
  try {
    return ok(await updateEmployee(authorization.context, (await params).id, await readJsonObject(request, 16384)));
  } catch (error) {
    if (error instanceof ApiRequestError) return fail(error.code, error.message, error.status);
    logApiError("PATCH /api/v1/admin/users/:id", error);
    return fail("EMPLOYEE_UPDATE_FAILED", "Employee update failed. No partial change was saved.", 500);
  }
}
