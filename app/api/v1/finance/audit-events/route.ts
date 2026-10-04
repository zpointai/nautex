import { NextResponse } from "next/server";
import { authorizeOrganizationRequest } from "@/lib/auth/authorization";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { getFinanceAuditRows } from "@/lib/finance/server";

export async function GET(req: Request) {
  try {
    const authorization = await authorizeOrganizationRequest(req, PERMISSIONS.APP_READ);
    if (!authorization.ok) return authorization.response;
    const data = await getFinanceAuditRows(authorization.context.organizationId);
    return NextResponse.json({ ok: true, data, meta: { source: "postgres" } });
  } catch (error) {
    console.error("[api] GET /api/v1/finance/audit-events:", error);
    return NextResponse.json({ ok: false, error: { message: "Failed to load finance audit events." } }, { status: 500 });
  }
}
