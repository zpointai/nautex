import { prisma } from "@/lib/prisma";
import { resolveItemCorrection } from "@/lib/learning/item-search";

export type ItemSearchSource =
  | "catalog"
  | "inventory"
  | "agreement"
  | "customer_contract"
  | "purchase_history"
  | "rfq_history"
  | "supplier_quote"
  | "purchase_order";

export type ItemSearchSort = "relevance" | "last_purchase" | "price_asc" | "price_desc";

export interface ItemSearchQuery {
  organizationId: string;
  query: string;
  source?: ItemSearchSource | "all";
  supplier?: string | null;
  category?: string | null;
  vessel?: string | null;
  page?: number;
  pageSize?: number;
  sort?: ItemSearchSort;
}

export interface ItemSearchResult {
  id: string;
  source: ItemSearchSource;
  sourceLabel: string;
  itemNumber: string;
  description: string;
  category: string | null;
  supplierName: string | null;
  supplierId: string | null;
  manufacturer: string | null;
  makerNumber: string | null;
  impaCode: string | null;
  hsCode: string | null;
  countryOfOrigin: string | null;
  customerReference: string | null;
  supplierReference: string | null;
  vessel: string | null;
  port: string | null;
  unit: string | null;
  quantity: number | null;
  unitPrice: number | null;
  currency: string | null;
  leadTimeDays: number | null;
  stockOnHand: number | null;
  stockAvailable: number | null;
  warehouse: string | null;
  agreementStatus: string | null;
  agreementValidTo: string | null;
  poNumber: string | null;
  rfqId: string | null;
  lastPurchaseDate: string | null;
  matchScore: number;
  matchQuality: "high" | "medium" | "low";
  matchReasons: string[];
  links: {
    itemId?: string;
    inventoryItemId?: string;
    agreementVersionId?: string;
    customerContractId?: string;
    purchaseOrderId?: string;
    purchaseOrderLineId?: string;
    rfqId?: string;
    rfqLineId?: string;
    supplierQuoteId?: string;
  };
}

export interface ItemSearchResponse {
  results: ItemSearchResult[];
  summary: {
    totalCandidates: number;
    totalReturned: number;
    page: number;
    pageSize: number;
    sourceCounts: Record<ItemSearchSource, number>;
    topMatchQuality: ItemSearchResult["matchQuality"] | null;
    hasAgreementCoverage: boolean;
    hasInventoryCoverage: boolean;
    hasPurchaseHistory: boolean;
    hasRfqHistory: boolean;
    bestLastPrice: {
      supplierName: string | null;
      unitPrice: number;
      currency: string;
      poNumber: string | null;
      lastPurchaseDate: string | null;
    } | null;
  };
}

export interface ItemSearchHistoryRow {
  id: string;
  query: string;
  resultCount: number;
  createdAt: string;
}

export interface ItemSearchPriorPurchase {
  id: string;
  itemNumber: string;
  description: string;
  supplierName: string;
  vessel: string;
  quantity: number;
  unit: string;
  unitPrice: number | null;
  currency: string | null;
  lastPurchaseDate: string;
  poNumber: string;
}

const ALL_SOURCES: ItemSearchSource[] = [
  "catalog",
  "inventory",
  "agreement",
  "customer_contract",
  "purchase_history",
  "rfq_history",
  "supplier_quote",
  "purchase_order",
];

const SOURCE_LABELS: Record<ItemSearchSource, string> = {
  catalog: "Catalogue",
  inventory: "Inventory",
  agreement: "Supplier Agreement",
  customer_contract: "Customer Contract",
  purchase_history: "PO History",
  rfq_history: "RFQ History",
  supplier_quote: "Supplier Quote",
  purchase_order: "Purchase Order",
};

const SOURCE_WEIGHT: Record<ItemSearchSource, number> = {
  purchase_history: 16,
  agreement: 14,
  customer_contract: 12,
  inventory: 12,
  supplier_quote: 10,
  rfq_history: 8,
  catalog: 6,
  purchase_order: 2,
};

const MAX_PER_SOURCE = 80;

