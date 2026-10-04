import { NextRequest } from "next/server";
import { fail, ok } from "@/lib/api/response";
import { executeIdempotentRequest } from "@/lib/api/idempotency";
import { ApiRequestError, readJsonObject } from "@/lib/api/request";
import { authorizeOrganizationRequest } from "@/lib/auth/authorization";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { postCustomerInvoice, reviewCustomerInvoice, sendCustomerInvoice } from "@/lib/finance/actions";
import { getCustomerInvoiceRows } from "@/lib/finance/server";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const authorization = await authorizeOrganizationRequest(request, PERMISSIONS.FINANCE_APPROVE);
    if (!authorization.ok) return authorization.response;
    const { id } = await params;
    return await executeIdempotentRequest({
      request,
      organizationId: authorization.context.organizationId,
      route: "POST /api/v1/finance/customer-invoices/:id/transition",
      handler: async () => {
    const body = await readJsonObject(request);
    const actor = {
      id: authorization.context.userId, name: authorization.context.displayName,
      organizationId: authorization.context.organizationId, activeLegalEntityId: authorization.context.activeLegalEntityId,
    };
    if (body.action === "review") await reviewCustomerInvoice(id, actor);
    else if (body.action === "post") await postCustomerInvoice(id, actor);
    else if (body.action === "send") await sendCustomerInvoice(id, actor);
    else return fail("BAD_REQUEST", "Unsupported invoice transition.", 400);
    const data = (await getCustomerInvoiceRows(authorization.context.organizationId)).find((row) => row.id === id);
    return ok(data, { source: "postgres" });
      },
    });
  } catch (error) {
    if (error instanceof ApiRequestError) return fail(error.code, error.message, error.status);
    return fail("FINANCE_ACTION_FAILED", error instanceof Error ? error.message : "Invoice transition failed.", 409);
  }
}
