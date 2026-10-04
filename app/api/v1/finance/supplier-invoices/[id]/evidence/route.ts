import { randomUUID } from "node:crypto";
import { authorizeOrganizationRequest } from "@/lib/auth/authorization";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { ApiRequestError, assertUploadFile } from "@/lib/api/request";
import { fail, ok } from "@/lib/api/response";
import { prisma } from "@/lib/prisma";
import { financeWriter, productionAudit } from "@/lib/finance/production";
import { getObjectStorageProvider, getObject } from "@/lib/storage/object-storage";
import { sanitizeFileName } from "@/lib/storage/local-object-storage";
import { checksumSha256 } from "@/lib/erp-core/documents";
const MAX = 10 * 1024 * 1024;
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authorizeOrganizationRequest(request, PERMISSIONS.FINANCE_WRITE); if (!auth.ok) return auth.response;
  try {
    const organizationId = financeWriter(auth.context), { id } = await params;
    const invoice = await prisma.supplierInvoice.findFirst({ where: { id, organizationId } });
    if (!invoice) return fail("INVOICE_NOT_FOUND", "Supplier invoice not found.", 404);
    if (invoice.approvalStatus === "Approved") return fail("INVOICE_LOCKED", "Approved invoice evidence is locked.", 409);
    const reader = request.body?.getReader(); if (!reader) return fail("FILE_REQUIRED", "Choose an invoice document.", 400);
    const chunks: Uint8Array[] = []; let size = 0;
    try { while (true) { const chunk = await reader.read(); if (chunk.done) break; size += chunk.value.byteLength; if (size > MAX + 65536) throw new ApiRequestError("FILE_TOO_LARGE", "Invoice evidence may be up to 10 MB.", 413); chunks.push(chunk.value); } }
    finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
    const form = await new Response(Buffer.concat(chunks), { headers: { "content-type": request.headers.get("content-type") ?? "" } }).formData();
    const file = assertUploadFile(form.get("file"), { requiredCode: "FILE_REQUIRED", emptyCode: "FILE_EMPTY", tooLargeCode: "FILE_TOO_LARGE", maxBytes: MAX, allowedExtensions: new Set(["pdf", "png", "jpg", "jpeg", "txt", "csv", "xlsx", "docx"]) });
    const buffer = Buffer.from(await file.arrayBuffer()), checksum = checksumSha256(buffer), safeName = sanitizeFileName(file.name), documentId = randomUUID(), storageKey = `finance/${organizationId}/${id}/${documentId}-${safeName}`;
    const storage = getObjectStorageProvider(); await storage.put(storageKey, buffer);
    const document = await prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`finance-supplier:${id}`}))`;
      const current = await tx.supplierInvoice.findFirst({ where: { id, organizationId } });
      if (!current || current.approvalStatus === "Approved") throw new ApiRequestError("INVOICE_LOCKED", "Invoice changed or was approved during upload. Refresh before attaching evidence.", 409);
      const saved = await tx.erpDocument.create({ data: { id: documentId, organizationId, documentType: "supplier_invoice", title: invoice.supplierInvoiceNo, originalFileName: safeName, fileName: safeName, mimeType: file.type || "application/octet-stream", sizeBytes: file.size, checksumSha256: checksum, storageProvider: storage.name, storageKey, sourceModule: "finance" } });
      await tx.documentLink.create({ data: { documentId, entityType: "SupplierInvoice", entityId: id, entityNumber: invoice.supplierInvoiceNo, linkRole: "source", sourceModule: "finance" } });
      await tx.supplierInvoice.update({ where: { id }, data: { sourceDocumentId: documentId } });
      await productionAudit(tx, { ...auth.context, organizationId }, "SupplierEvidenceAttached", "SupplierInvoice", id, { documentId, checksum, fileName: safeName });
      return saved;
    });
    return ok({ documentId: document.id });
  } catch (error) { return fail("EVIDENCE_UPLOAD_FAILED", error instanceof ApiRequestError ? error.message : "Evidence upload failed. The saved invoice remains available; retry attachment from Payables.", error instanceof ApiRequestError ? error.status : 500); }
}
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authorizeOrganizationRequest(request, PERMISSIONS.APP_READ); if (!auth.ok) return auth.response;
  try {
    const { id } = await params;
    const invoice = await prisma.supplierInvoice.findFirst({ where: { id, organizationId: auth.context.organizationId } });
    const document = invoice?.sourceDocumentId ? await prisma.erpDocument.findFirst({ where: { id: invoice.sourceDocumentId, organizationId: auth.context.organizationId } }) : null;
    if (!document?.storageKey) return fail("EVIDENCE_NOT_FOUND", "Invoice evidence not found.", 404);
    const buffer = await getObject(document.storageProvider, document.storageKey);
    return new Response(new Uint8Array(buffer), { headers: { "Content-Type": "application/octet-stream", "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(document.fileName ?? "invoice")}`, "X-Content-Type-Options": "nosniff", "Cache-Control": "no-store" } });
  } catch { return fail("EVIDENCE_UNAVAILABLE", "Invoice evidence could not be opened.", 500); }
}
