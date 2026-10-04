import { NextResponse } from "next/server";
import { authorizeOrganizationRequest } from "@/lib/auth/authorization";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { getSupplierInvoiceRows } from "@/lib/finance/server";
import { saveSupplierInvoice } from "@/lib/finance/production";
import { ApiRequestError, readJsonObject } from "@/lib/api/request";
import { fail, ok } from "@/lib/api/response";

export async function POST(request: Request) {
  const authorization = await authorizeOrganizationRequest(request, PERMISSIONS.FINANCE_WRITE);
  if (!authorization.ok) return authorization.response;
  try { return ok(await saveSupplierInvoice(authorization.context, await readJsonObject(request, 16_384))); }
  catch (error) { return fail("SUPPLIER_INTAKE_FAILED", error instanceof Error ? error.message : "Invoice could not be saved.", error instanceof ApiRequestError ? error.status : 409); }
}

export async function GET(req: Request) {
  try {
    const authorization = await authorizeOrganizationRequest(req, PERMISSIONS.APP_READ);
    if (!authorization.ok) return authorization.response;
    const data = await getSupplierInvoiceRows(authorization.context.organizationId);
    return NextResponse.json({ ok: true, data, meta: { source: "postgres" } });
  } catch (error) {
    console.error("[api] GET /api/v1/finance/supplier-invoices:", error);
    return NextResponse.json({ ok: false, error: { message: "Failed to load supplier invoices." } }, { status: 500 });
  }
}
