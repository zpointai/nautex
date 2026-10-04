import { NextResponse } from "next/server";
import { getPurchaseOrderNotifications } from "@/lib/purchase-orders/notifications";
import { authorizeOrganizationRequest } from "@/lib/auth/authorization";

export async function GET(req: Request) {
  try {
    const authorization = await authorizeOrganizationRequest(req);
    if (!authorization.ok) return authorization.response;
    const url = new URL(req.url);
    const limit = Math.min(50, Math.max(1, Number.parseInt(url.searchParams.get("limit") || "12", 10) || 12));
    const notifications = await getPurchaseOrderNotifications(authorization.context.organizationId, limit);
    return NextResponse.json({ ok: true, data: notifications, meta: { source: "postgres" } });
  } catch {
    return NextResponse.json(
      { ok: false, error: { code: "PO_NOTIFICATIONS_FAILED", message: "Failed to load purchase order notifications." } },
      { status: 500 },
    );
  }
}
