import { NextRequest } from "next/server";
import { fail, ok } from "@/lib/api/response";
import { authorizeOrganizationRequest } from "@/lib/auth/authorization";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { createCustomerInvoiceFromDeliveredOrder } from "@/lib/finance/actions";
import { getCustomerInvoiceRows } from "@/lib/finance/server";

export async function POST(request: NextRequest) {
  try {
    const authorization = await authorizeOrganizationRequest(request, PERMISSIONS.FINANCE_WRITE);
    if (!authorization.ok) return authorization.response;
    if (authorization.context.roles.includes("system-agent")) return fail("HUMAN_REQUIRED", "A human must review the invoice tax treatment.", 403);
    const body = await request.json().catch(() => ({}));
    if (typeof body.orderId !== "string") return fail("BAD_REQUEST", "orderId is required.", 400);
    const invoice = await createCustomerInvoiceFromDeliveredOrder(body.orderId, {
      id: authorization.context.userId,
      name: authorization.context.displayName,
      organizationId: authorization.context.organizationId,
      activeLegalEntityId: authorization.context.activeLegalEntityId,
    }, body.taxReview);
    const data = (await getCustomerInvoiceRows(authorization.context.organizationId)).find((row) => row.id === invoice.id);
    return ok(data, { source: "postgres" });
  } catch (error) {
    return fail("CUSTOMER_INVOICE_CREATE_FAILED", error instanceof Error ? error.message : "Customer invoice creation failed.", 409);
  }
}