function normalize(value: string | null | undefined) {
  return (value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function tokens(value: string) {
  return normalize(value).split(" ").filter((token) => token.length >= 2);
}

function compactCode(value: string | null | undefined) {
  return (value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function isoDate(value: Date | string | null | undefined) {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function numberOrNull(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function safePage(value: number | undefined) {
  return Math.max(1, Number.isFinite(value || 0) ? Math.floor(value || 1) : 1);
}

function safePageSize(value: number | undefined) {
  const size = Number.isFinite(value || 0) ? Math.floor(value || 25) : 25;
  return Math.min(100, Math.max(5, size));
}

function includesFilter(value: string | null | undefined, filter: string | null | undefined) {
  if (!filter) return true;
  return normalize(value).includes(normalize(filter));
}

function sourceEnabled(source: ItemSearchSource, selected: ItemSearchSource | "all" | undefined) {
  return !selected || selected === "all" || selected === source;
}

function scoreMatch(params: {
  query: string;
  source: ItemSearchSource;
  fields: Array<{ label: string; value: string | null | undefined; exactWeight?: number; containsWeight?: number }>;
  contextBoost?: number;
}) {
  const queryNorm = normalize(params.query);
  const queryCode = compactCode(params.query);
  const queryTokens = tokens(params.query);
  let score = SOURCE_WEIGHT[params.source] + (params.contextBoost || 0);
  const reasons: string[] = [];

  for (const field of params.fields) {
    const valueNorm = normalize(field.value);
    const valueCode = compactCode(field.value);
    if (!valueNorm) continue;

    if (queryCode && valueCode === queryCode) {
      score += field.exactWeight ?? 40;
      reasons.push(`${field.label} exact match`);
      continue;
    }

    if (queryNorm && valueNorm.includes(queryNorm)) {
      score += field.containsWeight ?? 22;
      reasons.push(`${field.label} contains query`);
      continue;
    }

    if (queryCode && valueCode.includes(queryCode) && queryCode.length >= 3) {
      score += 18;
      reasons.push(`${field.label} code fragment`);
      continue;
    }

    const fieldTokens = new Set(valueNorm.split(" "));
    const matched = queryTokens.filter((token) => fieldTokens.has(token)).length;
    if (matched > 0) {
      const coverage = matched / Math.max(queryTokens.length, 1);
      score += Math.round(coverage * 18);
      if (coverage >= 0.5) reasons.push(`${field.label} token match`);
    }
  }

  const uniqueReasons = [...new Set(reasons)].slice(0, 4);
  const bounded = Math.min(100, Math.max(1, Math.round(score)));
  return {
    score: bounded,
    quality: bounded >= 72 ? "high" as const : bounded >= 42 ? "medium" as const : "low" as const,
    reasons: uniqueReasons.length > 0 ? uniqueReasons : ["Related procurement record"],
  };
}

function sortResults(results: ItemSearchResult[], sort: ItemSearchSort) {
  return [...results].sort((a, b) => {
    if (sort === "last_purchase") {
      return (Date.parse(b.lastPurchaseDate || "") || 0) - (Date.parse(a.lastPurchaseDate || "") || 0) || b.matchScore - a.matchScore;
    }
    if (sort === "price_asc") {
      return (a.unitPrice ?? Number.POSITIVE_INFINITY) - (b.unitPrice ?? Number.POSITIVE_INFINITY) || b.matchScore - a.matchScore;
    }
    if (sort === "price_desc") {
      return (b.unitPrice ?? Number.NEGATIVE_INFINITY) - (a.unitPrice ?? Number.NEGATIVE_INFINITY) || b.matchScore - a.matchScore;
    }
    return b.matchScore - a.matchScore || SOURCE_WEIGHT[b.source] - SOURCE_WEIGHT[a.source];
  });
}

function dedupeResults(results: ItemSearchResult[]) {
  const seen = new Set<string>();
  const deduped: ItemSearchResult[] = [];
  for (const result of results) {
    const key = [
      result.source,
      compactCode(result.itemNumber),
      normalize(result.description),
      normalize(result.supplierName),
      result.poNumber || result.rfqId || result.links.agreementVersionId || result.links.customerContractId || "",
    ].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(result);
  }
  return deduped;
}

function emptySourceCounts() {
  return ALL_SOURCES.reduce((acc, source) => {
    acc[source] = 0;
    return acc;
  }, {} as Record<ItemSearchSource, number>);
}

export async function searchItems(params: ItemSearchQuery): Promise<ItemSearchResponse> {
  if (!params.organizationId) throw new Error("An organization is required for item search.");
  const q = params.query.trim();
  const page = safePage(params.page);
  const pageSize = safePageSize(params.pageSize);
  const sort = params.sort || "relevance";
  const source = params.source || "all";
  const correction = sourceEnabled("inventory", source) ? await resolveItemCorrection(params.organizationId, q) : null;

  const itemWhere = {
    isDeleted: false,
    OR: [
      { description: { contains: q, mode: "insensitive" as const } },
      { normalizedDesc: { contains: q, mode: "insensitive" as const } },
      { impaCode: { contains: q, mode: "insensitive" as const } },
      { hsCodeEu: { contains: q, mode: "insensitive" as const } },
      { hsCodeUs: { contains: q, mode: "insensitive" as const } },
      { category: { contains: q, mode: "insensitive" as const } },
    ],
  };

  const [
    catalogItems,
    inventoryItems,
    agreementItems,
    customerContractItems,
    poLines,
    purchaseOrders,
    rfqLines,
    supplierQuotes,
  ] = await Promise.all([
    sourceEnabled("catalog", source)
      ? prisma.item.findMany({ where: itemWhere, orderBy: [{ impaCode: "asc" }, { description: "asc" }], take: MAX_PER_SOURCE })
      : Promise.resolve([]),
    sourceEnabled("inventory", source)
      ? prisma.inventoryItem.findMany({
          where: {
            organizationId: params.organizationId,
            OR: [
              ...(correction ? [{ id: correction.inventoryItemId }] : []),
              { id: { contains: q, mode: "insensitive" as const } },
              { itemCode: { contains: q, mode: "insensitive" as const } },
              { description: { contains: q, mode: "insensitive" as const } },
              { category: { contains: q, mode: "insensitive" as const } },
              { warehouse: { contains: q, mode: "insensitive" as const } },
              { locationBin: { contains: q, mode: "insensitive" as const } },
            ],
          },
          orderBy: [{ updatedAt: "desc" }],
          take: MAX_PER_SOURCE,
        })
      : Promise.resolve([]),
    sourceEnabled("agreement", source)
      ? prisma.agreementItem.findMany({
          where: {
            version: { organizationId: params.organizationId },
            OR: [
              { description: { contains: q, mode: "insensitive" as const } },
              { offiNumber: { contains: q, mode: "insensitive" as const } },
              { systemId: { contains: q, mode: "insensitive" as const } },
              { vendorPartNumber: { contains: q, mode: "insensitive" as const } },
              { manufacturer: { contains: q, mode: "insensitive" as const } },
              { hsCode: { contains: q, mode: "insensitive" as const } },
            ],
          },
          include: { version: true },
          orderBy: [{ updatedAt: "desc" }],
          take: MAX_PER_SOURCE,
        })
      : Promise.resolve([]),
    sourceEnabled("customer_contract", source)
      ? prisma.customerContractItem.findMany({
          where: {
            contract: { shippingCompany: { organizationId: params.organizationId } },
            status: "Active",
            OR: [
              { description: { contains: q, mode: "insensitive" as const } },
              { itemCode: { contains: q, mode: "insensitive" as const } },
              { vendorPartNumber: { contains: q, mode: "insensitive" as const } },
              { manufacturer: { contains: q, mode: "insensitive" as const } },
              { supplierName: { contains: q, mode: "insensitive" as const } },
              { hsCode: { contains: q, mode: "insensitive" as const } },
            ],
          },
          include: { contract: true },
          orderBy: [{ updatedAt: "desc" }],
          take: MAX_PER_SOURCE,
        })
      : Promise.resolve([]),
    sourceEnabled("purchase_history", source)
      ? prisma.purchaseOrderLine.findMany({
          where: {
            order: { organizationId: params.organizationId },
            OR: [
              { description: { contains: q, mode: "insensitive" as const } },
              { itemCode: { contains: q, mode: "insensitive" as const } },
              { supplierPartNo: { contains: q, mode: "insensitive" as const } },
              { order: { supplier: { contains: q, mode: "insensitive" as const } } },
              { order: { supplierRef: { contains: q, mode: "insensitive" as const } } },
              { order: { buyerRef: { contains: q, mode: "insensitive" as const } } },
              { order: { vessel: { contains: q, mode: "insensitive" as const } } },
              { order: { poNumber: { contains: q, mode: "insensitive" as const } } },
            ],
          },
          include: { order: true },
          orderBy: [{ createdAt: "desc" }],
          take: MAX_PER_SOURCE,
        })
      : Promise.resolve([]),
    sourceEnabled("purchase_order", source)
      ? prisma.purchaseOrder.findMany({
          where: {
            organizationId: params.organizationId,
            OR: [
              { poNumber: { contains: q, mode: "insensitive" as const } },
              { vessel: { contains: q, mode: "insensitive" as const } },
              { supplier: { contains: q, mode: "insensitive" as const } },
              { supplierRef: { contains: q, mode: "insensitive" as const } },
              { buyerRef: { contains: q, mode: "insensitive" as const } },
              { port: { contains: q, mode: "insensitive" as const } },
            ],
          },
          orderBy: [{ createdAt: "desc" }],
          take: 20,
        })
      : Promise.resolve([]),
    sourceEnabled("rfq_history", source)
      ? prisma.rfqLine.findMany({
          where: {
            rfq: { organizationId: params.organizationId },
            OR: [
              { description: { contains: q, mode: "insensitive" as const } },
              { normalizedDesc: { contains: q, mode: "insensitive" as const } },
              { impaCode: { contains: q, mode: "insensitive" as const } },
              { hsCode: { contains: q, mode: "insensitive" as const } },
              { rfq: { vessel: { contains: q, mode: "insensitive" as const } } },
              { rfq: { port: { contains: q, mode: "insensitive" as const } } },
            ],
          },
          include: { rfq: true, supplierQuotes: { include: { supplier: true }, take: 5 } },
          orderBy: [{ createdAt: "desc" }],
          take: MAX_PER_SOURCE,
        })
      : Promise.resolve([]),
    sourceEnabled("supplier_quote", source)
      ? prisma.supplierQuote.findMany({
          where: {
            rfqLine: { rfq: { organizationId: params.organizationId } },
            supplier: { organizationId: params.organizationId },
            OR: [
              { description: { contains: q, mode: "insensitive" as const } },
              { supplier: { name: { contains: q, mode: "insensitive" as const } } },
              { rfqLine: { description: { contains: q, mode: "insensitive" as const } } },
              { rfqLine: { impaCode: { contains: q, mode: "insensitive" as const } } },
            ],
          },
          include: { supplier: true, rfqLine: { include: { rfq: true } } },
          orderBy: [{ createdAt: "desc" }],
          take: MAX_PER_SOURCE,
        })
      : Promise.resolve([]),
  ]);

  const results: ItemSearchResult[] = [];

  for (const item of catalogItems) {
    const match = scoreMatch({
      query: q,
      source: "catalog",
      fields: [
        { label: "IMPA code", value: item.impaCode, exactWeight: 50 },
        { label: "description", value: item.description },
        { label: "normalized description", value: item.normalizedDesc },
        { label: "category", value: item.category },
        { label: "HS code", value: item.hsCodeEu || item.hsCodeUs },
      ],
    });
    results.push({
      id: `catalog:${item.id}`,
      source: "catalog",
      sourceLabel: SOURCE_LABELS.catalog,
      itemNumber: item.impaCode || item.id,
      description: item.description,
      category: item.category,
      supplierName: null,
      supplierId: null,
      manufacturer: null,
      makerNumber: null,
      impaCode: item.impaCode,
      hsCode: item.hsCodeEu || item.hsCodeUs,
      countryOfOrigin: item.countryOrigin,
      customerReference: null,
      supplierReference: null,
      vessel: null,
      port: null,
      unit: item.unit,
      quantity: null,
      unitPrice: null,
      currency: null,
      leadTimeDays: null,
      stockOnHand: null,
      stockAvailable: null,
      warehouse: null,
      agreementStatus: null,
      agreementValidTo: null,
      poNumber: null,
      rfqId: null,
      lastPurchaseDate: null,
      matchScore: match.score,
      matchQuality: match.quality,
      matchReasons: match.reasons,
      links: { itemId: item.id },
    });
  }

  for (const item of inventoryItems) {
    const available = Math.max(item.onHand - item.reserved, 0);
    const match = scoreMatch({
      query: q,
      source: "inventory",
      contextBoost: available > 0 ? 4 : 0,
      fields: [
        { label: "inventory id", value: item.id, exactWeight: 42 },
        { label: "item code", value: item.itemCode, exactWeight: 46 },
        { label: "description", value: item.description },
        { label: "category", value: item.category },
        { label: "warehouse", value: item.warehouse },
        { label: "bin", value: item.locationBin },
      ],
    });
    results.push({
      id: `inventory:${item.id}`,
      source: "inventory",
      sourceLabel: SOURCE_LABELS.inventory,
      itemNumber: item.itemCode || item.id,
      description: item.description,
      category: item.category,
      supplierName: null,
      supplierId: null,
      manufacturer: null,
      makerNumber: null,
      impaCode: item.itemCode,
      hsCode: null,
      countryOfOrigin: null,
      customerReference: null,
      supplierReference: null,
      vessel: null,
      port: null,
      unit: item.uom,
      quantity: null,
      unitPrice: null,
      currency: null,
      leadTimeDays: null,
      stockOnHand: item.onHand,
      stockAvailable: available,
      warehouse: [item.warehouse, item.locationBin].filter(Boolean).join(" / "),
      agreementStatus: null,
      agreementValidTo: null,
      poNumber: null,
      rfqId: null,
      lastPurchaseDate: isoDate(item.updatedAt),
      matchScore: correction?.inventoryItemId === item.id ? Math.max(match.score, 100) : match.score,
      matchQuality: correction?.inventoryItemId === item.id ? "high" : match.quality,
      matchReasons: correction?.inventoryItemId === item.id ? [`Reviewed item alias (${correction.id}); verify suitability and unit before use`, ...match.reasons] : match.reasons,
      links: { inventoryItemId: item.id, itemId: item.catalogItemId || undefined },
    });
  }

  for (const item of agreementItems) {
    const version = item.version;
    const match = scoreMatch({
      query: q,
      source: "agreement",
      contextBoost: version.status === "AgreementActive" ? 5 : 0,
      fields: [
        { label: "agreement item", value: item.offiNumber || item.systemId, exactWeight: 48 },
        { label: "supplier item reference", value: item.vendorPartNumber, exactWeight: 48 },
        { label: "description", value: item.description },
        { label: "manufacturer", value: item.manufacturer },
        { label: "supplier", value: version.supplierName },
        { label: "HS code", value: item.hsCode },
      ],
    });
    results.push({
      id: `agreement:${item.id}`,
      source: "agreement",
      sourceLabel: SOURCE_LABELS.agreement,
      itemNumber: item.offiNumber || item.systemId || item.vendorPartNumber || item.id,
      description: item.description,
      category: null,
      supplierName: version.supplierName,
      supplierId: version.supplierId,
      manufacturer: item.manufacturer,
      makerNumber: item.vendorPartNumber,
      impaCode: null,
      hsCode: item.hsCode,
      countryOfOrigin: item.countryOfOrigin,
      customerReference: item.systemId,
      supplierReference: item.vendorPartNumber,
      vessel: null,
      port: null,
      unit: item.unit,
      quantity: item.moq,
      unitPrice: item.markedUpPrice ?? item.basePrice,
      currency: item.currency,
      leadTimeDays: item.leadTimeDays,
      stockOnHand: null,
      stockAvailable: null,
      warehouse: null,
      agreementStatus: version.status === "AgreementActive" ? "Active" : version.status.replace(/^Agreement/, ""),
      agreementValidTo: isoDate(version.validTo),
      poNumber: null,
      rfqId: null,
      lastPurchaseDate: isoDate(item.updatedAt),
      matchScore: match.score,
      matchQuality: match.quality,
      matchReasons: match.reasons,
      links: { agreementVersionId: version.id },
    });
  }

  for (const item of customerContractItems) {
    const contract = item.contract;
    const match = scoreMatch({
      query: q,
      source: "customer_contract",
      contextBoost: contract.status === "Active" ? 5 : 0,
      fields: [
        { label: "customer item reference", value: item.itemCode, exactWeight: 48 },
        { label: "supplier item reference", value: item.vendorPartNumber, exactWeight: 48 },
        { label: "description", value: item.description },
        { label: "manufacturer", value: item.manufacturer },
        { label: "supplier", value: item.supplierName },
        { label: "customer", value: contract.shippingCompanyName },
      ],
    });
    results.push({
      id: `customer_contract:${item.id}`,
      source: "customer_contract",
      sourceLabel: SOURCE_LABELS.customer_contract,
      itemNumber: item.itemCode || item.vendorPartNumber || item.id,
      description: item.description,
      category: null,
      supplierName: item.supplierName,
      supplierId: item.supplierId,
      manufacturer: item.manufacturer,
      makerNumber: item.vendorPartNumber,
      impaCode: null,
      hsCode: item.hsCode,
      countryOfOrigin: item.countryOfOrigin,
      customerReference: item.itemCode,
      supplierReference: item.vendorPartNumber,
      vessel: contract.shippingCompanyName,
      port: null,
      unit: item.unit,
      quantity: item.moq,
      unitPrice: item.sellPrice,
      currency: item.currency,
      leadTimeDays: item.leadTimeDays,
      stockOnHand: null,
      stockAvailable: null,
      warehouse: null,
      agreementStatus: contract.status,
      agreementValidTo: isoDate(contract.validTo),
      poNumber: null,
      rfqId: null,
      lastPurchaseDate: isoDate(item.updatedAt),
      matchScore: match.score,
      matchQuality: match.quality,
      matchReasons: match.reasons,
      links: { customerContractId: contract.id, agreementVersionId: item.sourceAgreementId || undefined },
    });
  }

  for (const line of poLines) {
    const order = line.order;
    const match = scoreMatch({
      query: q,
      source: "purchase_history",
      fields: [
        { label: "item code", value: line.itemCode, exactWeight: 48 },
        { label: "supplier part number", value: line.supplierPartNo, exactWeight: 48 },
        { label: "description", value: line.description },
        { label: "supplier", value: order.supplier },
        { label: "supplier reference", value: order.supplierRef },
        { label: "customer reference", value: order.buyerRef },
        { label: "vessel", value: order.vessel },
        { label: "PO number", value: order.poNumber, exactWeight: 44 },
      ],
    });
    results.push({
      id: `purchase_history:${line.id}`,
      source: "purchase_history",
      sourceLabel: SOURCE_LABELS.purchase_history,
      itemNumber: line.itemCode || line.supplierPartNo || line.id,
      description: line.description,
      category: null,
      supplierName: order.supplier,
      supplierId: order.supplierId,
      manufacturer: null,
      makerNumber: line.supplierPartNo,
      impaCode: line.itemCode,
      hsCode: null,
      countryOfOrigin: null,
      customerReference: order.buyerRef,
      supplierReference: line.supplierPartNo || order.supplierRef,
      vessel: order.vessel,
      port: order.port,
      unit: line.uom,
      quantity: line.qtyOrdered,
      unitPrice: numberOrNull(line.unitPrice),
      currency: line.currency,
      leadTimeDays: null,
      stockOnHand: null,
      stockAvailable: null,
      warehouse: null,
      agreementStatus: null,
      agreementValidTo: null,
      poNumber: order.poNumber,
      rfqId: order.rfqId,
      lastPurchaseDate: isoDate(line.createdAt),
      matchScore: match.score,
      matchQuality: match.quality,
      matchReasons: match.reasons,
      links: { purchaseOrderId: order.id, purchaseOrderLineId: line.id, rfqId: order.rfqId || undefined },
    });
  }

  for (const order of purchaseOrders) {
    const match = scoreMatch({
      query: q,
      source: "purchase_order",
      fields: [
        { label: "PO number", value: order.poNumber, exactWeight: 44 },
        { label: "supplier", value: order.supplier },
        { label: "supplier reference", value: order.supplierRef },
        { label: "customer reference", value: order.buyerRef },
        { label: "vessel", value: order.vessel },
        { label: "port", value: order.port },
      ],
    });
    results.push({
      id: `purchase_order:${order.id}`,
      source: "purchase_order",
      sourceLabel: SOURCE_LABELS.purchase_order,
      itemNumber: order.poNumber,
      description: `Purchase order for ${order.vessel}`,
      category: order.orderType,
      supplierName: order.supplier,
      supplierId: order.supplierId,
      manufacturer: null,
      makerNumber: null,
      impaCode: null,
      hsCode: null,
      countryOfOrigin: null,
      customerReference: order.buyerRef,
      supplierReference: order.supplierRef,
      vessel: order.vessel,
      port: order.port,
      unit: null,
      quantity: null,
      unitPrice: numberOrNull(order.total),
      currency: order.currency,
      leadTimeDays: null,
      stockOnHand: null,
      stockAvailable: null,
      warehouse: null,
      agreementStatus: null,
      agreementValidTo: null,
      poNumber: order.poNumber,
      rfqId: order.rfqId,
      lastPurchaseDate: isoDate(order.createdAt),
      matchScore: match.score,
      matchQuality: match.quality,
      matchReasons: match.reasons,
      links: { purchaseOrderId: order.id, rfqId: order.rfqId || undefined },
    });
  }

  for (const line of rfqLines) {
    const bestQuote = [...line.supplierQuotes].sort((a, b) => a.unitPrice - b.unitPrice)[0];
    const match = scoreMatch({
      query: q,
      source: "rfq_history",
      fields: [
        { label: "IMPA code", value: line.impaCode, exactWeight: 48 },
        { label: "description", value: line.description },
        { label: "normalized description", value: line.normalizedDesc },
        { label: "HS code", value: line.hsCode },
        { label: "vessel", value: line.rfq.vessel },
        { label: "port", value: line.rfq.port },
      ],
    });
    results.push({
      id: `rfq_history:${line.id}`,
      source: "rfq_history",
      sourceLabel: SOURCE_LABELS.rfq_history,
      itemNumber: line.impaCode || line.id,
      description: line.description,
      category: null,
      supplierName: bestQuote?.supplier.name ?? null,
      supplierId: bestQuote?.supplierId ?? null,
      manufacturer: null,
      makerNumber: null,
      impaCode: line.impaCode,
      hsCode: line.hsCode,
      countryOfOrigin: line.countryOrigin,
      customerReference: null,
      supplierReference: null,
      vessel: line.rfq.vessel,
      port: line.rfq.port,
      unit: line.unit,
      quantity: line.quantity,
      unitPrice: bestQuote?.unitPrice ?? null,
      currency: bestQuote?.currency ?? null,
      leadTimeDays: bestQuote?.leadTimeDays ?? null,
      stockOnHand: null,
      stockAvailable: null,
      warehouse: null,
      agreementStatus: line.rfq.status,
      agreementValidTo: null,
      poNumber: null,
      rfqId: line.rfqId,
      lastPurchaseDate: isoDate(line.createdAt),
      matchScore: match.score,
      matchQuality: match.quality,
      matchReasons: match.reasons,
      links: { rfqId: line.rfqId, rfqLineId: line.id, supplierQuoteId: bestQuote?.id },
    });
  }

  for (const quote of supplierQuotes) {
    const rfqLine = quote.rfqLine;
    const match = scoreMatch({
      query: q,
      source: "supplier_quote",
      fields: [
        { label: "quoted description", value: quote.description },
        { label: "supplier", value: quote.supplier.name },
        { label: "RFQ description", value: rfqLine?.description },
        { label: "IMPA code", value: rfqLine?.impaCode, exactWeight: 48 },
      ],
    });
    results.push({
      id: `supplier_quote:${quote.id}`,
      source: "supplier_quote",
      sourceLabel: SOURCE_LABELS.supplier_quote,
      itemNumber: rfqLine?.impaCode || quote.id,
      description: quote.description,
      category: null,
      supplierName: quote.supplier.name,
      supplierId: quote.supplierId,
      manufacturer: null,
      makerNumber: null,
      impaCode: rfqLine?.impaCode ?? null,
      hsCode: rfqLine?.hsCode ?? null,
      countryOfOrigin: rfqLine?.countryOrigin ?? null,
      customerReference: null,
      supplierReference: null,
      vessel: rfqLine?.rfq.vessel ?? null,
      port: rfqLine?.rfq.port ?? null,
      unit: rfqLine?.unit ?? null,
      quantity: rfqLine?.quantity ?? null,
      unitPrice: quote.unitPrice,
      currency: quote.currency,
      leadTimeDays: quote.leadTimeDays,
      stockOnHand: null,
      stockAvailable: null,
      warehouse: quote.stockStatus,
      agreementStatus: quote.status,
      agreementValidTo: null,
      poNumber: null,
      rfqId: rfqLine?.rfqId ?? null,
      lastPurchaseDate: isoDate(quote.createdAt),
      matchScore: match.score,
      matchQuality: match.quality,
      matchReasons: match.reasons,
      links: { supplierQuoteId: quote.id, rfqId: rfqLine?.rfqId, rfqLineId: quote.rfqLineId || undefined },
    });
  }

  const filtered = dedupeResults(results).filter((result) => {
    return includesFilter(result.supplierName, params.supplier)
      && includesFilter(result.category || result.sourceLabel, params.category)
      && includesFilter(result.vessel, params.vessel);
  });
  const ranked = sortResults(filtered, sort);
  const offset = (page - 1) * pageSize;
  const paged = ranked.slice(offset, offset + pageSize);
  const sourceCounts = emptySourceCounts();
  for (const result of ranked) sourceCounts[result.source] += 1;
  const purchasePrices = ranked
    .filter((result) => result.source === "purchase_history" && result.unitPrice != null)
    .sort((a, b) => (Date.parse(b.lastPurchaseDate || "") || 0) - (Date.parse(a.lastPurchaseDate || "") || 0));
  const lastPrice = purchasePrices[0] ?? null;

  if (page === 1) {
    await prisma.searchHistory.create({
      data: {
        organizationId: params.organizationId,
        query: q,
        module: "catalog_search",
        resultCount: ranked.length,
        topResults: paged.slice(0, 5).map((item) => ({
          id: item.id,
          source: item.source,
          itemNumber: item.itemNumber,
          description: item.description,
          supplierName: item.supplierName,
          unitPrice: item.unitPrice,
          currency: item.currency,
          matchScore: item.matchScore,
        })),
      },
    });
  }

  return {
    results: paged,
    summary: {
      totalCandidates: ranked.length,
      totalReturned: paged.length,
      page,
      pageSize,
      sourceCounts,
      topMatchQuality: ranked[0]?.matchQuality ?? null,
      hasAgreementCoverage: ranked.some((result) => result.source === "agreement" || result.source === "customer_contract"),
      hasInventoryCoverage: ranked.some((result) => result.source === "inventory" && (result.stockAvailable ?? 0) > 0),
      hasPurchaseHistory: ranked.some((result) => result.source === "purchase_history"),
      hasRfqHistory: ranked.some((result) => result.source === "rfq_history" || result.source === "supplier_quote"),
      bestLastPrice: lastPrice?.unitPrice != null
        ? {
            supplierName: lastPrice.supplierName,
            unitPrice: lastPrice.unitPrice,
            currency: lastPrice.currency || "EUR",
            poNumber: lastPrice.poNumber,
            lastPurchaseDate: lastPrice.lastPurchaseDate,
          }
        : null,
    },
  };
}

export async function getItemSearchHistory(organizationId: string, limit = 20) {
  if (!organizationId) throw new Error("An organization is required for search history.");
  const cappedLimit = Math.min(Math.max(Number.isFinite(limit) ? Math.floor(limit) : 20, 1), 50);
  const [history, recentPurchases] = await Promise.all([
    prisma.searchHistory.findMany({
      where: { module: "catalog_search", organizationId },
      orderBy: { createdAt: "desc" },
      take: cappedLimit,
    }),
    prisma.purchaseOrderLine.findMany({
      where: { order: { organizationId } },
      include: { order: true },
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
  ]);

  return {
    history: history.map((row): ItemSearchHistoryRow => ({
      id: row.id,
      query: row.query,
      resultCount: row.resultCount,
      createdAt: row.createdAt.toISOString(),
    })),
    recentPurchases: recentPurchases.map((line): ItemSearchPriorPurchase => ({
      id: line.id,
      itemNumber: line.itemCode || line.supplierPartNo || line.id,
      description: line.description,
      supplierName: line.order.supplier,
      vessel: line.order.vessel,
      quantity: line.qtyOrdered,
      unit: line.uom,
      unitPrice: line.unitPrice,
      currency: line.currency,
      lastPurchaseDate: line.createdAt.toISOString(),
      poNumber: line.order.poNumber,
    })),
  };
}
