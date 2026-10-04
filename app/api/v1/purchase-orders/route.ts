import { lockReviewedRfq } from "@/lib/rfq/review-lock";
import { ApiRequestError } from "@/lib/api/request";
import { fail } from "@/lib/api/response";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { logApiError } from "@/lib/api/response";
import { authorizeOrganizationRequest } from "@/lib/auth/authorization";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { PURCHASE_ORDER_AUDIT_EVENTS, recordPurchaseOrderAuditEvent } from "@/lib/purchase-orders/erp-audit";
import { normalizePurchaseOrderProvenanceSignals, recordPurchaseOrderProvenance } from "@/lib/purchase-orders/erp-provenance";
import type { LineStatus, OrderType } from "@prisma/client";
import { assignmentFilter } from "@/lib/auth/work-assignment";

/**
 * GET /api/v1/purchase-orders
 *
 * Returns purchase orders with optional search, filtering, and pagination.
 * Includes line count and child order count per order.
 *
 * Query params:
 *   search      — fuzzy search across PO number, vessel, supplier, port, buyer
 *   status      — comma-separated OrderStatus values
 *   priority    — Priority enum value
 *   orderType   — OrderType enum value (BuyerPO | SubPO | DirectPO)
 *   parentOrderId — filter sub-POs belonging to a specific parent
 *   supplierId  — filter by linked supplier
 *   sort        — field to sort by (default: createdAt)
 *   order       — asc | desc (default: desc)
 *   limit       — max results (default: 100, max: 200)
 *   include     — "lines" to include full line data
 */
export async function GET(req: Request) {
  try {
    const authorization = await authorizeOrganizationRequest(req, PERMISSIONS.APP_READ);
    if (!authorization.ok) return authorization.response;
    const url = new URL(req.url);
    const search = url.searchParams.get("search");
    const statusParam = url.searchParams.get("status");
    const priority = url.searchParams.get("priority");
    const orderTypeParam = url.searchParams.get("orderType");
    const parentOrderId = url.searchParams.get("parentOrderId");
    const supplierId = url.searchParams.get("supplierId");
    const sort = url.searchParams.get("sort") || "createdAt";
    const order = url.searchParams.get("order") || "desc";
    const limit = Math.min(parseInt(url.searchParams.get("limit") || "100"), 200);
    const includeLines = url.searchParams.get("include") === "lines";
    const assignedToId = assignmentFilter(url.searchParams.get("assignedTo"), authorization.context.userId);

    const where: Record<string, unknown> = { organizationId: authorization.context.organizationId };
    if (assignedToId !== undefined) where.assignedToId = assignedToId;

    if (search) {
      where.OR = [
        { poNumber: { contains: search, mode: "insensitive" } },
        { vessel: { contains: search, mode: "insensitive" } },
        { supplier: { contains: search, mode: "insensitive" } },
        { port: { contains: search, mode: "insensitive" } },
        { vesselImo: { contains: search, mode: "insensitive" } },
        { vesselOwner: { contains: search, mode: "insensitive" } },
        { buyerName: { contains: search, mode: "insensitive" } },
        { buyerRef: { contains: search, mode: "insensitive" } },
      ];
    }

    if (statusParam) {
      const statuses = statusParam.split(",");
      where.status = statuses.length === 1 ? statuses[0] : { in: statuses };
    }

    if (priority) {
      where.priority = priority;
    }

    if (orderTypeParam) {
      where.orderType = orderTypeParam;
    }

    if (parentOrderId) {
      where.parentOrderId = parentOrderId;
    }

    if (supplierId) {
      where.supplierId = supplierId;
    }

    const validSorts = ["eta", "total", "createdAt", "poNumber", "status", "priority"];
    const sortField = validSorts.includes(sort) ? sort : "createdAt";

    const [data, total, statusCounts] = await Promise.all([
      prisma.purchaseOrder.findMany({
        where,
        include: {
          lines: includeLines
            ? { orderBy: { lineNumber: "asc" } }
            : false,
          _count: { select: { lines: true, childOrders: true } },
          supplierRel: { select: { id: true, name: true, supplierCode: true } },
          assignedTo: { select: { id: true, name: true, email: true } },
          parentOrder: { select: { id: true, poNumber: true, orderType: true, supplier: true, supplierRef: true, buyerName: true, vessel: true, vesselOwner: true, status: true, total: true, currency: true } },
        },
        orderBy: { [sortField]: order === "asc" ? "asc" : "desc" },
        take: limit,
      }),
      prisma.purchaseOrder.count({ where }),
      prisma.purchaseOrder.groupBy({
        by: ["status"],
        where: { organizationId: authorization.context.organizationId },
        _count: { status: true },
      }),
    ]);

    const counts = Object.fromEntries(
      statusCounts.map((g) => [g.status, g._count.status])
    );

    return NextResponse.json({ ok: true, data, total, counts, meta: { source: "postgres", demoReady: data.length > 0 } });
  } catch (error) {
    if(error instanceof ApiRequestError)return fail(error.code,error.message,error.status);
    logApiError("GET /api/v1/purchase-orders", error);
    return NextResponse.json(
      { ok: false, error: { code: "PURCHASE_ORDER_LIST_FAILED", message: "Failed to fetch purchase orders." } },
      { status: 500 },
    );
  }
}

