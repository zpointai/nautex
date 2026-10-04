import { createHash } from "node:crypto";
import { DocumentStatus, Prisma, type ErpDocument } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export interface RegisterErpDocumentInput {
  organizationId?: string | null;
  documentNo?: string | null;
  documentType: string;
  title?: string | null;
  originalFileName?: string | null;
  fileName?: string | null;
  mimeType?: string | null;
  sizeBytes?: number | null;
  checksumSha256?: string | null;
  storageProvider?: string;
  storageKey?: string | null;
  sourceModule: string;
  metadata?: Prisma.InputJsonObject;
}

export interface LinkErpDocumentInput {
  documentId: string;
  entityType: string;
  entityId: string;
  entityNumber?: string | null;
  linkRole?: string;
  sourceModule: string;
  metadata?: Prisma.InputJsonObject;
}

export function checksumSha256(data: Buffer | Uint8Array | string) {
  return createHash("sha256").update(data).digest("hex");
}

export async function registerErpDocument(input: RegisterErpDocumentInput): Promise<ErpDocument> {
  if (!input.documentType.trim()) throw new Error("Document type is required.");
  if (!input.sourceModule.trim()) throw new Error("Document source module is required.");

  return prisma.erpDocument.create({
    data: {
      organizationId: input.organizationId ?? null,
      documentNo: input.documentNo ?? null,
      documentType: input.documentType,
      title: input.title ?? null,
      originalFileName: input.originalFileName ?? null,
      fileName: input.fileName ?? null,
      mimeType: input.mimeType ?? null,
      sizeBytes: input.sizeBytes ?? null,
      checksumSha256: input.checksumSha256 ?? null,
      storageProvider: input.storageProvider ?? "local",
      storageKey: input.storageKey ?? null,
      sourceModule: input.sourceModule,
      metadata: input.metadata ?? {},
    },
  });
}

export async function linkErpDocument(input: LinkErpDocumentInput) {
  if (!input.documentId.trim()) throw new Error("Document id is required.");
  if (!input.entityType.trim()) throw new Error("Document link entity type is required.");
  if (!input.entityId.trim()) throw new Error("Document link entity id is required.");
  if (!input.sourceModule.trim()) throw new Error("Document link source module is required.");

  return prisma.documentLink.upsert({
    where: {
      documentId_entityType_entityId_linkRole: {
        documentId: input.documentId,
        entityType: input.entityType,
        entityId: input.entityId,
        linkRole: input.linkRole ?? "source",
      },
    },
    update: {
      entityNumber: input.entityNumber ?? null,
      sourceModule: input.sourceModule,
      metadata: input.metadata ?? {},
    },
    create: {
      documentId: input.documentId,
      entityType: input.entityType,
      entityId: input.entityId,
      entityNumber: input.entityNumber ?? null,
      linkRole: input.linkRole ?? "source",
      sourceModule: input.sourceModule,
      metadata: input.metadata ?? {},
    },
  });
}

export async function archiveErpDocument(id: string) {
  return prisma.erpDocument.update({
    where: { id },
    data: {
      status: DocumentStatus.Archived,
      archivedAt: new Date(),
    },
  });
}

export async function softDeleteErpDocument(id: string) {
  return prisma.erpDocument.update({
    where: { id },
    data: {
      status: DocumentStatus.Deleted,
      deletedAt: new Date(),
    },
  });
}

export async function listDocumentsForEntity(entityType: string, entityId: string, organizationId?: string) {
  return prisma.documentLink.findMany({
    where: {
      entityType,
      entityId,
      document: { organizationId, status: { not: DocumentStatus.Deleted } },
    },
    include: { document: true },
    orderBy: { createdAt: "desc" },
  });
}
