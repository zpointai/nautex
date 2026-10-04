import { NextResponse } from "next/server";
import { authorizeOrganizationRequest } from "@/lib/auth/authorization";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { confirmBuyerPurchaseOrder } from "@/lib/purchase-orders/order-workflow";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const authorization = await authorizeOrganizationRequest(req, PERMISSIONS.PROCUREMENT_APPROVE);
    if (!authorization.ok) return authorization.response;
    const { id } = await params;
    const result = await confirmBuyerPurchaseOrder(id, authorization.context.organizationId);
    return NextResponse.json({
      ok: true,
      data: result,
      meta: { source: "postgres", humanApproved: true },
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: { code: "PO_CONFIRM_FAILED", message: error instanceof Error ? error.message : "Failed to confirm purchase order." } },
      { status: 500 },
    );
  }
}
