import { Prisma, ProvenanceKind, type DataProvenance } from "@prisma/client";
import { matchesProvenanceMode, type ProvenanceMode } from "@/lib/erp-core/provenance";
import { prisma } from "@/lib/prisma";

export type CommandCenterMode = ProvenanceMode;

export interface CommandCenterOverviewOptions {
  mode?: CommandCenterMode;
  requestedMode?: string | null;
  organizationId?: string | null;
  organizationName?: string | null;
}

export interface CommandCenterMonthlyPoint {
  month: string;
  purchaseOrders: number;
  purchaseOrderValue: number;
  rfqs: number;
}

export interface CommandCenterOverview {
  mode: CommandCenterMode;
  generatedAt: string;
  scope: {
    organizationId: string | null;
    organizationName: string | null;
  };
  kpis: {
    openRfqs: number;
    atRiskPurchaseOrders: number;
    pendingApprovalOrders: number;
    backorderLines: number;
    lowMarginOrders: number;
    reorderItems: number;
    openExceptions: number;
    inTransitOrders: number;
    totalPurchaseOrderValue: { amount: number; currency: "EUR" };
    agentRuns: number;
    runningAgentRuns: number;
    pendingAgentApprovals: number;
    totalPurchaseOrders: number;
  };
  series: {
    procurementMonthly: CommandCenterMonthlyPoint[];
  };
  drilldowns: {
    atRiskPurchaseOrderIds: string[];
    pendingApprovalPurchaseOrderIds: string[];
    lowMarginPurchaseOrderIds: string[];
    reorderInventoryItemIds: string[];
    backorderLineIds: string[];
  };
  provenance: {
    mode: CommandCenterMode;
    requestedMode: string | null;
    usedDataProvenance: boolean;
    fallbackDetection: boolean;
    recordsEvaluated: number;
    recordsWithProvenance: number;
    notes: string[];
  };
}

type ProvenanceSubject = {
  id: string;
  source?: string | null;
  trigger?: string | null;
  metadata?: Prisma.JsonValue | null;
  parentId?: string | null;
  extraSignals?: Array<string | null | undefined>;
};

type ProvenanceStats = {
  recordsEvaluated: number;
  recordsWithProvenance: number;
  fallbackDetection: boolean;
};

const VALID_MODES = new Set<CommandCenterMode>(["operational", "demo", "screenshot", "test", "all"]);
const RECENT_AGENT_RUN_LIMIT = 20;
const MONTH_COUNT = 12;
const LOW_MARGIN_THRESHOLD = 10;

function roundCurrency(amount: number) {
  return Math.round((amount + Number.EPSILON) * 100) / 100;
}

export function parseCommandCenterMode(value: string | null | undefined): {
  mode: CommandCenterMode;
  requestedMode: string | null;
  fallbackApplied: boolean;
} {
  const requestedMode = value?.trim() || null;
  if (!requestedMode) return { mode: "operational", requestedMode, fallbackApplied: false };
  if (VALID_MODES.has(requestedMode as CommandCenterMode)) {
    return { mode: requestedMode as CommandCenterMode, requestedMode, fallbackApplied: false };
  }
  return { mode: "operational", requestedMode, fallbackApplied: true };
}

function fallbackKindForSubject(subject: ProvenanceSubject): ProvenanceKind {
  const haystack = [
    subject.id,
    subject.source,
    subject.trigger,
    subject.metadata ? JSON.stringify(subject.metadata) : null,
    ...(subject.extraSignals ?? []),
  ].filter(Boolean).join(" ").toLowerCase();

  if (haystack.includes("screenshot")) return ProvenanceKind.Screenshot;
  if (haystack.includes("demo_seed") || haystack.includes("seed")) return ProvenanceKind.Seed;
  if (haystack.includes("demo_upload") || haystack.includes("demo")) return ProvenanceKind.Demo;
  return ProvenanceKind.Operational;
}

