import { NextResponse } from "next/server";
import { authorizeOrganizationRequest } from "@/lib/auth/authorization";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { prisma } from "@/lib/prisma";
import { PURCHASE_ORDER_AUDIT_EVENTS, recordPurchaseOrderAuditEvent } from "@/lib/purchase-orders/erp-audit";
import { getPurchaseOrderErpCoreReadModel } from "@/lib/purchase-orders/erp-core-read";
import { deletePurchaseOrderWithLinks } from "@/lib/purchase-orders/order-workflow";

/**
 * GET /api/v1/purchase-orders/:id
 *
 * Returns a single purchase order with all lines, events, notes, and supply chain context.
 * Includes parent order, child sub-POs, and linked supplier.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const authorization = await authorizeOrganizationRequest(req, PERMISSIONS.APP_READ);
    if (!authorization.ok) return authorization.response;
    const { id } = await params;

    const po = await prisma.purchaseOrder.findFirst({
      where: { id, organizationId: authorization.context.organizationId },
      include: {
        lines: { orderBy: { lineNumber: "asc" } },
        events: { orderBy: { createdAt: "desc" } },
        orderNotes: { orderBy: { createdAt: "desc" } },
        documents: { orderBy: { createdAt: "desc" } },
        supplierRel: { select: { id: true, name: true, supplierCode: true } },
        assignedTo: { select: { id: true, name: true, email: true } },
        parentOrder: {
          select: {
            id: true, poNumber: true, orderType: true, supplier: true,
            supplierRef: true, buyerName: true, vessel: true, vesselOwner: true,
            status: true, total: true, currency: true,
            _count: { select: { lines: true } },
          },
        },
        childOrders: {
          select: {
            id: true, poNumber: true, orderType: true, supplier: true,
            supplierRef: true, buyerName: true, vessel: true, vesselOwner: true,
            status: true, total: true, currency: true,
            _count: { select: { lines: true } },
          },
          orderBy: { createdAt: "asc" },
        },
        _count: { select: { lines: true, childOrders: true } },
      },
    });

    if (!po) {
      return NextResponse.json({ error: "Purchase order not found" }, { status: 404 });
    }

    const erpCore = await getPurchaseOrderErpCoreReadModel(po.id, {
      supplierId: po.supplierId,
      buyerName: po.buyerName,
      vesselOwner: po.vesselOwner,
    });

    return NextResponse.json({ data: { ...po, erpCore } });
  } catch {
    return NextResponse.json({ error: "Failed to fetch purchase order." }, { status: 500 });
  }
}

/**
 * PATCH /api/v1/purchase-orders/:id
 *
 * Update a purchase order's header fields.
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const authorization = await authorizeOrganizationRequest(req, PERMISSIONS.PROCUREMENT_WRITE);
    if (!authorization.ok) return authorization.response;
    const { id } = await params;
    const body = await req.json();

    // Allow updating both original and new supply chain fields
    const allowed = [
      "vessel", "vesselImo", "vesselOwner",
      "supplier", "supplierRef", "supplierId", "port",
      "eta", "requestedDate", "confirmedDate",
      "total", "currency", "marginPct", "markupPct", "costTotal", "marginOverride",
      "status", "confirmStatus", "priority",
      "buyerName", "buyerRef",
      "shipservRfqId", "shipservPoId", "shipservQuoteId", "shipservLifecycle",
    ];

    const data: Record<string, unknown> = {};
    for (const key of allowed) {
      if (body[key] !== undefined) {
        if (["eta", "requestedDate", "confirmedDate"].includes(key) && body[key]) {
          data[key] = new Date(body[key]);
        } else {
          data[key] = body[key];
        }
      }
    }

    const existing = body.status !== undefined
      ? await prisma.purchaseOrder.findFirst({
          where: { id, organizationId: authorization.context.organizationId },
          select: { id: true, poNumber: true, status: true },
        })
      : null;

    const target = existing ?? await prisma.purchaseOrder.findFirst({ where: { id, organizationId: authorization.context.organizationId }, select: { id: true } });
    if (!target) return NextResponse.json({ error: "Purchase order not found" }, { status: 404 });

    if (body.supplierId != null && (typeof body.supplierId !== "string" || !await prisma.supplier.findFirst({ where: { id: body.supplierId, organizationId: authorization.context.organizationId }, select: { id: true } }))) {
      return NextResponse.json({ error: "Supplier is not available in the active organization." }, { status: 404 });
    }

    const po = await prisma.purchaseOrder.update({
      where: { id: target.id },
      data,
      include: {
        lines: { orderBy: { lineNumber: "asc" } },
        supplierRel: { select: { id: true, name: true, supplierCode: true } },
        _count: { select: { lines: true, childOrders: true } },
      },
    });

    if (existing && existing.status !== po.status) {
      await recordPurchaseOrderAuditEvent({
        order: po,
        eventType: PURCHASE_ORDER_AUDIT_EVENTS.STATUS_CHANGED,
        actorName: authorization.context.displayName,
        before: { status: existing.status },
        after: { status: po.status },
        metadata: { updatedFields: Object.keys(data) },
      });
    }

    return NextResponse.json({ data: po });
  } catch {
    return NextResponse.json({ error: "Failed to update purchase order." }, { status: 500 });
  }
}

/**
 * DELETE /api/v1/purchase-orders/:id
 *
 * Delete an unposted purchase order and any descendant fulfillment orders.
 * Orders with finance/accounting links are intentionally blocked.
 */
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const authorization = await authorizeOrganizationRequest(req, PERMISSIONS.PROCUREMENT_WRITE);
    if (!authorization.ok) return authorization.response;
    const { id } = await params;
    const existing = await prisma.purchaseOrder.findFirst({
      where: { id, organizationId: authorization.context.organizationId },
      select: { id: true, poNumber: true, status: true, confirmStatus: true },
    });

    if (!existing) {
      return NextResponse.json(
        { ok: false, error: { code: "PURCHASE_ORDER_NOT_FOUND", message: "Purchase order not found." } },
        { status: 404 },
      );
    }

    const result = await deletePurchaseOrderWithLinks(id, authorization.context.organizationId);

    return NextResponse.json({
      ok: true,
      data: { id, poNumber: existing.poNumber, ...result },
      meta: { source: "postgres" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to delete purchase order.";
    return NextResponse.json(
      { ok: false, error: { code: "PURCHASE_ORDER_DELETE_FAILED", message } },
      { status: 409 },
    );
  }
}
