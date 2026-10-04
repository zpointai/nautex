import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { authorizePurchaseOrderRequest } from "@/lib/auth/entity-access";
import { prisma } from "@/lib/prisma";
import { PURCHASE_ORDER_AUDIT_EVENTS, recordPurchaseOrderAuditEvent } from "@/lib/purchase-orders/erp-audit";
import { registerPurchaseOrderDocumentInRegistry } from "@/lib/purchase-orders/erp-documents";
import { executeIdempotentRequest } from "@/lib/api/idempotency";
import { ApiRequestError, assertRequestSize, assertUploadFile } from "@/lib/api/request";
import { sanitizeFileName } from "@/lib/storage/local-object-storage";
import { deleteObject, getObjectStorageProvider } from "@/lib/storage/object-storage";

const MAX_FILE_BYTES = 25 * 1024 * 1024;
const CATEGORIES = new Set([
  "incoming_customer_po",
  "supplier_confirmation",
  "delivery_evidence",
  "supplier_invoice",
  "customer_communication",
  "other",
]);

function fail(code: string, message: string, status = 400) {
  return NextResponse.json({ ok: false, error: { code, message } }, { status });
}

function normalizeCategory(value: FormDataEntryValue | null) {
  const category = String(value || "other");
  return CATEGORIES.has(category) ? category : "other";
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const access = await authorizePurchaseOrderRequest(req, id, PERMISSIONS.APP_READ);
    if (!access.ok) return access.response;
    const order = access.order;
    if (!order) return fail("PO_NOT_FOUND", "Purchase order not found.", 404);

    const documents = await prisma.purchaseOrderDocument.findMany({
      where: { orderId: id },
      orderBy: { createdAt: "desc" },
    });
    return NextResponse.json({ ok: true, data: documents });
  } catch {
    return fail("PO_DOCUMENTS_LIST_FAILED", "Failed to load purchase order documents.", 500);
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const authorization = await authorizePurchaseOrderRequest(req, id, PERMISSIONS.PROCUREMENT_WRITE);
    if (!authorization.ok) return authorization.response;
    const order = authorization.order;
    if (!order) return fail("PO_NOT_FOUND", "Purchase order not found.", 404);

    return await executeIdempotentRequest({
      request: req,
      organizationId: authorization.context.organizationId,
      route: "POST /api/v1/purchase-orders/:id/documents",
      handler: async () => {
    assertRequestSize(req, MAX_FILE_BYTES + 1024 * 1024);
    const form = await req.formData();
    const file = assertUploadFile(form.get("file"), {
      requiredCode: "PO_DOCUMENT_REQUIRED",
      emptyCode: "PO_DOCUMENT_EMPTY",
      tooLargeCode: "PO_DOCUMENT_TOO_LARGE",
      maxBytes: MAX_FILE_BYTES,
    });

    const idForDocument = randomUUID();
    const safeName = sanitizeFileName(file.name || "purchase-order-document");
    const storageKey = `purchase-orders/${order.id}/${idForDocument}-${safeName}`;
    const buffer = Buffer.from(await file.arrayBuffer());
    const storage = getObjectStorageProvider();
    await storage.put(storageKey, buffer);

    const category = normalizeCategory(form.get("category"));
    const description = String(form.get("description") || "").trim() || null;
    const uploadedBy = authorization.context.displayName;

    let document;
    try {
      document = await prisma.$transaction(async (tx) => {
        const created = await tx.purchaseOrderDocument.create({
          data: {
            id: idForDocument,
            orderId: order.id,
            fileName: safeName,
            originalName: file.name || safeName,
            mimeType: file.type || "application/octet-stream",
            sizeBytes: file.size,
            storageProvider: storage.name,
            storageKey,
            category,
            description,
            uploadedBy,
          },
        });
        await tx.purchaseOrderEvent.create({
          data: {
            orderId: order.id,
            type: "document_attached",
            summary: `Document attached: ${safeName}`,
            detail: JSON.stringify({ documentId: created.id, category, sizeBytes: file.size }),
            actor: uploadedBy,
          },
        });
        return created;
      });
    } catch (error) {
      await deleteObject(storage.name, storageKey, { permanent: true }).catch(() => undefined);
      throw error;
    }

    await recordPurchaseOrderAuditEvent({
      order,
      eventType: PURCHASE_ORDER_AUDIT_EVENTS.DOCUMENT_ATTACHED,
      actorName: uploadedBy,
      after: {
        documentId: document.id,
        fileName: document.fileName,
        category,
        sizeBytes: document.sizeBytes,
      },
      metadata: {
        legacyDocumentModel: "PurchaseOrderDocument",
        storageProvider: document.storageProvider,
      },
    });

    await registerPurchaseOrderDocumentInRegistry({
      order,
      document,
      buffer,
    });

    return NextResponse.json({ ok: true, data: document }, { status: 201 });
      },
    });
  } catch (error) {
    if (error instanceof ApiRequestError) return fail(error.code, error.message, error.status);
    return fail("PO_DOCUMENT_UPLOAD_FAILED", "Failed to attach purchase order document.", 500);
  }
}