function matchesModeFromKind(kind: ProvenanceKind, mode: CommandCenterMode) {
  if (mode === "all") return true;
  return matchesProvenanceMode(kind, mode);
}

function buildProvenanceFilter(
  mode: CommandCenterMode,
  provenanceMaps: Record<string, Map<string, DataProvenance>>,
  stats: ProvenanceStats,
) {
  return (entityType: string, subject: ProvenanceSubject) => {
    stats.recordsEvaluated += 1;
    const lookupId = subject.parentId ?? subject.id;
    const row = provenanceMaps[entityType]?.get(lookupId);
    if (row) {
      stats.recordsWithProvenance += 1;
      return matchesModeFromKind(row.kind, mode);
    }

    stats.fallbackDetection = true;
    return matchesModeFromKind(fallbackKindForSubject(subject), mode);
  };
}

function startOfMonth(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function addMonths(date: Date, months: number) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1));
}

function monthKey(date: Date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function recentMonthKeys(now = new Date()) {
  const firstMonth = addMonths(startOfMonth(now), -(MONTH_COUNT - 1));
  return Array.from({ length: MONTH_COUNT }, (_, index) => monthKey(addMonths(firstMonth, index)));
}

async function loadProvenanceMaps(requests: Record<string, string[]>) {
  const entries = await Promise.all(Object.entries(requests).map(async ([entityType, ids]) => {
    const uniqueIds = Array.from(new Set(ids.filter(Boolean)));
    if (uniqueIds.length === 0) return [entityType, new Map<string, DataProvenance>()] as const;
    const rows = await prisma.dataProvenance.findMany({
      where: { entityType, entityId: { in: uniqueIds } },
    });
    return [entityType, new Map(rows.map((row) => [row.entityId, row]))] as const;
  }));

  return Object.fromEntries(entries) as Record<string, Map<string, DataProvenance>>;
}

export async function getCommandCenterOverview(options: CommandCenterOverviewOptions = {}): Promise<CommandCenterOverview> {
  const mode = options.mode ?? "operational";
  const monthKeys = recentMonthKeys();
  const oldestMonth = `${monthKeys[0]}-01T00:00:00.000Z`;
  const monthlySince = new Date(oldestMonth);
  const organizationWhere = options.organizationId ? { organizationId: options.organizationId } : {};

  const [
    purchaseOrders,
    monthlyPurchaseOrders,
    backorderLines,
    rfqs,
    monthlyRfqs,
    reorderInventoryItems,
    agentRuns,
    pendingApprovals,
    agentExceptions,
    financeExceptions,
  ] = await Promise.all([
    prisma.purchaseOrder.findMany({
      where: organizationWhere,
      select: { id: true, poNumber: true, status: true, total: true, marginPct: true, createdAt: true },
    }),
    prisma.purchaseOrder.findMany({
      where: { ...organizationWhere, createdAt: { gte: monthlySince } },
      select: { id: true, total: true, createdAt: true },
    }),
    prisma.purchaseOrderLine.findMany({
      where: {
        status: "Backordered",
        ...(options.organizationId ? { order: { organizationId: options.organizationId } } : {}),
      },
      select: { id: true, orderId: true, order: { select: { id: true, poNumber: true } } },
    }),
    prisma.rfq.findMany({
      where: organizationWhere,
      select: { id: true, status: true, source: true, createdAt: true },
    }),
    prisma.rfq.findMany({
      where: { ...organizationWhere, createdAt: { gte: monthlySince } },
      select: { id: true, source: true, createdAt: true },
    }),
    prisma.inventoryItem.findMany({
      where: organizationWhere,
      select: { id: true, itemCode: true, onHand: true, reorderPoint: true },
    }),
    prisma.agentRun.findMany({
      where: organizationWhere,
      select: { id: true, status: true, trigger: true, startedAt: true },
      orderBy: { startedAt: "desc" },
      take: RECENT_AGENT_RUN_LIMIT,
    }),
    prisma.approval.findMany({
      where: {
        status: "Pending",
        ...(options.organizationId ? { task: { run: { organizationId: options.organizationId } } } : {}),
      },
      select: {
        id: true,
        status: true,
        task: { select: { run: { select: { id: true, trigger: true } } } },
      },
    }),
    prisma.agentException.findMany({
      where: { status: { in: ["Open", "Reviewing"] }, ...organizationWhere },
      select: {
        id: true,
        status: true,
        task: { select: { run: { select: { id: true, trigger: true } } } },
      },
    }),
    prisma.financeException.findMany({
      where: { status: { in: ["Open", "InReview"] }, ...organizationWhere },
      select: { id: true, status: true, title: true },
    }),
  ]);

  const provenanceMaps = await loadProvenanceMaps({
    PurchaseOrder: [
      ...purchaseOrders.map((row) => row.id),
      ...monthlyPurchaseOrders.map((row) => row.id),
      ...backorderLines.map((row) => row.orderId),
    ],
    Rfq: [...rfqs.map((row) => row.id), ...monthlyRfqs.map((row) => row.id)],
    InventoryItem: reorderInventoryItems.map((row) => row.id),
    AgentRun: [
      ...agentRuns.map((row) => row.id),
      ...pendingApprovals.map((row) => row.task.run.id),
      ...agentExceptions.map((row) => row.task?.run.id).filter((id): id is string => Boolean(id)),
    ],
    AgentException: agentExceptions.map((row) => row.id),
    FinanceException: financeExceptions.map((row) => row.id),
    Approval: pendingApprovals.map((row) => row.id),
  });

  const provenanceStats: ProvenanceStats = {
    recordsEvaluated: 0,
    recordsWithProvenance: 0,
    fallbackDetection: false,
  };
  const include = buildProvenanceFilter(mode, provenanceMaps, provenanceStats);

  const filteredPurchaseOrders = purchaseOrders.filter((row) => include("PurchaseOrder", { id: row.id, extraSignals: [row.poNumber] }));
  const filteredMonthlyPurchaseOrders = monthlyPurchaseOrders.filter((row) => include("PurchaseOrder", { id: row.id }));
  const filteredRfqs = rfqs.filter((row) => include("Rfq", { id: row.id, source: row.source }));
  const filteredMonthlyRfqs = monthlyRfqs.filter((row) => include("Rfq", { id: row.id, source: row.source }));
  const filteredBackorderLines = backorderLines.filter((row) =>
    include("PurchaseOrder", { id: row.id, parentId: row.orderId, extraSignals: [row.order.poNumber] })
  );
  const filteredReorderItems = reorderInventoryItems
    .filter((row) => row.onHand <= row.reorderPoint)
    .filter((row) => include("InventoryItem", { id: row.id, extraSignals: [row.itemCode] }));
  const filteredAgentRuns = agentRuns.filter((row) => include("AgentRun", { id: row.id, trigger: row.trigger }));
  const filteredPendingApprovals = pendingApprovals.filter((row) =>
    include("Approval", { id: row.id, parentId: row.id, trigger: row.task.run.trigger }) &&
    include("AgentRun", { id: row.task.run.id, trigger: row.task.run.trigger })
  );
  const filteredAgentExceptions = agentExceptions.filter((row) =>
    include("AgentException", { id: row.id, trigger: row.task?.run.trigger }) &&
    (!row.task?.run.id || include("AgentRun", { id: row.task.run.id, trigger: row.task.run.trigger }))
  );
  const filteredFinanceExceptions = financeExceptions.filter((row) =>
    include("FinanceException", { id: row.id, extraSignals: [row.title] })
  );

  const atRiskPurchaseOrders = filteredPurchaseOrders.filter((row) => row.status === "At_Risk");
  const pendingApprovalOrders = filteredPurchaseOrders.filter((row) => row.status === "Pending_Approval");
  const inTransitOrders = filteredPurchaseOrders.filter((row) => row.status === "In_Transit");
  const lowMarginOrders = filteredPurchaseOrders.filter((row) => row.marginPct < LOW_MARGIN_THRESHOLD);
  const openRfqs = filteredRfqs.filter((row) => row.status !== "Awarded");
  const runningAgentRuns = filteredAgentRuns.filter((row) => row.status === "Running" || row.status === "AwaitingApproval");

  const seriesByMonth = new Map(monthKeys.map((key) => [key, {
    month: key,
    purchaseOrders: 0,
    purchaseOrderValue: 0,
    rfqs: 0,
  } satisfies CommandCenterMonthlyPoint]));

  for (const order of filteredMonthlyPurchaseOrders) {
    const point = seriesByMonth.get(monthKey(order.createdAt));
    if (!point) continue;
    point.purchaseOrders += 1;
    point.purchaseOrderValue += order.total;
  }

  for (const rfq of filteredMonthlyRfqs) {
    const point = seriesByMonth.get(monthKey(rfq.createdAt));
    if (!point) continue;
    point.rfqs += 1;
  }

  const notes = [
    options.requestedMode && options.requestedMode !== mode ? `Invalid mode "${options.requestedMode}" fell back to operational.` : null,
    provenanceStats.recordsWithProvenance > 0 ? "DataProvenance records were used where available." : "No matching DataProvenance rows were found for evaluated records.",
    provenanceStats.fallbackDetection ? "Fallback demo/seed/screenshot detection was used for records without provenance." : null,
  ].filter((note): note is string => Boolean(note));

  return {
    mode,
    generatedAt: new Date().toISOString(),
    scope: {
      organizationId: options.organizationId ?? null,
      organizationName: options.organizationName ?? null,
    },
    kpis: {
      openRfqs: openRfqs.length,
      atRiskPurchaseOrders: atRiskPurchaseOrders.length,
      pendingApprovalOrders: pendingApprovalOrders.length,
      backorderLines: filteredBackorderLines.length,
      lowMarginOrders: lowMarginOrders.length,
      reorderItems: filteredReorderItems.length,
      openExceptions: filteredAgentExceptions.length + filteredFinanceExceptions.length,
      inTransitOrders: inTransitOrders.length,
      totalPurchaseOrderValue: {
        amount: roundCurrency(filteredPurchaseOrders.reduce((sum, row) => sum + row.total, 0)),
        currency: "EUR",
      },
      agentRuns: filteredAgentRuns.length,
      runningAgentRuns: runningAgentRuns.length,
      pendingAgentApprovals: filteredPendingApprovals.length,
      totalPurchaseOrders: filteredPurchaseOrders.length,
    },
    series: {
      procurementMonthly: Array.from(seriesByMonth.values()).map((point) => ({
        ...point,
        purchaseOrderValue: roundCurrency(point.purchaseOrderValue),
      })),
    },
    drilldowns: {
      atRiskPurchaseOrderIds: atRiskPurchaseOrders.map((row) => row.id),
      pendingApprovalPurchaseOrderIds: pendingApprovalOrders.map((row) => row.id),
      lowMarginPurchaseOrderIds: lowMarginOrders.map((row) => row.id),
      reorderInventoryItemIds: filteredReorderItems.map((row) => row.id),
      backorderLineIds: filteredBackorderLines.map((row) => row.id),
    },
    provenance: {
      mode,
      requestedMode: options.requestedMode ?? null,
      usedDataProvenance: provenanceStats.recordsWithProvenance > 0,
      fallbackDetection: provenanceStats.fallbackDetection,
      recordsEvaluated: provenanceStats.recordsEvaluated,
      recordsWithProvenance: provenanceStats.recordsWithProvenance,
      notes,
    },
  };
}
