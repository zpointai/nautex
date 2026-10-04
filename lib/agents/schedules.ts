import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ApiRequestError } from "@/lib/api/request";
import { hasPermission } from "@/lib/auth/authorization";
import type { RoleCode } from "@/lib/auth/permissions";
import { AGENT_ACTIONS } from "./capabilities";
import { assertAgentEnabled, canManageAgents, type AgentContext } from "./controls";
import { cancelAgentRun, executeAgentPreview } from "./execution";

export async function createAgentSchedule(context: AgentContext, body: Record<string, unknown>) {
  if (!canManageAgents(context)) throw new ApiRequestError("PERMISSION_DENIED", "An authorized human reviewer must create schedules.", 403);
  const action = AGENT_ACTIONS.find(row => row.agentId === body.agentId && row.action === body.action);
  if (!action || !hasPermission(context, action.permission)) throw new ApiRequestError("ACTION_UNAVAILABLE", "Select an available action permitted for your account.", 403);
  if (!Number.isInteger(body.intervalMinutes) || Number(body.intervalMinutes) < 5 || Number(body.intervalMinutes) > 10080 || !Number.isInteger(body.maxDailyRuns) || Number(body.maxDailyRuns) < 1 || Number(body.maxDailyRuns) > 96) throw new ApiRequestError("SCHEDULE_LIMIT", "Choose an interval of 5–10080 minutes and 1–96 runs per day.", 400);
  if (["provider", "hybrid"].includes(action.mode) && body.allowProvider !== true) throw new ApiRequestError("PROVIDER_CONSENT", "Explicitly allow provider usage for this scheduled action. Daily limits count runs, not currency or model requests.", 400);
  if (typeof body.requestKey !== "string" || !/^[a-zA-Z0-9-]{16,80}$/.test(body.requestKey)) throw new ApiRequestError("REQUEST_REQUIRED", "A unique request identifier is required.", 400);
  if (!body.params || typeof body.params !== "object" || Array.isArray(body.params)) throw new ApiRequestError("INPUT_REQUIRED", "Action inputs are required.", 400);
  const params = body.params as Record<string, unknown>;
  if (Object.keys(params).some(key => !action.fields.some(field => field.key === key)) || action.fields.some(field => typeof params[field.key] !== "string" || !String(params[field.key]).trim() || String(params[field.key]).length > field.maxLength)) throw new ApiRequestError("INPUT_INVALID", "Complete all action inputs within their allowed lengths.", 400);
  await assertAgentEnabled(context.organizationId, action.agentId);
  return prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`schedules:${context.organizationId}`}))`;
    const old = await tx.agentSchedule.findUnique({ where: { organizationId_requestKey: { organizationId: context.organizationId, requestKey: body.requestKey as string } } });
    if (old) {
      const canonical = (value: unknown) => JSON.stringify(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)));
      if (old.createdBy !== context.userId || old.action !== action.action || canonical(old.params) !== canonical(params) || old.intervalMinutes !== body.intervalMinutes || old.maxDailyRuns !== body.maxDailyRuns || old.allowProvider !== (body.allowProvider === true)) throw new ApiRequestError("REQUEST_REUSED", "This request already created a different schedule.", 409);
      return old;
    }
    if (await tx.agentSchedule.count({ where: { organizationId: context.organizationId } }) >= 50) throw new ApiRequestError("SCHEDULE_LIMIT", "This company already has 50 schedules. Reuse existing schedules.", 409);
    const row = await tx.agentSchedule.create({ data: { organizationId: context.organizationId, agentId: action.agentId, action: action.action, params: params as Prisma.InputJsonValue, intervalMinutes: Number(body.intervalMinutes), maxDailyRuns: Number(body.maxDailyRuns), allowProvider: body.allowProvider === true, requestKey: body.requestKey as string, createdBy: context.userId, nextRunAt: new Date(Date.now() + Number(body.intervalMinutes) * 60000) } });
    await tx.auditEvent.create({ data: { organizationId: context.organizationId, entityType: "AgentSchedule", entityId: row.id, eventType: "schedule_created", actorId: context.userId, actorName: context.displayName, sourceModule: "agentMonitor", after: { action: row.action, intervalMinutes: row.intervalMinutes, maxDailyRuns: row.maxDailyRuns, allowProvider: row.allowProvider } } });
    return row;
  });
}

export async function setScheduleEnabled(context: AgentContext, id: string, enabled: boolean, revision: number) {
  if (!canManageAgents(context)) throw new ApiRequestError("PERMISSION_DENIED", "An authorized reviewer must change schedules.", 403);
  const row = await prisma.$transaction(async tx => {
    const old = await tx.agentSchedule.findFirst({ where: { id, organizationId: context.organizationId } });
    if (!old) throw new ApiRequestError("SCHEDULE_NOT_FOUND", "Schedule not found.", 404);
    if (enabled && old.leaseUntil && old.leaseUntil > new Date()) throw new ApiRequestError("SCHEDULE_BUSY", "The previous run is stopping. Refresh before resuming.", 409);
    const changed = await tx.agentSchedule.updateMany({ where: { id, organizationId: context.organizationId, revision }, data: { enabled, revision: { increment: 1 }, ...(enabled ? { nextRunAt: new Date(Date.now() + old.intervalMinutes * 60000), attempts: 0, occurrenceAt: null, activeKey: null, leaseUntil: null, lastError: null } : {}) } });
    if (!changed.count) throw new ApiRequestError("SCHEDULE_CHANGED", "Schedule changed. Refresh before trying again.", 409);
    await tx.auditEvent.create({ data: { organizationId: context.organizationId, entityType: "AgentSchedule", entityId: id, eventType: enabled ? "schedule_resumed" : "schedule_paused", actorId: context.userId, actorName: context.displayName, sourceModule: "agentMonitor" } });
    return old;
  });
  if (!enabled && row.activeKey) {
    const run = await prisma.agentRun.findUnique({ where: { organizationId_requestKey: { organizationId: context.organizationId, requestKey: row.activeKey } } });
    if (run?.status === "Running") await cancelAgentRun(context, run.id).catch(error => { if (!(error instanceof ApiRequestError && error.code === "RUN_FINISHED")) throw error; });
  }
}

async function creatorContext(organizationId: string, userId: string): Promise<AgentContext> {
  const membership = await prisma.organizationMembership.findFirst({ where: { organizationId, userId, status: "Active", user: { status: "Active" }, organization: { status: "Active" } }, include: { user: true, organization: true, legalEntityAccess: true, roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } } } });
  if (!membership) throw new ApiRequestError("SCHEDULE_OWNER_UNAVAILABLE", "Schedule owner no longer has active access.", 403);
  return { userId, organizationId, organizationName: membership.organization.name, organizationDataMode: membership.organization.dataMode, displayName: membership.user.name, email: membership.user.email, image: null, status: "Active", roles: membership.roles.map(row => row.role.code as RoleCode), permissions: [...new Set(membership.roles.flatMap(row => row.role.permissions.map(entry => entry.permission.code)))], legalEntityIds: membership.legalEntityAccess.map(row => row.legalEntityId), activeLegalEntityId: membership.legalEntityAccess[0]?.legalEntityId ?? null, development: false };
}

export async function runDueSchedules(now = new Date()) {
  const due = await prisma.agentSchedule.findMany({ where: { enabled: true, nextRunAt: { lte: now }, OR: [{ leaseUntil: null }, { leaseUntil: { lt: now } }] }, orderBy: { nextRunAt: "asc" }, take: 10 });
  for (const candidate of due) {
    const leaseUntil = new Date(Date.now() + 300000);
    const occurrenceAt = candidate.occurrenceAt ?? candidate.nextRunAt;
    const requestKey = candidate.activeKey ?? `sch-${candidate.id}-${createHash("sha256").update(`${occurrenceAt.toISOString()}:${candidate.attempts}`).digest("hex").slice(0, 20)}`;
    const claimed = await prisma.agentSchedule.updateMany({ where: { id: candidate.id, enabled: true, revision: candidate.revision, nextRunAt: candidate.nextRunAt, OR: [{ leaseUntil: null }, { leaseUntil: { lt: now } }] }, data: { leaseUntil, occurrenceAt, activeKey: requestKey } });
    if (!claimed.count) continue;
    let lastRunId: string | null = null, failed = false, stopped = false, lastError: string | null = null;
    try {
      const context = await creatorContext(candidate.organizationId, candidate.createdBy);
      if (!canManageAgents(context)) throw new ApiRequestError("SCHEDULE_PERMISSION_CHANGED", "Schedule owner no longer has scheduling permission.", 403);
      const day = new Date(now); day.setUTCHours(0, 0, 0, 0);
      const used = await prisma.agentRun.count({ where: { organizationId: candidate.organizationId, requestKey: { startsWith: `sch-${candidate.id}-` }, startedAt: { gte: day } } });
      const previous = await prisma.agentRun.findUnique({ where: { organizationId_requestKey: { organizationId: candidate.organizationId, requestKey } } });
      if (used >= candidate.maxDailyRuns && !previous) {
        const tomorrow = new Date(day.getTime() + 86400000);
        await prisma.agentSchedule.updateMany({ where: { id: candidate.id, revision: candidate.revision, leaseUntil }, data: { nextRunAt: tomorrow, occurrenceAt: null, attempts: 0, leaseUntil: null, activeKey: null, lastError: "Daily run limit reached; resumes next UTC day." } });
        continue;
      }
      const current = await prisma.agentSchedule.findUniqueOrThrow({ where: { id: candidate.id } });
      if (!current.enabled || current.revision !== candidate.revision) { stopped = true; }
      else {
        const run = await executeAgentPreview(context, { agentId: candidate.agentId, action: candidate.action, params: candidate.params, requestKey }, undefined, { id: candidate.id, revision: candidate.revision });
        lastRunId = run.id; failed = run.status === "Failed"; stopped = run.status === "Cancelled";
        if (run.status === "Running") continue; // A recovered lease must not duplicate admitted work.
        if (failed) lastError = "Action failed. Open its run for details; retry is bounded.";
        await prisma.agentRun.update({ where: { id: run.id }, data: { trigger: "scheduled" } });
      }
    } catch (error) {
      failed = true;
      stopped = error instanceof ApiRequestError && ["PERMISSION_DENIED", "SCHEDULE_OWNER_UNAVAILABLE", "SCHEDULE_PERMISSION_CHANGED", "SCHEDULE_PAUSED", "AGENT_DISABLED"].includes(error.code);
      lastError = stopped ? "Schedule paused: owner access or agent controls changed." : "Scheduled action failed. Check its input and provider configuration.";
    }
    const attempts = failed && !stopped ? candidate.attempts + 1 : 0;
    const retry = attempts > 0 && attempts <= 2;
    const completed = await prisma.agentSchedule.updateMany({ where: { id: candidate.id, revision: candidate.revision, leaseUntil }, data: { leaseUntil: null, activeKey: null, lastRunId, lastError, enabled: !stopped, attempts: retry ? attempts : 0, occurrenceAt: retry ? occurrenceAt : null, nextRunAt: new Date(Date.now() + (retry ? 60000 * attempts : candidate.intervalMinutes * 60000)) } });
    if (!completed.count) await prisma.agentSchedule.updateMany({ where: { id: candidate.id, leaseUntil }, data: { leaseUntil: null, activeKey: null, lastRunId } });
  }
}
