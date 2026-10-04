import { NextResponse } from "next/server";
import { authorizePurchaseOrderRequest } from "@/lib/auth/entity-access";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { prisma } from "@/lib/prisma";
import { createPurchaseOrderPdf } from "@/lib/purchase-orders/pdf";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const authorization = await authorizePurchaseOrderRequest(req, id, PERMISSIONS.APP_READ);
    if (!authorization.ok) return authorization.response;
    if (!authorization.order) {
      return NextResponse.json({ ok: false, error: { code: "PO_NOT_FOUND", message: "Purchase order not found." } }, { status: 404 });
    }
    const order = await prisma.purchaseOrder.findUnique({
      where: { id },
      include: { lines: { orderBy: { lineNumber: "asc" } } },
    });
    if (!order) {
      return NextResponse.json({ ok: false, error: { code: "PO_NOT_FOUND", message: "Purchase order not found." } }, { status: 404 });
    }

    const pdf = createPurchaseOrderPdf(order);
    return new NextResponse(pdf, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${order.poNumber}.pdf"`,
      },
    });
  } catch {
    return NextResponse.json(
      { ok: false, error: { code: "PO_DOCUMENT_FAILED", message: "Failed to generate purchase order PDF." } },
      { status: 500 },
    );
  }
}
