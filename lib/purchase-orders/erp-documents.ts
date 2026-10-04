import {
  checksumSha256,
  linkErpDocument,
  registerErpDocument,
} from "@/lib/erp-core/documents";

interface PurchaseOrderDocumentRegistryInput {
  order: { id: string; poNumber: string };
  document: {
    id: string;
    fileName: string;
    originalName: string | null;
    mimeType: string;
    sizeBytes: number;
    storageProvider: string;
    storageKey: string;
    category: string;
    description: string | null;
    uploadedBy: string;
  };
  buffer: Buffer;
}

export async function registerPurchaseOrderDocumentInRegistry(input: PurchaseOrderDocumentRegistryInput) {
  try {
    const document = await registerErpDocument({
      documentNo: `PO-DOC-${input.document.id}`,
      documentType: "PurchaseOrderAttachment",
      title: input.document.description ?? input.document.originalName ?? input.document.fileName,
      originalFileName: input.document.originalName,
      fileName: input.document.fileName,
      mimeType: input.document.mimeType,
      sizeBytes: input.document.sizeBytes,
      checksumSha256: checksumSha256(input.buffer),
      storageProvider: input.document.storageProvider,
      storageKey: input.document.storageKey,
      sourceModule: "purchase_orders",
      metadata: {
        legacyModel: "PurchaseOrderDocument",
        legacyDocumentId: input.document.id,
        category: input.document.category,
        uploadedBy: input.document.uploadedBy,
      },
    });

    await linkErpDocument({
      documentId: document.id,
      entityType: "PurchaseOrder",
      entityId: input.order.id,
      entityNumber: input.order.poNumber,
      linkRole: "attachment",
      sourceModule: "purchase_orders",
      metadata: {
        legacyModel: "PurchaseOrderDocument",
        legacyDocumentId: input.document.id,
        category: input.document.category,
      },
    });

    return document;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[erp-documents] PurchaseOrder ${input.order.poNumber}: ${message}`);
    return null;
  }
}
