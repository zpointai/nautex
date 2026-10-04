import { NumberSequenceDocumentType, Prisma, type NumberSequence } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export interface IssueNumberInput {
  organizationId: string;
  legalEntityId: string;
  documentType: NumberSequenceDocumentType;
  fiscalYear?: number;
  prefix: string;
  padding?: number;
  issuedAt?: Date;
  metadata?: Prisma.InputJsonObject;
}

export interface IssuedNumber {
  sequence: NumberSequence;
  number: string;
  sequenceValue: number;
}

export const NUMBER_SEQUENCE_DOCUMENT_TYPES = [
  NumberSequenceDocumentType.Rfq,
  NumberSequenceDocumentType.Quote,
  NumberSequenceDocumentType.SupplierInquiry,
  NumberSequenceDocumentType.PurchaseOrder,
  NumberSequenceDocumentType.SalesOrder,
  NumberSequenceDocumentType.CustomerInvoice,
  NumberSequenceDocumentType.SupplierInvoice,
  NumberSequenceDocumentType.CreditNote,
  NumberSequenceDocumentType.Agreement,
  NumberSequenceDocumentType.ValidationRun,
  NumberSequenceDocumentType.Exception,
  NumberSequenceDocumentType.AgentRun,
  NumberSequenceDocumentType.ExportBatch,
  NumberSequenceDocumentType.Document,
  NumberSequenceDocumentType.GoodsReceipt,
  NumberSequenceDocumentType.Delivery,
  NumberSequenceDocumentType.Backorder,
  NumberSequenceDocumentType.SupplierConfirmation,
  NumberSequenceDocumentType.ImportBatch,
] as const;

export function fiscalYearFor(date = new Date()) {
  return date.getFullYear();
}

export function formatSequenceNumber(prefix: string, sequenceValue: number, padding = 5) {
  return `${prefix}-${String(sequenceValue).padStart(padding, "0")}`;
}

function isUniqueConstraintError(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "P2002";
}

async function assertSequenceScope(input: Pick<IssueNumberInput, "organizationId" | "legalEntityId">) {
  const legalEntity = await prisma.legalEntity.findFirst({
    where: { id: input.legalEntityId, organizationId: input.organizationId },
    select: { id: true },
  });
  if (!legalEntity) throw new Error("Legal entity does not belong to the active customer organization.");
}

async function ensureSequence(tx: Prisma.TransactionClient, input: Required<Pick<IssueNumberInput, "legalEntityId" | "documentType" | "fiscalYear" | "prefix" | "padding">> & Pick<IssueNumberInput, "metadata">) {
  const where = {
    legalEntityId_documentType_fiscalYear_prefix: {
      legalEntityId: input.legalEntityId,
      documentType: input.documentType,
      fiscalYear: input.fiscalYear,
      prefix: input.prefix,
    },
  };

  const existing = await tx.numberSequence.findUnique({ where });
  if (existing) return existing;

  try {
    return await tx.numberSequence.create({
      data: {
        legalEntityId: input.legalEntityId,
        documentType: input.documentType,
        fiscalYear: input.fiscalYear,
        prefix: input.prefix,
        padding: input.padding,
        metadata: input.metadata ?? {},
      },
    });
  } catch (error) {
    if (!isUniqueConstraintError(error)) throw error;
    const createdByConcurrentRequest = await tx.numberSequence.findUnique({ where });
    if (!createdByConcurrentRequest) throw error;
    return createdByConcurrentRequest;
  }
}

export async function issueNumber(input: IssueNumberInput): Promise<IssuedNumber> {
  await assertSequenceScope(input);
  const issuedAt = input.issuedAt ?? new Date();
  const fiscalYear = input.fiscalYear ?? fiscalYearFor(issuedAt);
  const padding = input.padding ?? 5;

  return prisma.$transaction(async (tx) => {
    const sequence = await ensureSequence(tx, {
      legalEntityId: input.legalEntityId,
      documentType: input.documentType,
      fiscalYear,
      prefix: input.prefix,
      padding,
      metadata: input.metadata,
    });

    if (!sequence.isActive) {
      throw new Error(`Number sequence ${sequence.prefix}/${sequence.documentType}/${sequence.fiscalYear} is inactive.`);
    }

    const updated = await tx.numberSequence.update({
      where: { id: sequence.id },
      data: {
        nextNumber: { increment: 1 },
        lastIssuedAt: issuedAt,
      },
    });

    const sequenceValue = updated.nextNumber - 1;
    return {
      sequence: updated,
      sequenceValue,
      number: formatSequenceNumber(updated.prefix, sequenceValue, updated.padding),
    };
  });
}

export async function previewNextNumber(input: IssueNumberInput) {
  await assertSequenceScope(input);
  const fiscalYear = input.fiscalYear ?? fiscalYearFor(input.issuedAt);
  const sequence = await prisma.numberSequence.findUnique({
    where: {
      legalEntityId_documentType_fiscalYear_prefix: {
        legalEntityId: input.legalEntityId,
        documentType: input.documentType,
        fiscalYear,
        prefix: input.prefix,
      },
    },
  });
  const padding = sequence?.padding ?? input.padding ?? 5;
  const nextValue = sequence?.nextNumber ?? 1;

  return {
    fiscalYear,
    nextValue,
    number: formatSequenceNumber(input.prefix, nextValue, padding),
    sequenceExists: Boolean(sequence),
  };
}
