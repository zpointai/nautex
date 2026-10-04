import { fail, ok } from "@/lib/api/response";
import { authorizeOrganizationRequest } from "@/lib/auth/authorization";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { resolveFinanceException } from "@/lib/finance/actions";
import { getFinanceExceptionRows } from "@/lib/finance/server";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const authorization = await authorizeOrganizationRequest(request, PERMISSIONS.FINANCE_APPROVE);
    if (!authorization.ok) return authorization.response;
    const { id } = await params;
    await resolveFinanceException(id, {
      id: authorization.context.userId, name: authorization.context.displayName,
      organizationId: authorization.context.organizationId, activeLegalEntityId: authorization.context.activeLegalEntityId,
    });
    const data = (await getFinanceExceptionRows(authorization.context.organizationId)).find((row) => row.id === id);
    return ok(data, { source: "postgres" });
  } catch (error) {
    return fail("FINANCE_EXCEPTION_RESOLVE_FAILED", error instanceof Error ? error.message : "Finance exception resolve failed.", 409);
  }
}
