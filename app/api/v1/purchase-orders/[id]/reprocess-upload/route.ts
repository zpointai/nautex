import { NextResponse } from "next/server";
import { authorizePurchaseOrderRequest } from "@/lib/auth/entity-access";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { extractUploadedDocument } from "@/lib/documents/extract";
import { logApiError } from "@/lib/api/response";
import { prisma } from "@/lib/prisma";
import { runPurchaseOrderIntakeAgent } from "@/lib/purchase-orders/intake-agent";
import { ApiRequestError } from "@/lib/api/request";
import { assertAgentEnabled } from "@/lib/agents/controls";

const MAX_UPLOAD_BYTES = 12 * 1024 * 1024;
const ALLOWED_EXTENSIONS = new Set(["pdf", "xlsx", "xls", "csv"]);

function extensionFrom(name: string) {
  return name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? "";
}

function clean(value: string | null | undefined) {
  const trimmed = (value ?? "").trim();
  return trimmed.length > 0 ? trimmed : null;
}

function validDate(value: string | null | undefined, fallback: Date) {
  if (!value) return fallback;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? fallback : date;
}

function numeric(value: unknown, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const authorization = await authorizePurchaseOrderRequest(req, id, PERMISSIONS.PROCUREMENT_WRITE);
    if (!authorization.ok) return authorization.response;
    await assertAgentEnabled(authorization.context.organizationId, "nautex_po_intake");
    if (!authorization.order) {
      return NextResponse.json(
        { ok: false, error: { code: "PURCHASE_ORDER_NOT_FOUND", message: "Purchase order not found." } },
        { status: 404 },
      );
    }
    const existing = await prisma.purchaseOrder.findUnique({
      where: { id },
      include: {
        childOrders: { select: { id: true, poNumber: true } },
        lines: { select: { id: true } },
      },
    });

    if (!existing) {
      return NextResponse.json(
        { ok: false, error: { code: "PURCHASE_ORDER_NOT_FOUND", message: "Purchase order not found." } },
        { status: 404 },
      );
    }

    if (existing.confirmStatus === "Confirmed" || existing.childOrders.length > 0) {
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: "PURCHASE_ORDER_REPROCESS_LOCKED",
            message: "This order is already confirmed or has linked supplier purchase orders. Create a controlled revision instead of replacing extracted lines.",
          },
        },
        { status: 409 },
      );
    }

    const formData = await req.formData();
    const file = formData.get("file");

    if (!(file instanceof File)) {
      return NextResponse.json(
        { ok: false, error: { code: "PO_REPROCESS_FILE_REQUIRED", message: "Upload the corrected PDF, Excel, or CSV purchase order file." } },
        { status: 400 },
      );
    }

    const extension = extensionFrom(file.name);
    if (!ALLOWED_EXTENSIONS.has(extension)) {
      return NextResponse.json(
        { ok: false, error: { code: "PO_REPROCESS_UNSUPPORTED_FILE", message: "Supported formats are PDF, XLSX, XLS, and CSV." } },
        { status: 415 },
      );
    }

    if (file.size > MAX_UPLOAD_BYTES) {
      return NextResponse.json(
        { ok: false, error: { code: "PO_REPROCESS_FILE_TOO_LARGE", message: "Purchase order uploads are limited to 12 MB." } },
        { status: 413 },
      );
    }

    const data = Buffer.from(await file.arrayBuffer()).toString("base64");
    const extracted = await extractUploadedDocument({
      name: file.name,
      type: file.type,
      mimeType: file.type,
      data,
    });

    if (!extracted.text.trim()) {
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: "PO_REPROCESS_NO_TEXT",
            message: "The file was read, but no extractable text was found. Scanned PDFs will need OCR before intake.",
            details: extracted.warnings,
          },
        },
        { status: 422 },
      );
    }

    const draft = await runPurchaseOrderIntakeAgent(extracted.text, {
      organizationId: authorization.context.organizationId,
      signal: req.signal,
      fileName: extracted.fileName,
      warnings: extracted.warnings,
    });

    if (draft.lines.length === 0) {
      return NextResponse.json(
        { ok: false, error: { code: "PO_REPROCESS_NO_LINES", message: "No structured line items were detected. Review the file manually before replacing this order." } },
        { status: 422 },
      );
    }

    const currency = draft.currency || existing.currency || "EUR";
    const total = draft.lines.reduce((sum, line) => {
      const lineTotal = numeric(line.lineTotal, numeric(line.qtyOrdered) * numeric(line.unitPrice));
      return sum + lineTotal;
    }, 0);

    const updated = await prisma.$transaction(async (tx) => {
      await tx.purchaseOrderLine.deleteMany({ where: { orderId: id } });
      await tx.purchaseOrder.update({
        where: { id },
        data: {
          poNumber: clean(draft.poNumber) ?? existing.poNumber,
          orderType: draft.orderType ?? existing.orderType,
          vessel: clean(draft.vessel) ?? existing.vessel,
          vesselImo: clean(draft.vesselImo),
          vesselOwner: clean(draft.vesselOwner ?? draft.buyerName) ?? existing.vesselOwner,
          supplier: clean(draft.supplier) ?? existing.supplier,
          buyerName: clean(draft.buyerName) ?? existing.buyerName,
          buyerRef: clean(draft.buyerRef) ?? existing.buyerRef,
          port: clean(draft.port) ?? existing.port,
          eta: validDate(draft.eta, existing.eta),
          requestedDate: draft.requestedDate ? validDate(draft.requestedDate, existing.requestedDate ?? existing.eta) : existing.requestedDate,
          total,
          currency,
          marginPct: numeric(draft.marginPct, existing.marginPct),
          priority: draft.priority ?? existing.priority,
          lines: {
            create: draft.lines.map((line, index) => {
              const qtyOrdered = numeric(line.qtyOrdered);
              const unitPrice = numeric(line.unitPrice);
              const lineTotal = numeric(line.lineTotal, qtyOrdered * unitPrice);
              return {
                lineNumber: line.lineNumber ?? index + 1,
                itemCode: clean(line.itemCode),
                supplierPartNo: clean(line.supplierPartNo),
                description: clean(line.description) ?? "Unspecified line item",
                qtyOrdered,
                qtyConfirmed: null,
                qtyDelivered: 0,
                uom: clean(line.uom) ?? "EA",
                unitPrice,
                lineTotal,
                currency,
                requestedDate: line.requestedDate ? validDate(line.requestedDate, existing.eta) : null,
                status: "Open" as const,
                remarks: clean(line.remarks),
              };
            }),
          },
          events: {
            create: {
              type: "shipserv_sync",
              summary: `Order reprocessed from ${file.name}`,
              detail: JSON.stringify({
                sourceFileName: file.name,
                lineCount: draft.lines.length,
                recalculatedTotal: total,
                confidence: draft.confidence,
                warnings: draft.warnings,
              }),
              actor: "agent",
            },
          },
        },
      });

      return tx.purchaseOrder.findUnique({
        where: { id },
        include: {
          lines: { orderBy: { lineNumber: "asc" } },
          events: { orderBy: { createdAt: "desc" } },
          orderNotes: { orderBy: { createdAt: "desc" } },
          documents: { orderBy: { createdAt: "desc" } },
          supplierRel: { select: { id: true, name: true, supplierCode: true } },
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
    });

    return NextResponse.json({
      ok: true,
      data: updated,
      meta: {
        agent: "nautex_po_intake",
        status: "reprocessed",
        source: "document_extraction",
        warnings: draft.warnings,
      },
    });
  } catch (error) {
    if (error instanceof ApiRequestError) return NextResponse.json({ ok: false, error: { code: error.code, message: error.message } }, { status: error.status });
    logApiError("POST /api/v1/purchase-orders/:id/reprocess-upload", error);
    return NextResponse.json(
      { ok: false, error: { code: "PO_REPROCESS_FAILED", message: "Failed to reprocess purchase order upload." } },
      { status: 500 },
    );
  }
}
