import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ApiRequestError } from "@/lib/api/request";
import { hasPermission } from "@/lib/auth/authorization";
import { dispatchAction } from "@/lib/ai/engine/actions";
import { getAgent } from "@/lib/ai/engine/agents";
import { AGENT_ACTIONS } from "./capabilities";
import { assertAgentEnabled, canManageAgents, lockAgent, type AgentContext } from "./controls";

const LEASE_MS = 240_000;
const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const inputKey = (value: unknown) => JSON.stringify(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)));
export async function recoverExpiredAgentRuns(organizationId: string) {
  // A request interrupted by a crash is never silently restarted. Only controlled,
  // read-only runs with an explicit execution deadline are eligible for recovery.
  await prisma.$transaction(async tx => {
    const expired = await tx.agentRun.findMany({ where: { organizationId, status: "Running", leaseExpiresAt: { lt: new Date() } }, select: { id: true, agent: true } });
    for (const run of expired) {
      const claimed = await tx.agentRun.updateMany({ where: { id: run.id, status: "Running" }, data: { status: "Failed", completedAt: new Date() } });
      if (!claimed.count) continue;
      await tx.agentTask.updateMany({ where: { runId: run.id, status: "Running" }, data: { status: "Failed", completedAt: new Date(), error: "Execution deadline expired or application stopped. Review the input before retrying." } });
      await tx.auditLog.create({ data: { runId: run.id, agent: run.agent, action: "execution_interrupted", committed: false } });
    }
  });
}

export async function cancelAgentRun(context: AgentContext, id: string) {
  return prisma.$transaction(async tx => {
    const run = await tx.agentRun.findFirst({ where: { id, organizationId: context.organizationId }, include: { tasks: true } });
    if (!run) throw new ApiRequestError("RUN_NOT_FOUND", "Run not found.", 404);
    const action = AGENT_ACTIONS.find(a => a.agentId === run.agent && a.action === run.tasks[0]?.action);
    if (!canManageAgents(context) && !(run.requestedBy === context.userId && action && hasPermission(context, action.permission))) throw new ApiRequestError("PERMISSION_DENIED", "You cannot cancel this run.", 403);
    if (!run.requestKey || !run.leaseExpiresAt) throw new ApiRequestError("RUN_NOT_CANCELLABLE", "This module run does not support cancellation here.", 409);
    if (run.status === "Cancelled") return run;
    const claim = await tx.agentRun.updateMany({ where: { id, status: "Running" }, data: { status: "Cancelled", cancelRequestedAt: new Date(), completedAt: new Date(), durationMs: Date.now() - run.startedAt.getTime() } });
    if (!claim.count) throw new ApiRequestError("RUN_FINISHED", "This run has already finished. Refresh its result.", 409);
    await tx.agentTask.updateMany({ where: { runId: id, status: "Running" }, data: { status: "Cancelled", completedAt: new Date(), error: "Cancelled by operator. No preview was applied to business records." } });
    await tx.auditLog.create({ data: { runId: id, agent: run.agent, action: "run_cancelled", input: { actorId: context.userId }, committed: false } });
    return tx.agentRun.findUniqueOrThrow({ where: { id } });
  });
}

