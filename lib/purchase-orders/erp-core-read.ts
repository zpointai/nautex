import { listAuditEventsForEntity } from "@/lib/erp-core/audit";
import { listDocumentsForEntity } from "@/lib/erp-core/documents";
import { getProvenance } from "@/lib/erp-core/provenance";
import { prisma } from "@/lib/prisma";

interface PurchaseOrderErpCoreReadContext {
  supplierId?: string | null;
  buyerName?: string | null;
  vesselOwner?: string | null;
}

const PARTY_SELECT = {
  id: true,
  displayName: true,
  legalName: true,
  kind: true,
  status: true,
  country: true,
  city: true,
  vatId: true,
  companyNumber: true,
  roles: {
    select: {
      role: true,
      isPrimary: true,
    },
  },
};

type PartyReadRecord = {
  id: string;
  name: string;
  partyId: string | null;
  supplierCode?: string | null;
  party: {
    id: string;
    displayName: string;
    legalName: string | null;
    kind: string;
    status: string;
    country: string | null;
    city: string | null;
    vatId: string | null;
    companyNumber: string | null;
    roles: { role: string; isPrimary: boolean }[];
  } | null;
};

function toPartyLink(sourceModel: "Supplier" | "ShippingCompany", row: PartyReadRecord | null) {
  if (!row) return null;
  return {
    sourceModel,
    sourceId: row.id,
    sourceName: row.name,
    sourceCode: row.supplierCode ?? null,
    partyId: row.partyId,
    party: row.party,
  };
}

export async function getPurchaseOrderErpCoreReadModel(orderId: string, context: PurchaseOrderErpCoreReadContext = {}) {
  try {
    const buyerName = context.buyerName?.trim() || context.vesselOwner?.trim() || null;
    const [auditEvents, documentLinks, provenance, supplier, buyer] = await Promise.all([
      listAuditEventsForEntity("PurchaseOrder", orderId, 50),
      listDocumentsForEntity("PurchaseOrder", orderId),
      getProvenance("PurchaseOrder", orderId),
      context.supplierId
        ? prisma.supplier.findUnique({
            where: { id: context.supplierId },
            select: {
              id: true,
              name: true,
              supplierCode: true,
              partyId: true,
              party: { select: PARTY_SELECT },
            },
          })
        : null,
      buyerName
        ? prisma.shippingCompany.findFirst({
            where: { name: { equals: buyerName, mode: "insensitive" } },
            select: {
              id: true,
              name: true,
              partyId: true,
              party: { select: PARTY_SELECT },
            },
          })
        : null,
    ]);

    return {
      available: true,
      auditEvents,
      documentLinks,
      provenance,
      parties: {
        supplier: toPartyLink("Supplier", supplier),
        buyer: toPartyLink("ShippingCompany", buyer),
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[erp-core-read] PurchaseOrder ${orderId}: ${message}`);
    return {
      available: false,
      auditEvents: [],
      documentLinks: [],
      provenance: null,
      parties: {
        supplier: null,
        buyer: null,
      },
      error: message,
    };
  }
}
