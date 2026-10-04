import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireCurrency } from "@/lib/finance/calculations";

type Tx = Prisma.TransactionClient | PrismaClient;

export function formatContractItemCode(offiNumber: string | null, lineNumber: number) {
  const raw = offiNumber?.trim();
  if (raw && /^OFFI[-_\s]?\d+$/i.test(raw)) {
    const suffix = raw.replace(/\D/g, "");
    return suffix ? `NTX-${suffix}` : `NTX-${String(1000 + lineNumber).padStart(4, "0")}`;
  }
  return raw || `NTX-${String(1000 + lineNumber).padStart(4, "0")}`;
}

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

function contractDates(from: string | Date | null | undefined, to: string | Date | null | undefined) {
  const validFrom = from ? new Date(from) : null, validTo = to ? new Date(to) : null;
  if ([validFrom, validTo].some(date => date && !Number.isFinite(date.getTime()))) throw new Error("Contract validity dates must be valid dates.");
  if (validFrom && validTo && validFrom > validTo) throw new Error("Contract start date must not be after its end date.");
  return { validFrom, validTo };
}

export async function recalculateCustomerContractTotals(contractId: string, db: Tx = prisma) {
  const items = await db.customerContractItem.findMany({
    where: { contractId, status: { not: "Excluded" } },
    select: { basePrice: true, sellPrice: true },
  });
  const totalBaseValue = roundMoney(items.reduce((sum, item) => sum + (item.basePrice || 0), 0));
  const totalSellValue = roundMoney(items.reduce((sum, item) => sum + (item.sellPrice || 0), 0));
  return db.customerContract.update({
    where: { id: contractId },
    data: { totalBaseValue, totalSellValue, itemCount: items.length },
    include: customerContractDetailInclude,
  });
}

export async function nextCustomerContractNumber(db: Tx = prisma) {
  const year = new Date().getFullYear();
  const prefix = `NAX-CTR-${year}-`;
  const latest = await db.customerContract.findFirst({
    where: { contractNumber: { startsWith: prefix } },
    orderBy: { contractNumber: "desc" },
    select: { contractNumber: true },
  });
  const last = latest?.contractNumber.split("-").pop();
  const next = (last ? Number(last) : 0) + 1;
  return `${prefix}${String(next).padStart(4, "0")}`;
}

export async function rebuildCustomerContractItems(
  contractId: string,
  agreementVersionIds: string[],
  markupPercent: number,
  db: Tx = prisma,
) {
  const contract = await db.customerContract.findUniqueOrThrow({ where: { id: contractId }, include: { shippingCompany: true } });
  const organizationId = contract.shippingCompany.organizationId;
  if (!organizationId) throw new Error("Customer contract has no organization.");
  const selectedVersions = await db.agreementVersion.count({ where: { id: { in: agreementVersionIds }, organizationId } });
  if (selectedVersions !== new Set(agreementVersionIds).size) throw new Error("Supplier agreement not found in the active organization.");
  const versions = await db.agreementVersion.findMany({
    where: { id: { in: agreementVersionIds }, organizationId },
    include: { items: { orderBy: { lineNumber: "asc" } } },
    orderBy: [{ supplierName: "asc" }, { versionNumber: "desc" }],
  });
  const currencies = new Set(versions.flatMap(version => [requireCurrency(version.currency), ...version.items.map(item => requireCurrency(item.currency))]));
  if (currencies.size > 1) throw new Error("A customer contract requires one currency. Create separate contracts for different currencies; no exchange-rate conversion is defined.");
  const currency = [...currencies][0] ?? requireCurrency(contract.currency);
  await db.customerContractItem.deleteMany({ where: { contractId } });
  await db.customerContractSourceAgreement.deleteMany({ where: { contractId } });

  let lineNumber = 1;
  let totalBaseValue = 0;
  let totalSellValue = 0;
  let itemCount = 0;

  for (const version of versions) {
    const source = await db.customerContractSourceAgreement.create({
      data: {
        contractId,
        agreementVersionId: version.id,
        supplierId: version.supplierId,
        supplierName: version.supplierName,
        includedItemCount: version.items.length,
      },
    });

    for (const item of version.items) {
      const basePrice = item.basePrice || 0;
      const sellPrice = roundMoney(basePrice * (1 + markupPercent / 100));
      totalBaseValue += basePrice;
      totalSellValue += sellPrice;
      itemCount++;

      await db.customerContractItem.create({
        data: {
          contractId,
          sourceAgreementId: source.id,
          agreementItemId: item.id,
          supplierId: version.supplierId,
          supplierName: version.supplierName,
          lineNumber,
          itemCode: formatContractItemCode(item.offiNumber, item.lineNumber),
          vendorPartNumber: item.vendorPartNumber,
          description: item.description,
          basePrice,
          contractMarkupPercent: markupPercent,
          sellPrice,
          currency,
          unit: item.unit,
          moq: item.moq,
          leadTimeDays: item.leadTimeDays,
          hsCode: item.hsCode,
          countryOfOrigin: item.countryOfOrigin,
          manufacturer: item.manufacturer,
          status: item.hsCode && item.countryOfOrigin ? "Active" : "NeedsReview",
          reviewNote: item.hsCode && item.countryOfOrigin ? null : "Missing HS code or COO data for contract readiness.",
        },
      });
      lineNumber++;
    }
  }

  return db.customerContract.update({
    where: { id: contractId },
    data: {
      totalBaseValue: roundMoney(totalBaseValue),
      currency,
      totalSellValue: roundMoney(totalSellValue),
      itemCount,
    },
    include: customerContractDetailInclude,
  });
}

