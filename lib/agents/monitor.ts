import { OrganizationDataMode } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getAllAgents } from "@/lib/ai/engine/agents";
import { implementedAgent, isModelProvider } from "./capabilities";
import { getAIConfig, isAIConfigured } from "@/lib/ai/config";
import { recoverExpiredAgentRuns } from "./execution";
import { learningSummary } from "@/lib/learning/service";

type HealthTone = "green" | "yellow" | "red" | "gray" | "blue";
type RegistryStatus = "Active" | "Idle" | "Running" | "Failed" | "Blocked" | "Disabled" | "Unavailable" | "Awaiting Approval";
type DataSourceMode = "production" | "demo" | "mixed";

interface BusinessLink {
  type: "RFQ" | "PO" | "Supplier" | "Agreement" | "Backorder" | "Invoice" | "HS" | "Validation" | "Exception" | "Match Run" | "Command" | "Unknown";
  id: string | null;
  label: string;
  module: string;
}

interface AgentMonitorRun {
  execution: string;
  id: string;
  agent: string;
  agentName: string;
  module: string;
  trigger: string;
  startedAt: string;
  completedAt: string | null;
  durationMs: number | null;
  status: string;
  resultSummary: string;
  confidence: number | null;
  linkedObject: BusinessLink;
  exceptionCount: number;
  approvalCount: number;
  taskCount: number;
  failedTaskCount: number;
  dataSource: DataSourceMode;
  error: string | null;
}

interface AgentMonitorTask {
  id: string;
  runId: string;
  agent: string;
  agentName: string;
  action: string;
  status: string;
  confidence: number | null;
  startedAt: string;
  completedAt: string | null;
  durationMs: number | null;
  linkedObject: BusinessLink;
  error: string | null;
  requiresApproval: boolean;
  exceptionCount: number;
  dataSource: DataSourceMode;
}

interface AgentMonitorApproval {
  id: string;
  taskId: string;
  runId: string | null;
  agent: string;
  agentName: string;
  module: string;
  action: string;
  description: string;
  approvalReason: string;
  impact: string;
  status: string;
  confidence: number | null;
  requestedAt: string;
  resolvedAt: string | null;
  resolvedBy: string | null;
  linkedObject: BusinessLink;
  dataSource: DataSourceMode;
}

interface AgentMonitorException {
  id: string;
  taskId: string | null;
  runId: string | null;
  agent: string;
  agentName: string;
  module: string;
  severity: string;
  title: string;
  description: string;
  suggestedAction: string | null;
  status: string;
  createdAt: string;
  linkedObject: BusinessLink;
  dataSource: DataSourceMode;
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

function pct(value: number | null | undefined) {
  return value == null ? null : Math.round(value * 100);
}

function mergeSourceMode(modes: DataSourceMode[]): DataSourceMode {
  const unique = new Set(modes);
  if (unique.size > 1) return "mixed";
  return modes[0] ?? "production";
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
    system: "Command Center",
  };
  return labels[domain] ?? domain.replace(/_/g, " ");
}

