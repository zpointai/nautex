import { authorizeOrganizationRequest, hasPermission } from "@/lib/auth/authorization";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { ok } from "@/lib/api/response";
import { financeEntryOptions } from "@/lib/finance/production";
export async function GET(request: Request) {
  const auth = await authorizeOrganizationRequest(request, PERMISSIONS.APP_READ); if (!auth.ok) return auth.response;
  const human = !auth.context.roles.includes("system-agent");
  return ok({ ...await financeEntryOptions(auth.context.organizationId), canWrite: human && hasPermission(auth.context, PERMISSIONS.FINANCE_WRITE), canApprove: human && hasPermission(auth.context, PERMISSIONS.FINANCE_APPROVE) });
}