export const customerContractDetailInclude = {
  shippingCompany: true,
  sourceAgreements: {
    include: {
      agreementVersion: {
        select: {
          id: true,
          supplierName: true,
          versionNumber: true,
          status: true,
          validFrom: true,
          validTo: true,
          markupPercent: true,
        },
      },
    },
    orderBy: { supplierName: "asc" },
  },
  items: { orderBy: { lineNumber: "asc" } },
  auditEvents: { orderBy: { createdAt: "desc" }, take: 20 },
} satisfies Prisma.CustomerContractInclude;

export async function createCustomerContract(input: {
  organizationId: string;
  shippingCompanyId: string;
  title?: string;
  markupPercent?: number;
  validFrom?: string | null;
  validTo?: string | null;
  paymentTerms?: string | null;
  deliveryTerms?: string | null;
  notes?: string | null;
  agreementVersionIds: string[];
}) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(74101402)::text AS lock_result`;
    const shippingCompany = await tx.shippingCompany.findFirst({
      where: { id: input.shippingCompanyId, organizationId: input.organizationId },
    });
    if (!shippingCompany) throw new Error("Shipping company not found");

    const markupPercent = Number(input.markupPercent ?? 0);
    if (!Number.isFinite(markupPercent) || markupPercent < 0 || markupPercent > 1000) throw new Error("Markup must be between 0 and 1000 percent.");
    const contract = await tx.customerContract.create({
      data: {
        contractNumber: await nextCustomerContractNumber(tx),
        shippingCompanyId: shippingCompany.id,
        shippingCompanyName: shippingCompany.name,
        title: input.title || `${shippingCompany.name} fixed markup supply contract`,
        markupPercent,
        ...contractDates(input.validFrom, input.validTo),
        paymentTerms: input.paymentTerms || shippingCompany.paymentTerms,
        deliveryTerms: input.deliveryTerms || null,
        notes: input.notes || null,
        auditEvents: {
          create: {
            action: "created",
            summary: `Contract draft created for ${shippingCompany.name}`,
            actor: "operator",
            metadata: { agreementVersionIds: input.agreementVersionIds, markupPercent },
          },
        },
      },
    });

    return rebuildCustomerContractItems(contract.id, input.agreementVersionIds, markupPercent, tx);
  });
}

export async function updateCustomerContract(
  id: string,
  input: {
    title?: string;
    status?: string;
    markupPercent?: number;
    validFrom?: string | null;
    validTo?: string | null;
    paymentTerms?: string | null;
    deliveryTerms?: string | null;
    notes?: string | null;
    agreementVersionIds?: string[];
  },
) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.customerContract.findUnique({
      where: { id },
      include: { sourceAgreements: { include: { agreementVersion: true } }, items: true },
    });
    if (!existing) throw new Error("Customer contract not found");
    const dates = contractDates(input.validFrom === undefined ? existing.validFrom : input.validFrom, input.validTo === undefined ? existing.validTo : input.validTo);
    if ((input.status ?? existing.status) === "Active") {
      const today = new Date().toISOString().slice(0, 10);
      if ((dates.validFrom && dates.validFrom.toISOString().slice(0, 10) > today) || (dates.validTo && dates.validTo.toISOString().slice(0, 10) < today)) throw new Error("Only a currently effective contract can be active. Review its validity dates.");
      const sourceIds = input.agreementVersionIds ?? existing.sourceAgreements.map(source => source.agreementVersionId);
      const sources = await tx.agreementVersion.findMany({ where: { id: { in: sourceIds } } });
      if (sources.some(source => source.status !== "AgreementActive" || (source.validFrom && source.validFrom.toISOString().slice(0, 10) > today) || (source.validTo && source.validTo.toISOString().slice(0, 10) < today))) throw new Error("Activate and verify the effective dates of all supplier agreements before activating this customer contract.");
    }

    const statusData: Prisma.CustomerContractUpdateInput = {};
    if (input.status) {
      statusData.status = input.status as Prisma.EnumCustomerContractStatusFieldUpdateOperationsInput["set"];
      if (input.status === "UnderReview") statusData.reviewedAt = new Date();
      if (input.status === "Active") statusData.activatedAt = new Date();
      if (input.status === "Archived") statusData.archivedAt = new Date();
    }

    const markupPercent = input.markupPercent !== undefined ? Number(input.markupPercent) : existing.markupPercent;
    if (!Number.isFinite(markupPercent) || markupPercent < 0 || markupPercent > 1000) throw new Error("Markup must be between 0 and 1000 percent.");

    await tx.customerContract.update({
      where: { id },
      data: {
        ...statusData,
        ...(input.title !== undefined && { title: input.title }),
        ...(input.markupPercent !== undefined && { markupPercent }),
        ...dates,
        ...(input.paymentTerms !== undefined && { paymentTerms: input.paymentTerms }),
        ...(input.deliveryTerms !== undefined && { deliveryTerms: input.deliveryTerms }),
        ...(input.notes !== undefined && { notes: input.notes }),
        auditEvents: {
          create: {
            action: input.status ? `status_${input.status.toLowerCase()}` : "updated",
            summary: input.status ? `Contract moved to ${input.status}` : "Contract details updated",
            actor: "operator",
            metadata: { changedFields: Object.keys(input), previousMarkup: existing.markupPercent, proposedMarkup: markupPercent, previousItems: existing.items.map(item => ({ id: item.id, description: item.description, basePrice: item.basePrice, sellPrice: item.sellPrice, currency: item.currency, agreementItemId: item.agreementItemId })) },
          },
        },
      },
    });

    const sourceIds = input.agreementVersionIds ?? existing.sourceAgreements.map((source) => source.agreementVersionId);
    if (input.agreementVersionIds) {
      return rebuildCustomerContractItems(id, sourceIds, markupPercent, tx);
    }
    if (input.markupPercent !== undefined) {
      for (const item of existing.items) await tx.customerContractItem.update({ where: { id: item.id }, data: { contractMarkupPercent: markupPercent, sellPrice: roundMoney(item.basePrice * (1 + markupPercent / 100)) } });
      return recalculateCustomerContractTotals(id, tx);
    }

    return tx.customerContract.findUniqueOrThrow({ where: { id }, include: customerContractDetailInclude });
  });
}