/**
 * POST /api/v1/purchase-orders
 *
 * Create a new purchase order with optional lines.
 * Supports all order types: DirectPO (default), BuyerPO, SubPO.
 */
export async function POST(req: Request) {
  try {
    const authorization = await authorizeOrganizationRequest(req, PERMISSIONS.PROCUREMENT_WRITE);
    if (!authorization.ok) return authorization.response;

    const body = await req.json();
    const {
      poNumber, orderType,
      vessel, vesselImo, vesselOwner,
      supplier, supplierRef, supplierId,
      buyerName, buyerRef, parentOrderId,
      shipservRfqId, shipservPoId, shipservQuoteId, shipservLifecycle,
      rfqId, port,
      eta, requestedDate, confirmedDate,
      total, currency, marginPct, markupPct,
      priority, confirmStatus, notes, lines,
      provenance,
    } = body;
    const provenanceSignals = normalizePurchaseOrderProvenanceSignals(provenance);

    if (!vessel || !supplier || !eta || total == null) {
      return NextResponse.json(
        { ok: false, error: { code: "PURCHASE_ORDER_REQUIRED_FIELDS", message: "Required fields: vessel, supplier, eta, total" } },
        { status: 400 }
      );
    }

    // Auto-generate PO number if not provided
    let finalPoNumber = poNumber;
    if (!finalPoNumber) {
      const latest = await prisma.purchaseOrder.findFirst({
        where: { organizationId: authorization.context.organizationId, poNumber: { startsWith: "PO-" } },
        orderBy: { poNumber: "desc" },
        select: { poNumber: true },
      });
      const nextNum = latest
        ? parseInt(latest.poNumber.replace("PO-", "")) + 1
        : 1;
      finalPoNumber = `PO-${String(nextNum).padStart(5, "0")}`;
    }

    // Validate parent if SubPO
    if (orderType === "SubPO" && parentOrderId) {
      const parent = await prisma.purchaseOrder.findFirst({
        where: { id: parentOrderId, organizationId: authorization.context.organizationId },
        select: { id: true, poNumber: true },
      });
      if (!parent) {
        return NextResponse.json(
          { ok: false, error: { code: "PARENT_ORDER_NOT_FOUND", message: "Parent order not found." } },
          { status: 404 },
        );
      }
    }

    const [linkedSupplier, linkedRfq] = await Promise.all([
      supplierId ? prisma.supplier.findFirst({ where: { id: supplierId, organizationId: authorization.context.organizationId }, select: { id: true } }) : Promise.resolve(null),
      rfqId ? prisma.rfq.findFirst({ where: { id: rfqId, organizationId: authorization.context.organizationId }, select: { id: true } }) : Promise.resolve(null),
    ]);
    if (supplierId && !linkedSupplier) {
      return NextResponse.json({ ok: false, error: { code: "SUPPLIER_NOT_FOUND", message: "Supplier is not available in the active organization." } }, { status: 404 });
    }
    if (rfqId && !linkedRfq) {
      return NextResponse.json({ ok: false, error: { code: "RFQ_NOT_FOUND", message: "RFQ is not available in the active organization." } }, { status: 404 });
    }

    const po = await prisma.$transaction(async(tx)=>{
    if(rfqId)await lockReviewedRfq(tx,rfqId,authorization.context.organizationId);
    return tx.purchaseOrder.create({
      data: {
        organizationId: authorization.context.organizationId,
        poNumber: finalPoNumber,
        orderType: (orderType as OrderType) || "DirectPO",
        vessel,
        vesselImo: vesselImo || null,
        vesselOwner: vesselOwner || null,
        supplier,
        supplierRef: supplierRef || null,
        supplierId: supplierId || null,
        buyerName: buyerName || null,
        buyerRef: buyerRef || null,
        parentOrderId: parentOrderId || null,
        shipservRfqId: shipservRfqId || null,
        shipservPoId: shipservPoId || null,
        shipservQuoteId: shipservQuoteId || null,
        shipservLifecycle: shipservLifecycle || null,
        rfqId: rfqId || null,
        port: port || null,
        eta: new Date(eta),
        requestedDate: requestedDate ? new Date(requestedDate) : null,
        confirmedDate: confirmedDate ? new Date(confirmedDate) : null,
        total: Number(total),
        currency: currency || "EUR",
        marginPct: Number(marginPct) || 0,
        markupPct: markupPct != null ? Number(markupPct) : null,
        priority: priority || "Normal",
        confirmStatus: confirmStatus || "Unconfirmed",
        legacyNotes: notes || null,
        ...(Array.isArray(lines) && lines.length > 0
          ? {
              lines: {
                create: lines.map((l: Record<string, unknown>, i: number) => ({
                  lineNumber: (l.lineNumber as number) || i + 1,
                  itemCode: (l.itemCode as string) || null,
                  description: l.description as string,
                  supplierPartNo: (l.supplierPartNo as string) || null,
                  qtyOrdered: Number(l.qtyOrdered),
                  qtyConfirmed: l.qtyConfirmed != null ? Number(l.qtyConfirmed) : null,
                  qtyDelivered: Number(l.qtyDelivered) || 0,
                  uom: (l.uom as string) || "EA",
                  unitPrice: Number(l.unitPrice),
                  lineTotal: Number(l.lineTotal) || Number(l.qtyOrdered) * Number(l.unitPrice),
                  currency: (l.currency as string) || currency || "EUR",
                  parentLineId: (l.parentLineId as string) || null,
                  buyerUnitPrice: l.buyerUnitPrice != null ? Number(l.buyerUnitPrice) : null,
                  requestedDate: l.requestedDate ? new Date(l.requestedDate as string) : null,
                  confirmedDate: l.confirmedDate ? new Date(l.confirmedDate as string) : null,
                  status: ((l.status as string) || "Open") as LineStatus,
                  remarks: (l.remarks as string) || null,
                })),
              },
            }
          : {}),
        // Record creation event
        events: {
          create: {
            type: "created",
            summary: `Purchase order ${finalPoNumber} created (${(orderType as string) || "DirectPO"})`,
            actor: authorization.context.displayName,
          },
        },
      },
      include: {
        lines: { orderBy: { lineNumber: "asc" } },
        _count: { select: { lines: true, childOrders: true } },
        supplierRel: { select: { id: true, name: true, supplierCode: true } },
      },
    });
    });

    // If this is a supplier fulfillment PO, record an event on the parent customer order.
    if (orderType === "SubPO" && parentOrderId) {
      await prisma.purchaseOrderEvent.create({
        data: {
          orderId: parentOrderId,
          type: "sub_po_created",
          summary: `Supplier PO ${finalPoNumber} created for ${supplier}`,
          detail: JSON.stringify({ subPoId: po.id, subPoNumber: finalPoNumber, supplier }),
          actor: authorization.context.displayName,
        },
      });
    }

    await recordPurchaseOrderAuditEvent({
      order: po,
      eventType: PURCHASE_ORDER_AUDIT_EVENTS.CREATED,
      actorName: authorization.context.displayName,
      after: po,
      metadata: {
        orderType: po.orderType,
        supplier: po.supplier,
        vessel: po.vessel,
        lineCount: po.lines.length,
      },
    });

    await recordPurchaseOrderProvenance({
      order: po,
      lineCount: po.lines.length,
      ...provenanceSignals,
    });

    return NextResponse.json({ ok: true, data: po, meta: { source: "postgres" } }, { status: 201 });
  } catch (err) {
    if (err instanceof ApiRequestError) return fail(err.code, err.message, err.status);
    const msg = err instanceof Error ? err.message : "Failed to create purchase order.";
    return NextResponse.json(
      { ok: false, error: { code: "PURCHASE_ORDER_CREATE_FAILED", message: msg } },
      { status: 500 },
    );
  }
}
