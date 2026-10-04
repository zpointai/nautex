import { NextResponse } from "next/server";
import { authorizeOrganizationRequest } from "@/lib/auth/authorization";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { getMarginControlRows } from "@/lib/finance/server";

export async function GET(req: Request) {
  try {
    const authorization = await authorizeOrganizationRequest(req, PERMISSIONS.APP_READ);
    if (!authorization.ok) return authorization.response;
    const data = await getMarginControlRows(authorization.context.organizationId);
    return NextResponse.json({ ok: true, data, meta: { source: "postgres" } });
  } catch (error) {
    console.error("[api] GET /api/v1/finance/margins:", error);
    return NextResponse.json({ ok: false, error: { message: "Failed to load margin controls." } }, { status: 500 });
  }
}
