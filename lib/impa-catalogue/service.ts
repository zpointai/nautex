import { prisma } from "@/lib/prisma";
import { inferIMPACategory, type IMPACataloguePage, type IMPACatalogueSummary, type IMPAItemDetail, type IMPAProduct } from "@/types/procurement";

const MAX_PAGE_SIZE = 100;
const DEFAULT_PAGE_SIZE = 50;
const SEARCH_LIMIT = 80;

function normalize(value: string | null | undefined) {
  return (value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function compactCode(value: string | null | undefined) {
  return (value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function safeLimit(value: number | undefined, fallback = DEFAULT_PAGE_SIZE) {
  const size = Number.isFinite(value || 0) ? Math.floor(value || fallback) : fallback;
  return Math.min(MAX_PAGE_SIZE, Math.max(10, size));
}

function safeOffset(value: number | undefined) {
  return Math.max(0, Number.isFinite(value || 0) ? Math.floor(value || 0) : 0);
}

function rawString(raw: unknown, key: string) {
  if (!raw || typeof raw !== "object" || !(key in raw)) return null;
  const value = (raw as Record<string, unknown>)[key];
  return value == null ? null : String(value);
}

function mapItem(item: {
  id: string;
  description: string;
  normalizedDesc: string | null;
  impaCode: string | null;
  hsCodeEu: string | null;
  hsCodeUs: string | null;
  countryOrigin: string | null;
  category: string | null;
  unit: string | null;
  source: string | null;
  edition: string | null;
  raw: unknown;
}, favoriteCodes: Set<string>, match?: { score: number; quality: "high" | "medium" | "low"; reasons: string[] }): IMPAProduct {
  const specifications = [
    item.unit ? `Unit: ${item.unit}` : null,
    item.hsCodeEu ? `EU HS: ${item.hsCodeEu}` : null,
    item.hsCodeUs ? `US HS: ${item.hsCodeUs}` : null,
    item.countryOrigin ? `COO: ${item.countryOrigin}` : null,
    rawString(item.raw, "specifications"),
  ].filter(Boolean).join(" | ");

  return {
    id: item.id,
    impaCode: item.impaCode ?? "",
    itemName: item.description,
    specifications: specifications || "No detailed specifications available.",
    category: item.category || inferIMPACategory(item.impaCode ?? ""),
    isFavorite: favoriteCodes.has(item.impaCode ?? ""),
    unit: item.unit,
    hsCode: item.hsCodeEu || item.hsCodeUs,
    countryOrigin: item.countryOrigin,
    normalizedDescription: item.normalizedDesc,
    source: item.source,
    edition: item.edition,
    matchScore: match?.score,
    matchQuality: match?.quality,
    matchReasons: match?.reasons,
  };
}

function scoreItem(item: { impaCode: string | null; description: string; normalizedDesc: string | null; unit: string | null; category: string | null }, query: string) {
  const queryNorm = normalize(query);
  const queryCode = compactCode(query);
  const reasons: string[] = [];
  let score = 0;

  const code = compactCode(item.impaCode);
  const desc = normalize(item.description);
  const normalizedDesc = normalize(item.normalizedDesc);
  const unit = normalize(item.unit);
  const category = normalize(item.category);

  if (queryCode && code === queryCode) {
    score += 100;
    reasons.push("Exact IMPA code match");
  } else if (queryCode.length >= 3 && code.includes(queryCode)) {
    score += 72;
    reasons.push("Partial IMPA code match");
  }

  if (queryNorm && desc === queryNorm) {
    score += 58;
    reasons.push("Exact description match");
  } else if (queryNorm && desc.includes(queryNorm)) {
    score += 42;
    reasons.push("Description contains query");
  }

  if (queryNorm && normalizedDesc.includes(queryNorm)) {
    score += 32;
    reasons.push("Normalized description match");
  }

  if (queryNorm && unit === queryNorm) {
    score += 30;
    reasons.push("Unit match");
  }

  if (queryNorm && category.includes(queryNorm)) {
    score += 26;
    reasons.push("Category match");
  }

  const queryTokens = queryNorm.split(" ").filter((token) => token.length >= 2);
  if (queryTokens.length > 0) {
    const fieldTokens = new Set(`${desc} ${normalizedDesc} ${category}`.split(" ").filter(Boolean));
    const hits = queryTokens.filter((token) => fieldTokens.has(token)).length;
    if (hits > 0) {
      score += Math.round((hits / queryTokens.length) * 24);
      if (hits / queryTokens.length >= 0.5) reasons.push("Term overlap");
    }
  }

  const bounded = Math.min(100, Math.max(1, score || 1));
  return {
    score: bounded,
    quality: bounded >= 75 ? "high" as const : bounded >= 45 ? "medium" as const : "low" as const,
    reasons: [...new Set(reasons)].slice(0, 4),
  };
}

export async function getImpaSummary(organizationId: string): Promise<IMPACatalogueSummary> {
  const [total, favorites, sections, latestImport] = await Promise.all([
    prisma.item.count({ where: { impaCode: { not: null }, isDeleted: false } }),
    prisma.impaFavorite.count({ where: { organizationId } }),
    prisma.item.groupBy({
      by: ["category"],
      where: { impaCode: { not: null }, isDeleted: false },
      _count: { _all: true },
      orderBy: { category: "asc" },
    }),
    prisma.datasetImport.findFirst({
      where: { type: "impa" },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        sourceFileName: true,
        status: true,
        rowCount: true,
        importedCount: true,
        skippedCount: true,
        errorCount: true,
        createdAt: true,
      },
    }),
  ]);

  return {
    total,
    sections: sections.map((section) => ({
      name: section.category || "General Stores",
      section: (section.category || "").slice(0, 2),
      count: section._count._all,
    })),
    favorites,
    visualized: 0,
    needsVisual: total,
    latestImport: latestImport ? {
      id: latestImport.id,
      fileName: latestImport.sourceFileName,
      status: latestImport.status,
      rowCount: latestImport.rowCount,
      importedCount: latestImport.importedCount,
      skippedCount: latestImport.skippedCount,
      errorCount: latestImport.errorCount,
      createdAt: latestImport.createdAt.toISOString(),
    } : null,
  };
}

export async function listImpaCatalogue(params: { organizationId: string; category?: string | null; q?: string | null; limit?: number; offset?: number }): Promise<IMPACataloguePage> {
  const q = params.q?.trim();
  const limit = safeLimit(params.limit);
  const offset = safeOffset(params.offset);
  const category = params.category?.trim();
  const where = {
    impaCode: { not: null },
    isDeleted: false,
    ...(category && category !== "All" ? { category } : {}),
    ...(q
      ? {
          OR: [
            { impaCode: { contains: q, mode: "insensitive" as const } },
            { description: { contains: q, mode: "insensitive" as const } },
            { normalizedDesc: { contains: q, mode: "insensitive" as const } },
            { unit: { contains: q, mode: "insensitive" as const } },
            { category: { contains: q, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };

  const [total, items, favorites] = await Promise.all([
    prisma.item.count({ where }),
    prisma.item.findMany({ where, orderBy: [{ impaCode: "asc" }, { description: "asc" }], skip: offset, take: limit }),
    prisma.impaFavorite.findMany({ where: { organizationId: params.organizationId }, select: { impaCode: true } }),
  ]);
  const favoriteCodes = new Set(favorites.map((favorite) => favorite.impaCode));

  return {
    items: items.map((item) => mapItem(item, favoriteCodes)),
    total,
    limit,
    offset,
    hasMore: offset + items.length < total,
  };
}

export async function searchImpaCatalogue(params: { organizationId: string; q: string; limit?: number }) {
  const q = params.q.trim();
  const limit = Math.min(Math.max(params.limit || 25, 5), 50);
  const candidates = await prisma.item.findMany({
    where: {
      impaCode: { not: null },
      isDeleted: false,
      OR: [
        { impaCode: compactCode(q) },
        { impaCode: { contains: q, mode: "insensitive" as const } },
        { description: { contains: q, mode: "insensitive" as const } },
        { normalizedDesc: { contains: q, mode: "insensitive" as const } },
        { unit: { contains: q, mode: "insensitive" as const } },
        { category: { contains: q, mode: "insensitive" as const } },
      ],
    },
    orderBy: [{ impaCode: "asc" }, { description: "asc" }],
    take: SEARCH_LIMIT,
  });

  const favorites = await prisma.impaFavorite.findMany({ where: { organizationId: params.organizationId }, select: { impaCode: true } });
  const favoriteCodes = new Set(favorites.map((favorite) => favorite.impaCode));
  const ranked = candidates
    .map((item) => ({ item, match: scoreItem(item, q) }))
    .sort((a, b) => b.match.score - a.match.score || String(a.item.impaCode).localeCompare(String(b.item.impaCode)));

  return {
    results: ranked.slice(0, limit).map(({ item, match }) => mapItem(item, favoriteCodes, match)),
    summary: {
      totalCandidates: candidates.length,
      totalReturned: Math.min(ranked.length, limit),
      topMatchQuality: ranked[0]?.match.quality ?? null,
      exactCodeMatch: ranked.some(({ match }) => match.reasons.includes("Exact IMPA code match")),
    },
  };
}

export async function getImpaItemDetail(id: string, organizationId: string): Promise<IMPAItemDetail | null> {
  if (!organizationId) throw new Error("An organization is required for catalogue context.");
  const item = await prisma.item.findFirst({
    where: { isDeleted: false, impaCode: { not: null }, OR: [{ id }, { impaCode: id }] },
  });
  if (!item?.impaCode) return null;

  const favoritePromise = prisma.impaFavorite.findUnique({ where: { organizationId_impaCode: { organizationId, impaCode: item.impaCode } }, select: { impaCode: true } });
  const descriptionProbe = item.description.slice(0, 80);
  const [favorite, inventory, agreements, purchaseHistory, rfqHistory] = await Promise.all([
    favoritePromise,
    prisma.inventoryItem.findMany({
      where: {
        organizationId,
        OR: [
          { catalogItemId: item.id },
          { itemCode: item.impaCode },
          { description: { contains: descriptionProbe, mode: "insensitive" as const } },
        ],
      },
      orderBy: [{ updatedAt: "desc" }],
      take: 6,
    }),
    prisma.agreementItem.findMany({
      where: {
        version: { organizationId },
        OR: [
          { offiNumber: item.impaCode },
          { systemId: item.impaCode },
          { description: { contains: descriptionProbe, mode: "insensitive" as const } },
        ],
      },
      include: { version: true },
      orderBy: [{ updatedAt: "desc" }],
      take: 6,
    }),
    prisma.purchaseOrderLine.findMany({
      where: {
        order: { organizationId },
        OR: [
          { itemCode: item.impaCode },
          { description: { contains: descriptionProbe, mode: "insensitive" as const } },
        ],
      },
      include: { order: true },
      orderBy: [{ createdAt: "desc" }],
      take: 6,
    }),
    prisma.rfqLine.findMany({
      where: {
        rfq: { organizationId },
        OR: [
          { impaCode: item.impaCode },
          { description: { contains: descriptionProbe, mode: "insensitive" as const } },
          { normalizedDesc: { contains: normalize(descriptionProbe), mode: "insensitive" as const } },
        ],
      },
      include: { rfq: true, supplierQuotes: { include: { supplier: true }, take: 3 } },
      orderBy: [{ createdAt: "desc" }],
      take: 6,
    }),
  ]);

  const supplierNames = new Set<string>();
  for (const agreement of agreements) supplierNames.add(agreement.version.supplierName);
  for (const line of purchaseHistory) supplierNames.add(line.order.supplier);
  for (const line of rfqHistory) {
    for (const quote of line.supplierQuotes) supplierNames.add(quote.supplier.name);
  }

  return {
    item: mapItem(item, new Set(favorite ? [favorite.impaCode] : [])),
    context: {
      inventory: inventory.map((row) => ({
        id: row.id,
        itemCode: row.itemCode,
        description: row.description,
        warehouse: row.warehouse,
        locationBin: row.locationBin,
        uom: row.uom,
        onHand: row.onHand,
        reserved: row.reserved,
        available: Math.max(row.onHand - row.reserved, 0),
        stockStatus: row.onHand <= 0 ? "critical" : row.onHand <= row.reorderPoint ? "reorder" : "healthy",
      })),
      agreements: agreements.map((row) => ({
        id: row.id,
        supplierName: row.version.supplierName,
        status: row.version.status === "AgreementActive" ? "Active" : row.version.status.replace(/^Agreement/, ""),
        itemNumber: row.offiNumber || row.systemId || row.vendorPartNumber,
        description: row.description,
        unit: row.unit,
        unitPrice: row.markedUpPrice ?? row.basePrice,
        currency: row.currency,
        leadTimeDays: row.leadTimeDays,
      })),
      purchaseHistory: purchaseHistory.map((row) => ({
        id: row.id,
        purchaseOrderId: row.orderId,
        poNumber: row.order.poNumber,
        supplierName: row.order.supplier,
        vessel: row.order.vessel,
        port: row.order.port,
        description: row.description,
        quantity: row.qtyOrdered,
        unit: row.uom,
        unitPrice: row.unitPrice,
        currency: row.currency,
        lastPurchaseDate: row.createdAt.toISOString(),
      })),
      rfqHistory: rfqHistory.map((row) => {
        const bestQuote = [...row.supplierQuotes].sort((a, b) => a.unitPrice - b.unitPrice)[0];
        return {
          id: row.id,
          rfqId: row.rfqId,
          vessel: row.rfq.vessel,
          port: row.rfq.port,
          status: row.rfq.status,
          description: row.description,
          quantity: row.quantity,
          unit: row.unit,
          quotedSupplier: bestQuote?.supplier.name ?? null,
          quotedPrice: bestQuote?.unitPrice ?? null,
          currency: bestQuote?.currency ?? null,
          createdAt: row.createdAt.toISOString(),
        };
      }),
      supplierNames: [...supplierNames].slice(0, 8),
    },
  };
}
