import { NextRequest } from "next/server";
import { fail, ok } from "@/lib/api/response";
import { authorizeOrganizationRequest } from "@/lib/auth/authorization";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { decideSupplierInvoice } from "@/lib/finance/actions";
import { getSupplierInvoiceRows } from "@/lib/finance/server";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const authorization = await authorizeOrganizationRequest(request, PERMISSIONS.FINANCE_APPROVE);
    if (!authorization.ok) return authorization.response;
    if (authorization.context.roles.includes("system-agent")) return fail("HUMAN_REQUIRED", "A human finance reviewer must decide supplier invoices.", 403);
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    if (body.decision !== "approve" && body.decision !== "reject") return fail("BAD_REQUEST", "Unsupported supplier invoice decision.", 400);
    await decideSupplierInvoice(id, body.decision, {
      id: authorization.context.userId, name: authorization.context.displayName,
      organizationId: authorization.context.organizationId, activeLegalEntityId: authorization.context.activeLegalEntityId,
    }, typeof body.version === "string" ? body.version : undefined);
    const data = (await getSupplierInvoiceRows(authorization.context.organizationId)).find((row) => row.id === id);
    return ok(data, { source: "postgres" });
  } catch (error) {
    return fail("SUPPLIER_INVOICE_DECISION_FAILED", error instanceof Error ? error.message : "Supplier invoice decision failed.", 409);
  }
}