function humanize(value: string) {
  return value
    .replace(/_/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function businessLinkFromPayload(input: unknown, output: unknown, commandText?: string | null, fallback?: BusinessLink): BusinessLink {
  const inRecord = isRecord(input) ? input : {};
  const outRecord = isRecord(output) ? output : {};
  const rawCommand = firstString(commandText, inRecord.rawCommand, outRecord.rawCommand);

  const poNumber = firstString(outRecord.poNumber, inRecord.poNumber);
  const purchaseOrderId = firstString(outRecord.purchaseOrderId, inRecord.purchaseOrderId);
  if (poNumber || purchaseOrderId) {
    return { type: "PO", id: purchaseOrderId, label: poNumber ?? purchaseOrderId ?? "Purchase order", module: "Purchase Orders" };
  }

  const rfqId = firstString(outRecord.rfqId, inRecord.rfqId);
  if (rfqId) return { type: "RFQ", id: rfqId, label: rfqId, module: "RFQ Automation" };

  const matchRunId = firstString(outRecord.matchRunId, inRecord.matchRunId);
  if (matchRunId) return { type: "Match Run", id: matchRunId, label: matchRunId, module: "Supplier Routing" };

  const supplierCode = firstString(outRecord.supplierCode, inRecord.supplierCode);
  const supplierId = firstString(outRecord.supplierId, inRecord.supplierId);
  if (supplierCode || supplierId) {
    return { type: "Supplier", id: supplierId, label: supplierCode ?? supplierId ?? "Supplier", module: "Suppliers" };
  }

  const invoiceNo = firstString(outRecord.invoiceNo, outRecord.supplierInvoiceNo, inRecord.invoiceNo, inRecord.supplierInvoiceNo);
  if (invoiceNo) return { type: "Invoice", id: null, label: invoiceNo, module: "Finance" };

  const hsCode = firstString(outRecord.hsCode, outRecord.hs_code, inRecord.hsCode);
  if (hsCode) return { type: "HS", id: hsCode, label: hsCode, module: "HS Codes" };

  const commandPo = rawCommand?.match(/\b(?:NAX-PO|PO)[A-Z0-9-]*\b/i)?.[0];
  if (commandPo) return { type: "PO", id: null, label: commandPo, module: "Purchase Orders" };

  if (rawCommand) return { type: "Command", id: null, label: rawCommand.slice(0, 80), module: "Command Center" };

  return fallback ?? { type: "Unknown", id: null, label: "No linked object", module: "Agent Monitor" };
}

function summarizeTask(task: { action: string; status: string; error: string | null; output: unknown; confidence: number | null }) {
  if (task.error) return task.error;
  const output = isRecord(task.output) ? task.output : {};
  const recommendation = firstString(output.recommendation, output.summary, output.message);
  if (recommendation) return recommendation;
  const confidence = pct(task.confidence);
  return `${humanize(task.action)} ${humanize(task.status)}${confidence == null ? "" : ` at ${confidence}% confidence`}.`;
}

function isSensitiveAction(action: string) {
  const value = action.toLowerCase();
  return ["approve", "payment", "credit", "send", "email", "quote", "invoice", "commercial"].some((keyword) => value.includes(keyword));
}

function healthForStatus(status: RegistryStatus): HealthTone {
  if (status === "Running" || status === "Active") return "green";
  if (status === "Awaiting Approval") return "blue";
  if (status === "Failed" || status === "Blocked") return "red";
  if (status === "Disabled") return "gray";
  return "yellow";
}

export async function getAgentMonitorSnapshot(organizationId: string) {
  await recoverExpiredAgentRuns(organizationId);
  const [controls, aiAttempts] = await Promise.all([
    prisma.agentControl.findMany({ where: { organizationId } }),
    prisma.auditEvent.count({ where: { organizationId, entityType: "ai_request", eventType: "ai_attempt", createdAt: { gte: new Date(Date.now() - 30 * 86400000) } } }),
  ]);
  const aiConfig = getAIConfig();
  const organization = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { dataMode: true },
  });
  const organizationSourceMode: DataSourceMode = organization?.dataMode === OrganizationDataMode.Operational
    ? "production"
    : "demo";
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const [
    runs,
    recentApprovals,
    recentExceptions,
    runGroups,
    runStatusGroups,
    taskGroups,
    approvalGroups,
    exceptionGroups,
    runsToday,
    tasksCompletedToday,
    tasksFailedToday,
    pendingApprovalCount,
    openExceptionCount,
    avgConfidence,
    approvedRecommendations,
    rejectedRecommendations,
    acceptedFeedback,
    rejectedFeedback,
    editedFeedback,
    auditLogs,
    memorySummary,
  ] = await Promise.all([
    prisma.agentRun.findMany({
      where: { organizationId },
      include: {
        tasks: {
          orderBy: { startedAt: "asc" },
          include: {
            approvals: true,
            exceptions: true,
          },
        },
        auditLogs: {
          orderBy: { createdAt: "desc" },
          take: 5,
        },
      },
      orderBy: { startedAt: "desc" },
      take: 80,
    }),
    prisma.approval.findMany({
      where: { task: { run: { organizationId } } },
      include: {
        task: {
          include: {
            run: true,
          },
        },
      },
      orderBy: { requestedAt: "desc" },
      take: 50,
    }),
    prisma.agentException.findMany({
      where: { organizationId },
      include: {
        task: {
          include: {
            run: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
    prisma.agentRun.groupBy({ by: ["agent"], where: { organizationId }, _count: { _all: true }, _max: { startedAt: true } }),
    prisma.agentRun.groupBy({ by: ["agent", "status"], where: { organizationId }, _count: { _all: true } }),
    prisma.agentTask.groupBy({ by: ["agent", "status"], where: { run: { organizationId } }, _count: { _all: true }, _avg: { confidence: true } }),
    prisma.approval.groupBy({ by: ["agent", "status"], where: { task: { run: { organizationId } } }, _count: { _all: true } }),
    prisma.agentException.groupBy({ by: ["agent", "status"], where: { organizationId }, _count: { _all: true } }),
    prisma.agentRun.count({ where: { organizationId, startedAt: { gte: today } } }),
    prisma.agentTask.count({ where: { run: { organizationId }, startedAt: { gte: today }, status: { in: ["Completed", "AutoCommitted"] } } }),
    prisma.agentTask.count({ where: { run: { organizationId }, startedAt: { gte: today }, status: "Failed" } }),
    prisma.approval.count({ where: { task: { run: { organizationId } }, status: "Pending" } }),
    prisma.agentException.count({ where: { organizationId, status: { in: ["Open", "Reviewing"] } } }),
    prisma.agentTask.aggregate({ _avg: { confidence: true }, where: { run: { organizationId }, confidence: { not: null } } }),
    prisma.approval.count({ where: { task: { run: { organizationId } }, status: { in: ["Approved", "AutoApproved"] } } }),
    prisma.approval.count({ where: { task: { run: { organizationId } }, status: "Rejected" } }),
    Promise.resolve(0),
    Promise.resolve(0),
    Promise.resolve(0),
    prisma.auditLog.findMany({ where: { run: { organizationId } }, orderBy: { createdAt: "desc" }, take: 30 }),
    learningSummary(organizationId),
  ]);

  const agents = getAllAgents().map(agent => ({ ...agent, enabled: controls.find(row => row.agentId === agent.id)?.enabled ?? agent.enabled }));
  const agentById = new Map(agents.map((agent) => [agent.id, agent]));
  const runGroupByAgent = new Map(runGroups.map((group) => [group.agent, group]));
  const runStatusesByAgent = new Map<string, Map<string, number>>();
  const taskStatusesByAgent = new Map<string, Map<string, { count: number; avgConfidence: number | null }>>();
  const approvalsByAgent = new Map<string, Map<string, number>>();
  const exceptionsByAgent = new Map<string, Map<string, number>>();

  for (const group of runStatusGroups) {
    const map = runStatusesByAgent.get(group.agent) ?? new Map<string, number>();
    map.set(group.status, group._count._all);
    runStatusesByAgent.set(group.agent, map);
  }

  for (const group of taskGroups) {
    const map = taskStatusesByAgent.get(group.agent) ?? new Map<string, { count: number; avgConfidence: number | null }>();
    map.set(group.status, { count: group._count._all, avgConfidence: group._avg.confidence });
    taskStatusesByAgent.set(group.agent, map);
  }

  for (const group of approvalGroups) {
    const map = approvalsByAgent.get(group.agent) ?? new Map<string, number>();
    map.set(group.status, group._count._all);
    approvalsByAgent.set(group.agent, map);
  }

  for (const group of exceptionGroups) {
    const map = exceptionsByAgent.get(group.agent) ?? new Map<string, number>();
    map.set(group.status, group._count._all);
    exceptionsByAgent.set(group.agent, map);
  }

  const timelineTasks: AgentMonitorTask[] = runs.flatMap((run) => {
    const fallbackLink = businessLinkFromPayload({}, {}, run.commandText);
    return run.tasks.map((task) => {
      const linkedObject = businessLinkFromPayload(task.input, task.output, run.commandText, fallbackLink);
      return {
        id: task.id,
        runId: run.id,
        agent: task.agent,
        agentName: agentById.get(task.agent)?.name ?? humanize(task.agent),
        action: task.action,
        status: humanize(task.status),
        confidence: task.confidence,
        startedAt: task.startedAt.toISOString(),
        completedAt: task.completedAt?.toISOString() ?? null,
        durationMs: task.durationMs,
        linkedObject,
        error: task.error,
        requiresApproval: task.status === "AwaitingApproval" || task.approvals.some((approval) => approval.status === "Pending") || isSensitiveAction(task.action),
        exceptionCount: task.exceptions.length,
        dataSource: organizationSourceMode,
      };
    });
  });

  const recentRuns: AgentMonitorRun[] = runs.map((run) => {
    const failedTask = run.tasks.find((task) => task.status === "Failed" || task.error);
    const primaryTask = failedTask ?? run.tasks[run.tasks.length - 1] ?? run.tasks[0];
    const confidenceValues = run.tasks.map((task) => numberOrNull(task.confidence)).filter((value): value is number => value != null);
    const avg = confidenceValues.length
      ? confidenceValues.reduce((sum, value) => sum + value, 0) / confidenceValues.length
      : null;
    const linkedObject = primaryTask
      ? businessLinkFromPayload(primaryTask.input, primaryTask.output, run.commandText)
      : businessLinkFromPayload({}, {}, run.commandText);
    const exceptionCount = run.tasks.reduce((sum, task) => sum + task.exceptions.length, 0);
    const approvalCount = run.tasks.reduce((sum, task) => sum + task.approvals.length, 0);

    return {
      id: run.id,
      agent: run.agent,
      agentName: agentById.get(run.agent)?.name ?? humanize(run.agent),
      module: moduleLabel(run.domain),
      trigger: humanize(run.trigger),
      startedAt: run.startedAt.toISOString(),
      completedAt: run.completedAt?.toISOString() ?? null,
      durationMs: run.durationMs,
      status: humanize(run.status),
      resultSummary: primaryTask ? summarizeTask(primaryTask) : humanize(run.status),
      execution: primaryTask?.provider ? `${primaryTask.provider} · ${primaryTask.model ?? "model not recorded"}` : "Execution provider not recorded",
      confidence: avg,
      linkedObject,
      exceptionCount,
      approvalCount,
      taskCount: run.tasks.length,
      failedTaskCount: run.tasks.filter((task) => task.status === "Failed").length,
      dataSource: organizationSourceMode,
      error: failedTask?.error ?? null,
    };
  });

  const approvals: AgentMonitorApproval[] = recentApprovals.map((approval) => ({
    id: approval.id,
    taskId: approval.taskId,
    runId: approval.task.runId,
    agent: approval.agent,
    agentName: agentById.get(approval.agent)?.name ?? humanize(approval.agent),
    module: moduleLabel(approval.domain),
    action: approval.task.action,
    description: approval.description,
    approvalReason: approval.description,
    impact: humanize(approval.impact),
    status: humanize(approval.status),
    confidence: approval.task.confidence,
    requestedAt: approval.requestedAt.toISOString(),
    resolvedAt: approval.resolvedAt?.toISOString() ?? null,
    resolvedBy: approval.resolvedBy,
    linkedObject: businessLinkFromPayload(approval.task.input, approval.task.output, approval.task.run.commandText),
    dataSource: organizationSourceMode,
  })).slice(0, 30);

  const exceptions: AgentMonitorException[] = recentExceptions.map((exception) => ({
    id: exception.id,
    taskId: exception.taskId,
    runId: exception.task?.runId ?? null,
    agent: exception.agent,
    agentName: agentById.get(exception.agent)?.name ?? humanize(exception.agent),
    module: moduleLabel(exception.domain),
    severity: humanize(exception.severity),
    title: exception.title,
    description: exception.description,
    suggestedAction: exception.suggestedAction,
    status: humanize(exception.status),
    createdAt: exception.createdAt.toISOString(),
    linkedObject: exception.task
      ? businessLinkFromPayload(exception.task.input, exception.task.output, exception.task.run.commandText)
      : { type: "Exception" as const, id: exception.id, label: exception.title, module: moduleLabel(exception.domain) },
    dataSource: organizationSourceMode,
  })).slice(0, 30);

  const registry = agents.map((agent) => {
    const runGroup = runGroupByAgent.get(agent.id);
    const statuses = runStatusesByAgent.get(agent.id) ?? new Map<string, number>();
    const taskStatuses = taskStatusesByAgent.get(agent.id) ?? new Map<string, { count: number; avgConfidence: number | null }>();
    const approvalStatuses = approvalsByAgent.get(agent.id) ?? new Map<string, number>();
    const exceptionStatuses = exceptionsByAgent.get(agent.id) ?? new Map<string, number>();
    const totalRuns = runGroup?._count._all ?? 0;
    const completedRuns = statuses.get("Completed") ?? 0;
    const failedRuns = statuses.get("Failed") ?? 0;
    const runningRuns = statuses.get("Running") ?? 0;
    const awaitingRuns = statuses.get("AwaitingApproval") ?? 0;
    const openExceptions = (exceptionStatuses.get("Open") ?? 0) + (exceptionStatuses.get("Reviewing") ?? 0);
    const pendingApprovals = approvalStatuses.get("Pending") ?? 0;
    const completedTasks = (taskStatuses.get("Completed")?.count ?? 0) + (taskStatuses.get("AutoCommitted")?.count ?? 0);
    const taskConfidenceValues = Array.from(taskStatuses.values()).map((entry) => entry.avgConfidence).filter((value): value is number => value != null);
    const averageConfidence = taskConfidenceValues.length
      ? taskConfidenceValues.reduce((sum, value) => sum + value, 0) / taskConfidenceValues.length
      : null;

    let status: RegistryStatus = !implementedAgent(agent.id) ? "Unavailable" : agent.enabled ? "Idle" : "Disabled";
    if (runningRuns > 0) status = "Running";
    else if (agent.enabled && failedRuns > 0 && failedRuns >= completedRuns) status = "Failed";
    else if (agent.enabled && openExceptions > 0) status = "Blocked";
    else if (agent.enabled && (awaitingRuns > 0 || pendingApprovals > 0)) status = "Awaiting Approval";

    return {
      id: agent.id,
      name: agent.name,
      category: agent.category,
      status,
      health: healthForStatus(status),
      description: agent.description,
      linkedModules: agent.linkedModules,
      capabilities: agent.capabilities,
      allowedActions: agent.allowedActions,
      restrictedActions: agent.restrictedActions,
      approvalRequiredFor: agent.approvalRequiredFor,
      configurationStatus: !implementedAgent(agent.id) ? "Workflow not implemented" : agent.enabled ? "Enabled · manual or scheduled work" : "Disabled · new work blocked",
      lastRun: runGroup?._max.startedAt?.toISOString() ?? null,
      totalRuns,
      successRate: totalRuns > 0 ? Math.round((completedRuns / totalRuns) * 100) : null,
      averageConfidence,
      tasksCompleted: completedTasks,
      openExceptions,
      pendingApprovals,
      lastError: recentRuns.find((run) => run.agent === agent.id && run.error)?.error ?? null,
      dataSource: totalRuns > 0
        ? mergeSourceMode(recentRuns.filter((run) => run.agent === agent.id).map((run) => run.dataSource))
        : organizationSourceMode,
    };
  });

  const enabledAgentIds = new Set(agents.filter((agent) => agent.enabled).map((agent) => agent.id));
  const activeAgents = registry.filter((agent) => enabledAgentIds.has(agent.id)).length;

  return {
    generatedAt: new Date().toISOString(),
    overview: {
      activeAgents,
      runningAgents: registry.filter((agent) => agent.status === "Running").length,
      runsToday,
      tasksCompletedToday,
      tasksFailedToday,
      awaitingApproval: pendingApprovalCount,
      openExceptions: openExceptionCount,
      averageConfidence: avgConfidence._avg.confidence,
      acceptedRecommendations: approvedRecommendations + acceptedFeedback,
      rejectedRecommendations: rejectedRecommendations + rejectedFeedback,
      editedRecommendations: editedFeedback,
    },
    registry,
    recentRuns,
    recentTasks: timelineTasks.sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()).slice(0, 60),
    approvals,
    exceptions,
    learning: {
      ...memorySummary,
      totals: {
        ...memorySummary.totals,
        acceptedRecommendations: memorySummary.totals.acceptedRecommendations,
        rejectedRecommendations: memorySummary.totals.rejectedRecommendations,
        editedRecommendations: 0,
      },
    },
    auditEvents: auditLogs.map((event) => ({
      id: event.id,
      runId: event.runId,
      agent: event.agent,
      agentName: agentById.get(event.agent)?.name ?? humanize(event.agent),
      action: event.action,
      target: event.target,
      committed: event.committed,
      durationMs: event.durationMs,
      createdAt: event.createdAt.toISOString(),
      summary: `${event.committed ? "Business data write recorded" : "Review/audit event recorded"}${event.provider ? ` · ${event.provider} · ${event.model ?? "model not recorded"}` : ""}`,
      usedAi: isModelProvider(event.provider),
      usedDeterministicLogic: event.provider === "nautex" || event.provider === "postgres",
    })),
    usage: {
      providerLabel: isAIConfigured(aiConfig) ? `${aiConfig.provider} · ${aiConfig.defaultModel}` : "No AI provider configured",
      aiCalls: aiAttempts,
      estimatedTokens: null,
      estimatedCost: null,
      taskCount: taskGroups.reduce((sum, group) => sum + group._count._all, 0),
      failedOrRetriedCalls: taskGroups.filter((group) => group.status === "Failed").reduce((sum, group) => sum + group._count._all, 0),
      note: "Provider attempts recorded in this organization over the last 30 days, including failures and retries. Local processing is excluded. Older calls without attempt telemetry cannot be counted. Detailed measured tokens and available cost estimates are in Settings → AI providers → Usage.",
    },
    dataSource: organizationSourceMode,
  };
}
