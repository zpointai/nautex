import { OrganizationDataMode, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export type ExceptionSource = "agent" | "finance";
export type ExceptionDataSource = "production" | "demo" | "mixed";
export type ExceptionAction = "review" | "resolve" | "dismiss" | "reopen";

export interface ExceptionFilters {
  status?: string;
  severity?: string;
  domain?: string;
  source?: string;
  objectType?: string;
  creator?: string;
  overdue?: string;
  risk?: string;
  dateRange?: string;
  q?: string;
  sort?: string;
  limit?: number;
}

export interface ExceptionLinkedObject {
  type: string;
  id: string | null;
  label: string;
  module: string;
}

export interface ExceptionAuditEvent {
  id: string;
  action: string;
  actor: string;
  createdAt: string;
  previousStatus: string | null;
  newStatus: string | null;
  note: string | null;
}

export interface OperationalException {
  id: string;
  source: ExceptionSource;
  sourceId: string;
  dataSource: ExceptionDataSource;
  title: string;
  description: string;
  severity: string;
  severityRank: number;
  status: string;
  domain: string;
  module: string;
  createdBy: string;
  creatorType: "agent" | "workflow" | "user" | "system";
  createdAt: string;
  ageHours: number;
  ageLabel: string;
  reviewBy: string | null;
  overdue: boolean;
  confidence: number | null;
  riskScore: number | null;
  riskLevel: string;
  financialImpact: number | null;
  recommendedAction: string | null;
  linkedObject: ExceptionLinkedObject;
  relatedAgentRunId: string | null;
  relatedTaskId: string | null;
  reason: string;
  evidence: string[];
  allowedActions: ExceptionAction[];
  restrictedActions: string[];
  auditTimeline: ExceptionAuditEvent[];
  resolvedBy: string | null;
  resolvedAt: string | null;
}

export interface ExceptionSummary {
  open: number;
  critical: number;
  warnings: number;
  awaitingReview: number;
  overdue: number;
  resolvedToday: number;
  linkedAgent: number;
  highFinancialImpact: number;
  total: number;
}

export interface ExceptionListResult {
  summary: ExceptionSummary;
  exceptions: OperationalException[];
  filters: {
    severities: string[];
    statuses: string[];
    domains: string[];
    sources: string[];
    objectTypes: string[];
    creators: string[];
  };
  generatedAt: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function firstString(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function numberOrNull(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function jsonInput(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function humanize(value: string) {
  return value
    .replace(/_/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function moduleLabel(domain: string) {
  const labels: Record<string, string> = {
    procurement: "RFQ / Procurement",
    purchase_orders: "Purchase Orders",
    validation: "Validator",
    classification: "HS Codes",
    backorders: "Backorders",
    finance: "Finance",
    agreements: "Agreements",
    inventory: "Inventory",
    logistics: "Logistics",
    system: "Command Center",
  };
  return labels[domain] ?? humanize(domain);
}

function severityRank(severity: string) {
  const ranks: Record<string, number> = {
    Critical: 5,
    High: 4,
    Warning: 3,
    Medium: 3,
    Low: 2,
    Info: 1,
  };
  return ranks[severity] ?? 2;
}

function riskLevel(score: number | null, severity: string) {
  if (score != null) {
    if (score >= 85) return "Critical";
    if (score >= 70) return "High";
    if (score >= 40) return "Medium";
    return "Low";
  }
  if (severity === "Critical" || severity === "High") return severity;
  if (severity === "Warning" || severity === "Medium") return "Medium";
  return "Low";
}

function ageParts(createdAt: Date) {
  const ageHours = Math.max(0, Math.floor((Date.now() - createdAt.getTime()) / 3600000));
  if (ageHours < 1) return { ageHours, ageLabel: "Under 1h" };
  if (ageHours < 24) return { ageHours, ageLabel: `${ageHours}h` };
  return { ageHours, ageLabel: `${Math.floor(ageHours / 24)}d` };
}

function dateRangeStart(range?: string) {
  const now = new Date();
  if (range === "today") {
    now.setHours(0, 0, 0, 0);
    return now;
  }
  if (range === "7d") return new Date(now.getTime() - 7 * 86400000);
  if (range === "30d") return new Date(now.getTime() - 30 * 86400000);
  return null;
}

function businessLinkFromPayload(input: unknown, output: unknown, commandText?: string | null, fallback?: ExceptionLinkedObject): ExceptionLinkedObject {
  const inRecord = isRecord(input) ? input : {};
  const outRecord = isRecord(output) ? output : {};
  const rawCommand = firstString(commandText, inRecord.rawCommand, outRecord.rawCommand);

  const poNumber = firstString(outRecord.poNumber, inRecord.poNumber);
  const purchaseOrderId = firstString(outRecord.purchaseOrderId, inRecord.purchaseOrderId);
  if (poNumber || purchaseOrderId) return { type: "PO", id: purchaseOrderId, label: poNumber ?? purchaseOrderId ?? "Purchase order", module: "Purchase Orders" };

  const rfqId = firstString(outRecord.rfqId, inRecord.rfqId);
  if (rfqId) return { type: "RFQ", id: rfqId, label: rfqId, module: "RFQ Automation" };

  const supplierCode = firstString(outRecord.supplierCode, inRecord.supplierCode);
  const supplierId = firstString(outRecord.supplierId, inRecord.supplierId);
  if (supplierCode || supplierId) return { type: "Supplier", id: supplierId, label: supplierCode ?? supplierId ?? "Supplier", module: "Suppliers" };

  const invoiceNo = firstString(outRecord.invoiceNo, outRecord.supplierInvoiceNo, inRecord.invoiceNo, inRecord.supplierInvoiceNo);
  if (invoiceNo) return { type: "Invoice", id: null, label: invoiceNo, module: "Finance" };

  const hsCode = firstString(outRecord.hsCode, outRecord.hs_code, inRecord.hsCode);
  if (hsCode) return { type: "HS", id: hsCode, label: hsCode, module: "HS Codes" };

  const validationRunId = firstString(outRecord.validationRunId, inRecord.validationRunId);
  if (validationRunId) return { type: "Validation", id: validationRunId, label: validationRunId, module: "Validator" };

  const commandPo = rawCommand?.match(/\b(?:NAX-PO|PO)[A-Z0-9-]*\b/i)?.[0];
  if (commandPo) return { type: "PO", id: null, label: commandPo, module: "Purchase Orders" };

  return fallback ?? { type: "Unknown", id: null, label: "No linked object", module: "Exceptions" };
}

function evidenceFromPayload(input: unknown, output: unknown, description: string) {
  const inRecord = isRecord(input) ? input : {};
  const outRecord = isRecord(output) ? output : {};
  const evidence = [
    firstString(outRecord.finding, outRecord.summary, outRecord.message),
    firstString(inRecord.poNumber, outRecord.poNumber) ? `Purchase order reference: ${firstString(inRecord.poNumber, outRecord.poNumber)}` : null,
    firstString(inRecord.supplierName, outRecord.supplierName) ? `Supplier: ${firstString(inRecord.supplierName, outRecord.supplierName)}` : null,
    firstString(inRecord.invoiceNo, outRecord.invoiceNo, outRecord.supplierInvoiceNo) ? `Invoice reference: ${firstString(inRecord.invoiceNo, outRecord.invoiceNo, outRecord.supplierInvoiceNo)}` : null,
  ].filter((item): item is string => Boolean(item));
  return evidence.length ? evidence : [description];
}

function auditFromAgentLog(log: { id: string; action: string; agent: string; createdAt: Date; input: Prisma.JsonValue; output: Prisma.JsonValue }): ExceptionAuditEvent {
  const input = isRecord(log.input) ? log.input : {};
  const output = isRecord(log.output) ? log.output : {};
  return {
    id: log.id,
    action: humanize(log.action),
    actor: firstString(output.resolvedBy, output.actor, input.actor, log.agent) ?? "system",
    createdAt: log.createdAt.toISOString(),
    previousStatus: firstString(input.previousStatus),
    newStatus: firstString(output.status),
    note: firstString(output.note, output.reason, output.resolutionNote),
  };
}

function auditFromFinanceLog(log: { id: string; action: string; actorType: string; actorId: string | null; createdAt: Date; before: Prisma.JsonValue | null; after: Prisma.JsonValue | null; metadata: Prisma.JsonValue }): ExceptionAuditEvent {
  const before = isRecord(log.before) ? log.before : {};
  const after = isRecord(log.after) ? log.after : {};
  const metadata = isRecord(log.metadata) ? log.metadata : {};
  return {
    id: log.id,
    action: humanize(firstString(metadata.action, log.action) ?? log.action),
    actor: log.actorId ?? log.actorType,
    createdAt: log.createdAt.toISOString(),
    previousStatus: firstString(before.status),
    newStatus: firstString(after.status),
    note: firstString(metadata.note, metadata.reason, metadata.resolutionNote),
  };
}

function allowedActionsFor(status: string): ExceptionAction[] {
  if (status === "Resolved" || status === "Dismissed") return ["reopen"];
  if (status === "Reviewing" || status === "InReview") return ["resolve", "dismiss"];
  return ["review", "resolve", "dismiss"];
}

async function buildAgentExceptions(
  filters: ExceptionFilters,
  organizationId: string,
  dataSource: ExceptionDataSource,
): Promise<OperationalException[]> {
  const createdAfter = dateRangeStart(filters.dateRange);
  const where: Prisma.AgentExceptionWhereInput = { organizationId };
  if (createdAfter) where.createdAt = { gte: createdAfter };

  const rows = await prisma.agentException.findMany({
    where,
    include: {
      task: {
        include: {
          run: true,
        },
      },
    },
    orderBy: { createdAt: "desc" },
    take: 250,
  });

  const runIds = rows.map((row) => row.task?.runId).filter((id): id is string => Boolean(id));
  const exceptionIds = rows.map((row) => row.id);
  const auditLogs = await prisma.auditLog.findMany({
    where: {
      OR: [
        { target: { in: exceptionIds } },
        runIds.length ? { runId: { in: runIds }, action: { startsWith: "exception_" } } : {},
      ],
    },
    orderBy: { createdAt: "desc" },
    take: 500,
  });
  const auditByTarget = new Map<string, typeof auditLogs>();
  for (const log of auditLogs) {
    if (!log.target) continue;
    const existing = auditByTarget.get(log.target) ?? [];
    existing.push(log);
    auditByTarget.set(log.target, existing);
  }

  return rows.map((row) => {
    const task = row.task;
    const run = task?.run;
    const input = task?.input ?? {};
    const output = task?.output ?? {};
    const confidence = numberOrNull(task?.confidence);
    const outputRecord = isRecord(output) ? output : {};
    const riskText = firstString(outputRecord.risk);
    const riskScore = numberOrNull(outputRecord.riskScore) ?? (confidence == null ? null : Math.round((1 - confidence) * 100));
    const reviewBy = firstString(outputRecord.reviewBy, outputRecord.dueDate);
    const reviewByDate = reviewBy ? new Date(reviewBy) : null;
    const { ageHours, ageLabel } = ageParts(row.createdAt);
    const linkedObject = task
      ? businessLinkFromPayload(input, output, run?.commandText)
      : { type: "Exception", id: row.id, label: row.title, module: moduleLabel(row.domain) };

    return {
      id: `agent:${row.id}`,
      source: "agent",
      sourceId: row.id,
      dataSource,
      title: row.title,
      description: row.description,
      severity: row.severity,
      severityRank: severityRank(row.severity),
      status: row.status,
      domain: row.domain,
      module: moduleLabel(row.domain),
      createdBy: row.agent,
      creatorType: "agent",
      createdAt: row.createdAt.toISOString(),
      ageHours,
      ageLabel,
      reviewBy: reviewByDate && !Number.isNaN(reviewByDate.getTime()) ? reviewByDate.toISOString() : null,
      overdue: reviewByDate ? reviewByDate.getTime() < Date.now() && row.status !== "Resolved" && row.status !== "Dismissed" : ageHours >= 48 && row.status !== "Resolved" && row.status !== "Dismissed",
      confidence,
      riskScore,
      riskLevel: riskText ? humanize(riskText) : riskLevel(riskScore, row.severity),
      financialImpact: numberOrNull(outputRecord.financialImpact),
      recommendedAction: row.suggestedAction,
      linkedObject,
      relatedAgentRunId: run?.id ?? null,
      relatedTaskId: task?.id ?? null,
      reason: firstString(outputRecord.reason, outputRecord.error, task?.error) ?? row.description,
      evidence: evidenceFromPayload(input, output, row.description),
      allowedActions: allowedActionsFor(row.status),
      restrictedActions: [
        "No autonomous supplier/customer email sending",
        "No invoice, payment, credit note, quote, PO, agreement, or HS final approval",
      ],
      auditTimeline: [
        {
          id: `${row.id}:created`,
          action: "Exception Created",
          actor: row.agent,
          createdAt: row.createdAt.toISOString(),
          previousStatus: null,
          newStatus: row.status,
          note: null,
        },
        ...(auditByTarget.get(row.id) ?? []).map(auditFromAgentLog),
      ],
      resolvedBy: row.resolvedBy,
      resolvedAt: row.resolvedAt?.toISOString() ?? null,
    };
  });
}

async function buildFinanceExceptions(
  filters: ExceptionFilters,
  organizationId: string,
  dataSource: ExceptionDataSource,
): Promise<OperationalException[]> {
  const createdAfter = dateRangeStart(filters.dateRange);
  const where: Prisma.FinanceExceptionWhereInput = { organizationId };
  if (createdAfter) where.createdAt = { gte: createdAfter };

  const rows = await prisma.financeException.findMany({
    where,
    include: { order: true, customerInvoice: true, supplierInvoice: true, creditNote: true },
    orderBy: { createdAt: "desc" },
    take: 250,
  });

  const ids = rows.map((row) => row.id);
  const auditLogs = ids.length
    ? await prisma.financeAuditEvent.findMany({
        where: { organizationId, entityType: "FinanceException", entityId: { in: ids } },
        orderBy: { createdAt: "desc" },
        take: 500,
      })
    : [];
  const auditByEntity = new Map<string, typeof auditLogs>();
  for (const log of auditLogs) {
    const existing = auditByEntity.get(log.entityId) ?? [];
    existing.push(log);
    auditByEntity.set(log.entityId, existing);
  }

  return rows.map((row) => {
    const reference = row.customerInvoice?.invoiceNo ?? row.supplierInvoice?.supplierInvoiceNo ?? row.creditNote?.creditNoteNo ?? row.order?.poNumber ?? row.id;
    const type = row.customerInvoice ? "Customer Invoice" : row.supplierInvoice ? "Supplier Invoice" : row.creditNote ? "Credit Note" : row.order ? "PO" : "Finance";
    const dueDate = row.customerInvoice?.dueDate ?? row.supplierInvoice?.dueDate ?? null;
    const amount = row.customerInvoice?.outstandingAmount ?? row.supplierInvoice?.varianceAmount ?? row.creditNote?.grossAmount ?? null;
    const { ageHours, ageLabel } = ageParts(row.createdAt);
    const status = row.status === "InReview" ? "Reviewing" : row.status;
    const numericImpact = amount ? Number(amount) : null;

    return {
      id: `finance:${row.id}`,
      source: "finance",
      sourceId: row.id,
      dataSource,
      title: row.title,
      description: row.description,
      severity: row.severity,
      severityRank: severityRank(row.severity),
      status,
      domain: "finance",
      module: "Finance",
      createdBy: "finance_controls",
      creatorType: "workflow",
      createdAt: row.createdAt.toISOString(),
      ageHours,
      ageLabel,
      reviewBy: dueDate?.toISOString() ?? null,
      overdue: Boolean(dueDate && dueDate.getTime() < Date.now() && row.status !== "Resolved" && row.status !== "Dismissed"),
      confidence: null,
      riskScore: row.severity === "High" ? 80 : row.severity === "Medium" ? 55 : 30,
      riskLevel: riskLevel(row.severity === "High" ? 80 : row.severity === "Medium" ? 55 : 30, row.severity),
      financialImpact: numericImpact,
      recommendedAction: financeRecommendation(row.type),
      linkedObject: { type, id: row.orderId ?? row.customerInvoiceId ?? row.supplierInvoiceId ?? row.creditNoteId ?? null, label: reference, module: "Finance" },
      relatedAgentRunId: null,
      relatedTaskId: null,
      reason: humanize(row.type),
      evidence: [row.description, `Reference: ${reference}`],
      allowedActions: allowedActionsFor(status),
      restrictedActions: [
        "No invoice approval or supplier payment approval",
        "No credit note issuance",
        "No accounting export or customer communication",
      ],
      auditTimeline: [
        {
          id: `${row.id}:created`,
          action: "Exception Created",
          actor: "finance_controls",
          createdAt: row.createdAt.toISOString(),
          previousStatus: null,
          newStatus: status,
          note: null,
        },
        ...(auditByEntity.get(row.id) ?? []).map(auditFromFinanceLog),
      ],
      resolvedBy: null,
      resolvedAt: row.resolvedAt?.toISOString() ?? null,
    };
  });
}

function financeRecommendation(type: string) {
  const recommendations: Record<string, string> = {
    SupplierInvoicePriceVariance: "Open the supplier invoice match, verify agreed price and goods receipt, then approve or reject in Finance.",
    SupplierInvoiceQuantityVariance: "Compare supplier invoice quantity against PO lines and delivery evidence before finance approval.",
    CustomerInvoiceOverdue: "Review payment status, customer communication history, and escalation policy before taking collection action.",
    DeliveredOrderNotInvoiced: "Verify delivery evidence and prepare customer invoice from the Finance module.",
    MarginBelowThreshold: "Review order margin drivers before approving quote, invoice, or commercial correction.",
    MissingDeliveryEvidence: "Open SLA Evidence and attach or request delivery proof before finance posting.",
    DuplicateSupplierInvoiceRisk: "Compare supplier invoice number, amount, supplier, and PO before any payment approval.",
    CreditNoteAwaitingApproval: "Review credit note reason, original invoice, and approval authority before issue.",
    VatDataIncomplete: "Review VAT category and legal invoice fields before posting/export.",
    InvoiceMissingLegalField: "Complete required legal invoice fields before posting/export.",
  };
  return recommendations[type] ?? "Review the finance control record before changing business documents.";
}

function applyFilters(rows: OperationalException[], filters: ExceptionFilters) {
  const q = filters.q?.trim().toLowerCase();
  return rows.filter((row) => {
    if (filters.status && filters.status !== "all" && row.status !== filters.status) return false;
    if (filters.severity && filters.severity !== "all" && row.severity !== filters.severity) return false;
    if (filters.domain && filters.domain !== "all" && row.domain !== filters.domain) return false;
    if (filters.source && filters.source !== "all" && row.source !== filters.source) return false;
    if (filters.objectType && filters.objectType !== "all" && row.linkedObject.type !== filters.objectType) return false;
    if (filters.creator && filters.creator !== "all" && row.creatorType !== filters.creator && row.createdBy !== filters.creator) return false;
    if (filters.overdue === "true" && !row.overdue) return false;
    if (filters.risk && filters.risk !== "all" && row.riskLevel !== filters.risk) return false;
    if (q) {
      const haystack = [
        row.title,
        row.description,
        row.domain,
        row.module,
        row.createdBy,
        row.linkedObject.label,
        row.linkedObject.id,
        row.linkedObject.type,
        row.recommendedAction,
      ].filter(Boolean).join(" ").toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });
}

function sortRows(rows: OperationalException[], sort = "severity") {
  return [...rows].sort((a, b) => {
    if (sort === "newest") return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    if (sort === "oldest") return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    if (sort === "age") return b.ageHours - a.ageHours;
    if (sort === "risk") return (b.riskScore ?? 0) - (a.riskScore ?? 0);
    if (sort === "module") return a.module.localeCompare(b.module);
    if (sort === "status") return a.status.localeCompare(b.status);
    return b.severityRank - a.severityRank || Number(b.overdue) - Number(a.overdue) || new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });
}

function buildSummary(allRows: OperationalException[]): ExceptionSummary {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const openStatuses = new Set(["Open", "Reviewing", "InReview"]);
  return {
    open: allRows.filter((row) => openStatuses.has(row.status)).length,
    critical: allRows.filter((row) => row.severity === "Critical" || row.riskLevel === "Critical").length,
    warnings: allRows.filter((row) => ["Warning", "Medium", "High"].includes(row.severity)).length,
    awaitingReview: allRows.filter((row) => row.status === "Reviewing" || row.status === "Open").length,
    overdue: allRows.filter((row) => row.overdue).length,
    resolvedToday: allRows.filter((row) => row.resolvedAt && new Date(row.resolvedAt) >= today).length,
    linkedAgent: allRows.filter((row) => row.relatedAgentRunId || row.source === "agent").length,
    highFinancialImpact: allRows.filter((row) => (row.financialImpact ?? 0) >= 1000 || row.domain === "finance" && ["Critical", "High"].includes(row.riskLevel)).length,
    total: allRows.length,
  };
}

function uniqueSorted(values: string[]) {
  return Array.from(new Set(values.filter(Boolean))).sort((a, b) => a.localeCompare(b));
}

export async function listOperationalExceptions(filters: ExceptionFilters, organizationId: string): Promise<ExceptionListResult> {
  const organization = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { dataMode: true },
  });
  const dataSource: ExceptionDataSource = organization?.dataMode === OrganizationDataMode.Operational
    ? "production"
    : "demo";
  const [agentRows, financeRows] = await Promise.all([
    filters.source && filters.source !== "all" && filters.source !== "agent" ? Promise.resolve([]) : buildAgentExceptions(filters, organizationId, dataSource),
    filters.source && filters.source !== "all" && filters.source !== "finance" ? Promise.resolve([]) : buildFinanceExceptions(filters, organizationId, dataSource),
  ]);

  const allRows = [...agentRows, ...financeRows];
  const filtered = applyFilters(allRows, filters);
  const sorted = sortRows(filtered, filters.sort);
  const limited = sorted.slice(0, Math.min(filters.limit ?? 100, 250));

  return {
    summary: buildSummary(allRows),
    exceptions: limited,
    filters: {
      severities: uniqueSorted(allRows.map((row) => row.severity)),
      statuses: uniqueSorted(allRows.map((row) => row.status)),
      domains: uniqueSorted(allRows.map((row) => row.domain)),
      sources: uniqueSorted(allRows.map((row) => row.source)),
      objectTypes: uniqueSorted(allRows.map((row) => row.linkedObject.type)),
      creators: uniqueSorted([...allRows.map((row) => row.creatorType), ...allRows.map((row) => row.createdBy)]),
    },
    generatedAt: new Date().toISOString(),
  };
}

export async function updateOperationalException(params: {
  organizationId: string;
  id: string;
  action: ExceptionAction;
  actor?: string;
  note?: string;
  reason?: string;
}) {
  const [source, sourceId] = params.id.includes(":") ? params.id.split(":", 2) : ["agent", params.id];
  if (!sourceId || !["agent", "finance"].includes(source)) throw new Error("EXCEPTION_NOT_FOUND");
  if (!["review", "resolve", "dismiss", "reopen"].includes(params.action)) throw new Error("INVALID_ACTION");
  if ((params.action === "resolve" || params.action === "dismiss") && !firstString(params.note, params.reason)) throw new Error("ACTION_REASON_REQUIRED");

  if (source === "finance") return updateFinanceException(sourceId, params);
  return updateAgentException(sourceId, params);
}

async function updateAgentException(sourceId: string, params: { organizationId: string; action: ExceptionAction; actor?: string; note?: string; reason?: string }) {
  const statusMap = {
    review: "Reviewing" as const,
    resolve: "Resolved" as const,
    dismiss: "Dismissed" as const,
    reopen: "Open" as const,
  };
  const actor = params.actor || "operator";
  const now = new Date();

  await prisma.$transaction(async (tx) => {
    const current = await tx.agentException.findFirst({
      where: { id: sourceId, organizationId: params.organizationId },
      include: { task: { select: { id: true, runId: true, action: true } } },
    });
    if (!current) throw new Error("EXCEPTION_NOT_FOUND");
    if (!allowedActionsFor(current.status).includes(params.action)) throw new Error("ACTION_NOT_ALLOWED");

    const nextStatus = statusMap[params.action];
    const updated = await tx.agentException.update({
      where: { id: sourceId },
      data: {
        status: nextStatus,
        resolvedBy: params.action === "resolve" || params.action === "dismiss" ? actor : params.action === "reopen" ? null : undefined,
        resolvedAt: params.action === "resolve" || params.action === "dismiss" ? now : params.action === "reopen" ? null : undefined,
      },
    });

    await tx.auditLog.create({
      data: {
        runId: current.task?.runId ?? null,
        agent: current.agent,
        action: `exception_${params.action}`,
        target: sourceId,
        input: jsonInput({
          exceptionId: sourceId,
          taskId: current.taskId,
          taskAction: current.task?.action,
          previousStatus: current.status,
          actor,
        }),
        output: jsonInput({
          status: updated.status,
          actor,
          resolvedBy: params.action === "resolve" || params.action === "dismiss" ? actor : null,
          resolvedAt: params.action === "resolve" || params.action === "dismiss" ? now.toISOString() : null,
          note: params.note ?? null,
          reason: params.reason ?? null,
        }),
        committed: false,
      },
    });
  });

  return listOperationalExceptions({ q: undefined, limit: 100 }, params.organizationId);
}

async function updateFinanceException(sourceId: string, params: { organizationId: string; action: ExceptionAction; actor?: string; note?: string; reason?: string }) {
  const statusMap = {
    review: "InReview" as const,
    resolve: "Resolved" as const,
    dismiss: "Dismissed" as const,
    reopen: "Open" as const,
  };
  const actor = params.actor || "operator";
  const now = new Date();

  await prisma.$transaction(async (tx) => {
    const current = await tx.financeException.findFirst({ where: { id: sourceId, organizationId: params.organizationId } });
    if (!current) throw new Error("EXCEPTION_NOT_FOUND");
    const currentStatus = current.status === "InReview" ? "Reviewing" : current.status;
    if (!allowedActionsFor(currentStatus).includes(params.action)) throw new Error("ACTION_NOT_ALLOWED");

    const updated = await tx.financeException.update({
      where: { id: sourceId },
      data: {
        organizationId: params.organizationId,
        status: statusMap[params.action],
        resolvedAt: params.action === "resolve" || params.action === "dismiss" ? now : params.action === "reopen" ? null : undefined,
      },
    });

    await tx.financeAuditEvent.create({
      data: {
        organizationId: params.organizationId,
        entityType: "FinanceException",
        entityId: sourceId,
        action: params.action === "resolve" || params.action === "dismiss" ? "ExceptionResolved" : "ExceptionCreated",
        actorType: "operator",
        actorId: actor,
        before: jsonInput({ status: current.status }),
        after: jsonInput({ status: updated.status }),
        metadata: jsonInput({
          action: `exception_${params.action}`,
          note: params.note ?? null,
          reason: params.reason ?? null,
          centralQueue: true,
        }),
      },
    });
  });

  return listOperationalExceptions({ q: undefined, limit: 100 }, params.organizationId);
}
