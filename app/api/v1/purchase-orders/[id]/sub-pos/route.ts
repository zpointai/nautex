import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authorizePurchaseOrderRequest } from "@/lib/auth/entity-access";
import { PERMISSIONS } from "@/lib/auth/permissions";

/**
 * GET /api/v1/purchase-orders/:id/sub-pos
 *
 * List all supplier fulfillment POs for a given customer/parent PO.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;

    const authorization = await authorizePurchaseOrderRequest(req, id, PERMISSIONS.APP_READ);
    if (!authorization.ok) return authorization.response;
    const parent = authorization.order;
    if (!parent) {
      return NextResponse.json({ error: "Parent order not found" }, { status: 404 });
    }

    const subPos = await prisma.purchaseOrder.findMany({
      where: { organizationId: authorization.context.organizationId, parentOrderId: id },
      include: {
        _count: { select: { lines: true } },
        supplierRel: { select: { id: true, name: true, supplierCode: true } },
      },
      orderBy: { createdAt: "asc" },
    });

    return NextResponse.json({ data: subPos, parentPoNumber: parent.poNumber });
  } catch {
    return NextResponse.json({ error: "Failed to list sub-POs" }, { status: 500 });
  }
}

/**
 * POST /api/v1/purchase-orders/:id/sub-pos
 *
 * Create a supplier fulfillment PO from selected lines of the parent customer PO.
 *
 * Body:
 * {
 *   supplierId?: string,         // FK to Supplier table (optional)
 *   supplierName: string,        // display name (required)
 *   lines: [{
 *     parentLineId: string,      // the buyer PO line to source from
 *     allocatedQty: number,      // how many units to forward
 *     supplierUnitPrice: number, // price from sub-supplier
 *   }],
 *   markupPct?: number,          // optional markup applied
 *   port?: string,
 *   eta?: string,
 *   currency?: string,
 * }
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const authorization = await authorizePurchaseOrderRequest(req, id, PERMISSIONS.PROCUREMENT_WRITE);
    if (!authorization.ok) return authorization.response;
    if (!authorization.order) return NextResponse.json({ error: "Parent order not found" }, { status: 404 });
    const body = await req.json();
    const { supplierId, supplierName, lines, markupPct, port, eta, currency } = body;

    if (!supplierName || !Array.isArray(lines) || lines.length === 0) {
      return NextResponse.json(
        { error: "Required: supplierName and at least one line" },
        { status: 400 },
      );
    }

    // Load parent order
    const parent = await prisma.purchaseOrder.findFirst({
      where: { id, organizationId: authorization.context.organizationId },
      include: { lines: { orderBy: { lineNumber: "asc" } } },
    });
    if (!parent) {
      return NextResponse.json({ error: "Parent order not found" }, { status: 404 });
    }

    if (supplierId && !await prisma.supplier.findFirst({ where: { id: supplierId, organizationId: authorization.context.organizationId }, select: { id: true } })) {
      return NextResponse.json({ error: "Supplier not found in the active organization" }, { status: 404 });
    }

    // Validate parent lines exist
    const parentLineMap = new Map(parent.lines.map((l) => [l.id, l]));
    for (const l of lines) {
      if (!parentLineMap.has(l.parentLineId)) {
        return NextResponse.json(
          { error: `Parent line ${l.parentLineId} not found` },
          { status: 400 },
        );
      }
    }

    const latestSupplierPo = await prisma.purchaseOrder.findFirst({
      where: { organizationId: authorization.context.organizationId, poNumber: { startsWith: "PO-" } },
      orderBy: { poNumber: "desc" },
      select: { poNumber: true },
    });
    const latestNumber = latestSupplierPo ? Number.parseInt(latestSupplierPo.poNumber.replace("PO-", ""), 10) : 4556;
    const supplierPoNumber = `PO-${String((Number.isFinite(latestNumber) ? latestNumber : 4556) + 1).padStart(5, "0")}`;

    // Calculate total for the supplier fulfillment PO.
    const subTotal = lines.reduce(
      (sum: number, l: { allocatedQty: number; supplierUnitPrice: number }) =>
        sum + l.allocatedQty * l.supplierUnitPrice,
      0,
    );

    // Create supplier fulfillment PO with lines in a transaction.
    const subPo = await prisma.$transaction(async (tx) => {
      const created = await tx.purchaseOrder.create({
        data: {
          organizationId: authorization.context.organizationId,
          poNumber: supplierPoNumber,
          orderType: "SubPO",
          vessel: parent.vessel,
          vesselImo: parent.vesselImo,
          vesselOwner: parent.vesselOwner,
          supplier: supplierName,
          supplierRef: parent.supplierRef,
          buyerName: parent.buyerName,
          buyerRef: parent.poNumber,
          supplierId: supplierId || null,
          parentOrderId: id,
          port: port || parent.port,
          eta: eta ? new Date(eta) : parent.eta,
          total: subTotal,
          currency: currency || parent.currency,
          marginPct: 0,
          markupPct: markupPct != null ? Number(markupPct) : null,
          status: "Procurement",
          confirmStatus: "Unconfirmed",
          priority: parent.priority,
          lines: {
            create: lines.map(
              (
                l: { parentLineId: string; allocatedQty: number; supplierUnitPrice: number },
                i: number,
              ) => {
                const parentLine = parentLineMap.get(l.parentLineId)!;
                return {
                  lineNumber: i + 1,
                  itemCode: parentLine.itemCode,
                  description: parentLine.description,
                  supplierPartNo: parentLine.supplierPartNo,
                  qtyOrdered: l.allocatedQty,
                  uom: parentLine.uom,
                  unitPrice: l.supplierUnitPrice,
                  lineTotal: l.allocatedQty * l.supplierUnitPrice,
                  currency: currency || parent.currency,
                  parentLineId: l.parentLineId,
                  buyerUnitPrice: parentLine.unitPrice,
                  status: "Open",
                };
              },
            ),
          },
          events: {
            create: {
              type: "created",
              summary: `Supplier PO ${supplierPoNumber} created from ${parent.poNumber} for ${supplierName}`,
              detail: JSON.stringify({ parentPoId: id, parentPoNumber: parent.poNumber, salesOrderNo: parent.supplierRef }),
              actor: authorization.context.displayName,
            },
          },
        },
        include: {
          lines: { orderBy: { lineNumber: "asc" } },
          _count: { select: { lines: true } },
        },
      });

      // Create allocation records
      const createdLines = created.lines;
      for (let i = 0; i < lines.length; i++) {
        const l = lines[i];
        const subPoLine = createdLines[i];
        await tx.orderLineAllocation.create({
          data: {
            buyerLineId: l.parentLineId,
            subPoLineId: subPoLine.id,
            allocatedQty: l.allocatedQty,
            buyerUnitPrice: parentLineMap.get(l.parentLineId)!.unitPrice,
            supplierUnitPrice: l.supplierUnitPrice,
          },
        });

        // Mark the parent line as forwarded (set forwardedToOrderId)
        await tx.purchaseOrderLine.update({
          where: { id: l.parentLineId },
          data: { forwardedToOrderId: created.id },
        });
      }

      // Record event on parent
      await tx.purchaseOrderEvent.create({
        data: {
          orderId: id,
          type: "sub_po_created",
          summary: `Supplier PO ${supplierPoNumber} created for ${supplierName} (${lines.length} line${lines.length !== 1 ? "s" : ""})`,
          detail: JSON.stringify({
            subPoId: created.id,
            subPoNumber: supplierPoNumber,
            salesOrderNo: parent.supplierRef,
            supplier: supplierName,
            lineCount: lines.length,
            total: subTotal,
          }),
          actor: authorization.context.displayName,
        },
      });

      return created;
    });

    return NextResponse.json({ data: subPo }, { status: 201 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to create supplier fulfillment PO";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
