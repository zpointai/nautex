import { NextResponse } from "next/server";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { authorizePurchaseOrderRequest } from "@/lib/auth/entity-access";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/v1/purchase-orders/:id/events
 *
 * Returns all events for a purchase order, newest first.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const access = await authorizePurchaseOrderRequest(req, id, PERMISSIONS.APP_READ);
    if (!access.ok) return access.response;
    if (!access.order) return NextResponse.json({ ok: false, error: { code: "PURCHASE_ORDER_NOT_FOUND", message: "Purchase order not found." } }, { status: 404 });

    const events = await prisma.purchaseOrderEvent.findMany({
      where: { orderId: id },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json({ ok: true, data: events, meta: { source: "postgres" } });
  } catch {
    return NextResponse.json(
      { ok: false, error: { code: "PO_EVENTS_LIST_FAILED", message: "Failed to fetch events." } },
      { status: 500 }
    );
  }
}

/**
 * POST /api/v1/purchase-orders/:id/events
 *
 * Create a new event for a purchase order.
 * Body: { type, summary, detail? }
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const authorization = await authorizePurchaseOrderRequest(req, id, PERMISSIONS.PROCUREMENT_WRITE);
    if (!authorization.ok) return authorization.response;
    if (!authorization.order) return NextResponse.json({ ok: false, error: { code: "PURCHASE_ORDER_NOT_FOUND", message: "Purchase order not found." } }, { status: 404 });
    const body = await req.json();

    const { type, summary, detail } = body;

    if (!type || !summary) {
      return NextResponse.json(
        { ok: false, error: { code: "PO_EVENT_REQUIRED_FIELDS", message: "type and summary are required." } },
        { status: 400 }
      );
    }

    // Verify the order exists
    const order = await prisma.purchaseOrder.findUnique({
      where: { id },
      select: { id: true },
    });

    if (!order) {
      return NextResponse.json(
        { ok: false, error: { code: "PURCHASE_ORDER_NOT_FOUND", message: "Purchase order not found." } },
        { status: 404 }
      );
    }

    const event = await prisma.purchaseOrderEvent.create({
      data: {
        orderId: id,
        type,
        summary,
        detail: detail || null,
        actor: authorization.context.displayName,
      },
    });

    return NextResponse.json({ ok: true, data: event, meta: { source: "postgres" } }, { status: 201 });
  } catch {
    return NextResponse.json(
      { ok: false, error: { code: "PO_EVENT_CREATE_FAILED", message: "Failed to create event." } },
      { status: 500 }
    );
  }
}
