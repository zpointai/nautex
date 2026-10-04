/**
 * Workflow Execution Layer
 *
 * Manages agent runs and tasks with proper lifecycle tracking.
 * All agent operations go through this layer to ensure:
 *   - Audit trail for every action
 *   - Confidence-based commit/approval/exception decisions
 *   - Structured task tracking
 */

import { prisma } from "@/lib/prisma";
import { assertAgentEnabled, lockAgent } from "@/lib/agents/controls";
import { logAudit } from "./audit";
import { evaluateConfidence, type ConfidenceDecision } from "./confidence";

/* ── Run Lifecycle ───────────────────────────────────────────── */

export interface StartRunParams {
  organizationId?: string;
  agent: string;
  domain: string;
  trigger: "command" | "module" | "scheduled" | "webhook";
  commandText?: string;
}

export async function startRun(params: StartRunParams) {
  const run = await prisma.$transaction(async tx => {
    if (params.organizationId) {
      await lockAgent(tx, params.organizationId, params.agent);
      await assertAgentEnabled(params.organizationId, params.agent, tx);
    }
    return tx.agentRun.create({
    data: {
      organizationId: params.organizationId ?? null,
      agent: params.agent,
      domain: params.domain,
      trigger: params.trigger,
      commandText: params.commandText ?? null,
      status: "Running",
    },
    });
  });

  await logAudit({
    runId: run.id,
    agent: params.agent,
    action: "run_started",
    input: { domain: params.domain, trigger: params.trigger },
  });

  return run;
}

export async function completeRun(runId: string, status: "Completed" | "Failed" | "AwaitingApproval") {
  const run = await prisma.agentRun.findUnique({ where: { id: runId } });
  if (!run) return;

  const durationMs = Date.now() - run.startedAt.getTime();

  await prisma.agentRun.update({
    where: { id: runId },
    data: { status, completedAt: new Date(), durationMs },
  });

  await logAudit({
    runId,
    agent: run.agent,
    action: "run_completed",
    output: { status, durationMs },
  });
}

/* ── Task Lifecycle ──────────────────────────────────────────── */

export interface StartTaskParams {
  runId: string;
  agent: string;
  action: string;
  input?: Record<string, unknown>;
}

export async function startTask(params: StartTaskParams) {
  const task = await prisma.agentTask.create({
    data: {
      runId: params.runId,
      agent: params.agent,
      action: params.action,
      input: (params.input ?? {}) as object,
      status: "Running",
    },
  });
  return task;
}

export interface CompleteTaskParams {
  taskId: string;
  output: Record<string, unknown>;
  confidence: number;
  model?: string;
  provider?: string;
}

export async function completeTask(params: CompleteTaskParams): Promise<ConfidenceDecision> {
  const task = await prisma.agentTask.findUnique({ where: { id: params.taskId } });
  if (!task) throw new Error(`Task ${params.taskId} not found`);

  const durationMs = Date.now() - task.startedAt.getTime();
  const decision = evaluateConfidence(params.confidence);

  let status: "Completed" | "AutoCommitted" | "AwaitingApproval" = "Completed";
  if (decision.autoCommit) status = "AutoCommitted";
  if (decision.requiresApproval) status = "AwaitingApproval";

  await prisma.agentTask.update({
    where: { id: params.taskId },
    data: {
      output: params.output as object,
      confidence: params.confidence,
      model: params.model ?? null,
      provider: params.provider ?? null,
      status,
      completedAt: new Date(),
      durationMs,
    },
  });

  // Create approval request for medium-confidence results
  if (decision.requiresApproval) {
    await prisma.approval.create({
      data: {
        taskId: params.taskId,
        agent: task.agent,
        domain: (task as { runId: string }).runId ? "unknown" : "unknown", // will be set via run
        description: `${task.action} completed with ${Math.round(params.confidence * 100)}% confidence — requires review`,
        impact: params.confidence >= 0.75 ? "low" : "medium",
        data: params.output as object,
      },
    });
  }

  // Create exception for low-confidence results
  if (decision.createException) {
    await prisma.agentException.create({
      data: {
        taskId: params.taskId,
        agent: task.agent,
        domain: "procurement",
        severity: params.confidence < 0.3 ? "Critical" : "Warning",
        title: `Low confidence: ${task.action}`,
        description: `${task.action} returned ${Math.round(params.confidence * 100)}% confidence. Manual review required.`,
        suggestedAction: "Review the AI output and either approve or re-run with corrected input.",
      },
    });
  }

  await logAudit({
    runId: task.runId,
    agent: task.agent,
    action: task.action,
    output: { confidence: params.confidence, decision: decision.tier, status },
    model: params.model,
    provider: params.provider,
    durationMs,
    committed: decision.autoCommit,
  });

  return decision;
}

export async function failTask(taskId: string, error: string) {
  const task = await prisma.agentTask.findUnique({ where: { id: taskId }, include: { run: true } });
  if (!task) return;

  const durationMs = Date.now() - task.startedAt.getTime();

  await prisma.agentTask.update({
    where: { id: taskId },
    data: { status: "Failed", error, completedAt: new Date(), durationMs },
  });

  await prisma.agentException.create({
    data: {
      taskId,
      organizationId: task.run.organizationId,
      agent: task.agent,
      domain: task.run.domain,
      severity: "Warning",
      title: `Task failed: ${task.action}`,
      description: error,
    },
  });

  await logAudit({
    runId: task.runId,
    agent: task.agent,
    action: task.action,
    output: { error },
    durationMs,
  });
}
