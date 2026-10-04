import { NextResponse } from "next/server";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { authorizePurchaseOrderRequest } from "@/lib/auth/entity-access";
import { prisma } from "@/lib/prisma";
import { logApiError } from "@/lib/api/response";
import { deleteObject, getObject } from "@/lib/storage/object-storage";

function fail(code: string, message: string, status = 400) {
  return NextResponse.json({ ok: false, error: { code, message } }, { status });
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string; documentId: string }> }) {
  try {
    const { id, documentId } = await params;
    const access = await authorizePurchaseOrderRequest(req, id, PERMISSIONS.APP_READ);
    if (!access.ok) return access.response;
    if (!access.order) return fail("PO_NOT_FOUND", "Purchase order not found.", 404);
    const document = await prisma.purchaseOrderDocument.findFirst({ where: { id: documentId, orderId: id } });
    if (!document) return fail("PO_DOCUMENT_NOT_FOUND", "Purchase order document not found.", 404);
    const data = await getObject(document.storageProvider, document.storageKey);
    return new NextResponse(new Uint8Array(data), {
      headers: {
        "Content-Type": document.mimeType || "application/octet-stream",
        "Content-Disposition": `attachment; filename="${document.fileName.replace(/"/g, "")}"`,
        "Content-Length": String(document.sizeBytes),
      },
    });
  } catch {
    return fail("PO_DOCUMENT_DOWNLOAD_FAILED", "Failed to download purchase order document.", 500);
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string; documentId: string }> }) {
  try {
    const { id, documentId } = await params;
    const authorization = await authorizePurchaseOrderRequest(req, id, PERMISSIONS.PROCUREMENT_WRITE);
    if (!authorization.ok) return authorization.response;
    if (!authorization.order) return fail("PO_NOT_FOUND", "Purchase order not found.", 404);
    const document = await prisma.purchaseOrderDocument.findFirst({ where: { id: documentId, orderId: id } });
    if (!document) return fail("PO_DOCUMENT_NOT_FOUND", "Purchase order document not found.", 404);

    await prisma.$transaction(async (tx) => {
      await tx.purchaseOrderDocument.delete({ where: { id: document.id } });
      await tx.purchaseOrderEvent.create({
        data: {
          orderId: id,
          type: "document_deleted",
          summary: `Document removed: ${document.fileName}`,
          detail: JSON.stringify({ documentId: document.id, category: document.category, storageDisposition: "retained_cleanup_pending" }),
          actor: authorization.context.displayName,
        },
      });
    });

    const deletion = await deleteObject(document.storageProvider, document.storageKey).catch((error) => {
      logApiError("DELETE PO document storage cleanup", error);
      return { disposition: "cleanup_failed" as const };
    });

    return NextResponse.json({ ok: true, data: { id: document.id }, meta: { storageDisposition: deletion.disposition } });
  } catch {
    return fail("PO_DOCUMENT_DELETE_FAILED", "Failed to delete purchase order document.", 500);
  }
}