export async function executeAgentPreview(context: AgentContext, body: Record<string, unknown>, requestSignal?: AbortSignal, schedule?: { id: string; revision: number }) {
  if (Object.keys(body).some(key => !["agentId", "action", "params", "requestKey", "retryOfId"].includes(key))) throw new ApiRequestError("INVALID_INPUT", "Unexpected execution fields.", 400);
  const capability = AGENT_ACTIONS.find(action => action.agentId === body.agentId && action.action === body.action);
  if (!capability) throw new ApiRequestError("ACTION_UNAVAILABLE", "This action is not implemented. Use an available action or its linked module.", 409);
  if (!hasPermission(context, capability.permission) || context.roles.includes("system-agent")) throw new ApiRequestError("PERMISSION_DENIED", `Permission ${capability.permission} and a human operator are required.`, 403);
  if (typeof body.requestKey !== "string" || !/^[a-zA-Z0-9-]{16,80}$/.test(body.requestKey)) throw new ApiRequestError("REQUEST_KEY_REQUIRED", "A unique request key is required.", 400);
  const input = body.params;
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new ApiRequestError("INVALID_INPUT", "Action inputs are required.", 400);
  const params: Record<string, string> = {};
  if (Object.keys(input).some(key => !capability.fields.some(field => field.key === key))) throw new ApiRequestError("INVALID_INPUT", "Unexpected action inputs.", 400);
  for (const field of capability.fields) {
    const value = (input as Record<string, unknown>)[field.key];
    if (typeof value !== "string" || !value.trim() || value.length > field.maxLength) throw new ApiRequestError("INVALID_INPUT", `${field.label} must contain 1–${field.maxLength} characters.`, 400);
    params[field.key] = value.trim();
  }
  if (body.retryOfId !== undefined && typeof body.retryOfId !== "string") throw new ApiRequestError("INVALID_INPUT", "Invalid retry reference.", 400);
  await recoverExpiredAgentRuns(context.organizationId);
  const admitted = await prisma.$transaction(async tx => {
    await lockAgent(tx, context.organizationId, capability.agentId);
    if (schedule) {
      await tx.$queryRaw`SELECT id FROM agent_schedules WHERE id = ${schedule.id} AND organization_id = ${context.organizationId} FOR UPDATE`;
      const current = await tx.agentSchedule.findFirst({ where: { id: schedule.id, organizationId: context.organizationId, revision: schedule.revision, enabled: true, activeKey: body.requestKey as string, leaseUntil: { gt: new Date() } } });
      if (!current) throw new ApiRequestError("SCHEDULE_PAUSED", "Schedule changed before execution was admitted.", 409);
    }
    const previous = await tx.agentRun.findUnique({ where: { organizationId_requestKey: { organizationId: context.organizationId, requestKey: body.requestKey as string } }, include: { tasks: true } });
    if (previous) {
      if (previous.requestedBy !== context.userId || previous.agent !== capability.agentId || previous.tasks[0]?.action !== capability.action || inputKey(previous.tasks[0]?.input) !== inputKey(params) || previous.retryOfId !== (body.retryOfId ?? null)) throw new ApiRequestError("REQUEST_KEY_REUSED", "This request key belongs to different work.", 409);
      return { run: previous, reused: true };
    }
    await assertAgentEnabled(context.organizationId, capability.agentId, tx);
    if (body.retryOfId) {
      const retry = await tx.agentRun.findFirst({ where: { id: body.retryOfId as string, organizationId: context.organizationId, agent: capability.agentId, status: { in: ["Failed", "Cancelled"] }, requestKey: { not: null } }, include: { tasks: true } });
      if (!retry || retry.tasks[0]?.action !== capability.action) throw new ApiRequestError("RETRY_UNAVAILABLE", "Only failed or cancelled monitor runs of this action can be retried.", 409);
    }
    if (await tx.agentRun.findFirst({ where: { organizationId: context.organizationId, agent: capability.agentId, status: "Running", requestKey: { not: null } } })) throw new ApiRequestError("AGENT_BUSY", "This agent already has a monitor run in progress.", 409);
    const run = await tx.agentRun.create({ data: { organizationId: context.organizationId, agent: capability.agentId, domain: getAgent(capability.agentId)!.domain, trigger: "monitor", requestKey: body.requestKey as string, requestedBy: context.userId, retryOfId: body.retryOfId as string | undefined, leaseExpiresAt: new Date(Date.now() + LEASE_MS), tasks: { create: { agent: capability.agentId, action: capability.action, input: json(params), status: "Running" } }, auditLogs: { create: { agent: capability.agentId, action: "preview_requested", input: { actorId: context.userId }, committed: false } } }, include: { tasks: true } });
    return { run, reused: false };
  });
  if (admitted.reused) return admitted.run;
  const run = admitted.run;
  const controller = new AbortController();
  const abort = () => controller.abort();
  requestSignal?.addEventListener("abort", abort, { once: true });
  if (requestSignal?.aborted) controller.abort();
  let polling = false;
  const poll = setInterval(async () => {
    if (polling) return;
    polling = true;
    try {
      const current = await prisma.agentRun.findUnique({ where: { id: run.id }, select: { status: true } });
      if (current?.status !== "Running" || Date.now() > run.leaseExpiresAt!.getTime()) controller.abort();
    } catch { controller.abort(); } finally { polling = false; }
  }, 300);
  try {
    controller.signal.throwIfAborted();
    const output = await dispatchAction({ agentId: capability.agentId, action: capability.action, params, confidence: 0 }, context.organizationId, { signal: controller.signal });
    controller.signal.throwIfAborted();
    if (output.error || output._stub || output._pending) throw new Error(typeof output.error === "string" ? output.error : "Action failed.");
    const provenance = (output._ai ?? output._execution ?? { provider: "nautex", model: "local-rules" }) as { provider: string; model: string };
    await prisma.$transaction(async tx => {
      const claim = await tx.agentRun.updateMany({ where: { id: run.id, status: "Running", leaseExpiresAt: { gte: new Date() } }, data: { status: "Completed", completedAt: new Date(), durationMs: Date.now() - run.startedAt.getTime() } });
      if (!claim.count) return; // Cancellation/deadline wins; late output cannot revive a run.
      await tx.agentTask.update({ where: { id: run.tasks[0].id }, data: { output: json({ ...output, humanReviewRequired: true, businessRecordsChanged: false }), status: "Completed", confidence: null, model: provenance.model, provider: provenance.provider, completedAt: new Date(), durationMs: Date.now() - run.startedAt.getTime() } });
      await tx.auditLog.create({ data: { runId: run.id, agent: capability.agentId, action: capability.action, model: provenance.model, provider: provenance.provider, output: { previewOnly: true }, committed: false } });
    });
  } catch (error) {
    await prisma.$transaction(async tx => {
      const claim = await tx.agentRun.updateMany({ where: { id: run.id, status: "Running" }, data: { status: "Failed", completedAt: new Date(), durationMs: Date.now() - run.startedAt.getTime() } });
      if (!claim.count) return;
      const message = controller.signal.aborted ? "Execution interrupted. Review the input before retrying." : error instanceof Error ? error.message : "Agent execution failed.";
      await tx.agentTask.update({ where: { id: run.tasks[0].id }, data: { status: "Failed", error: message, completedAt: new Date() } });
      await tx.auditLog.create({ data: { runId: run.id, agent: capability.agentId, action: "preview_failed", output: { error: message }, committed: false } });
    });
  } finally {
    clearInterval(poll);
    requestSignal?.removeEventListener("abort", abort);
  }
  return prisma.agentRun.findUniqueOrThrow({ where: { id: run.id }, include: { tasks: true } });
}
