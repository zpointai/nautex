import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ApiRequestError } from "@/lib/api/request";
import { getAgent, getAllAgents } from "@/lib/ai/engine/agents";
import { getAIConfig, isAIConfigured } from "@/lib/ai/config";
import { hasPermission, type AuthContext } from "@/lib/auth/authorization";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { AGENT_ACTIONS, implementedAgent } from "./capabilities";

export type AgentContext = AuthContext & { organizationId: string };
export async function lockAgent(tx: Prisma.TransactionClient, organizationId: string, agentId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${organizationId + ":agent:" + agentId}))`;
}
export async function assertAgentEnabled(organizationId: string, agentId: string, client: Prisma.TransactionClient = prisma) {
  const agent = getAgent(agentId);
  if (!agent || !implementedAgent(agentId)) throw new ApiRequestError("AGENT_UNAVAILABLE", "This agent has no implemented workflow yet.", 409);
  const control = await client.agentControl.findUnique({ where: { organizationId_agentId: { organizationId, agentId } } });
  if (!(control?.enabled ?? agent.enabled)) throw new ApiRequestError("AGENT_DISABLED", `${agent.name} is disabled. An authorized reviewer can enable it in Agent Monitor.`, 409);
}
export function canManageAgents(context: AuthContext) {
  return hasPermission(context, PERMISSIONS.AGENTS_APPROVE) && !context.roles.includes("system-agent");
}
export async function setAgentEnabled(context: AgentContext, agentId: string, enabled: boolean, revision: number) {
  if (!canManageAgents(context)) throw new ApiRequestError("PERMISSION_DENIED", "An authorized human reviewer must change agent controls.", 403);
  const agent = getAgent(agentId);
  if (!agent || !implementedAgent(agentId)) throw new ApiRequestError("AGENT_UNAVAILABLE", "This agent has no implemented workflow yet.", 409);
  return prisma.$transaction(async tx => {
    await lockAgent(tx, context.organizationId, agentId);
    const where = { organizationId_agentId: { organizationId: context.organizationId, agentId } };
    const before = await tx.agentControl.findUnique({ where });
    if ((before?.revision ?? 0) !== revision) throw new ApiRequestError("CONTROL_CHANGED", "This control changed in another session. Refresh before changing it.", 409);
    const control = await tx.agentControl.upsert({ where, create: { organizationId: context.organizationId, agentId, enabled, revision: 1, updatedBy: context.userId }, update: { enabled, revision: { increment: 1 }, updatedBy: context.userId } });
    await tx.auditEvent.create({ data: { organizationId: context.organizationId, entityType: "AgentControl", entityId: agentId, eventType: enabled ? "agent_enabled" : "agent_disabled", actorId: context.userId, actorName: context.displayName, sourceModule: "agentMonitor", before: { enabled: before?.enabled ?? agent.enabled }, after: { enabled, revision: control.revision } } });
    return control;
  });
}
export async function getAgentControls(context: AgentContext) {
  const settings = await prisma.agentControl.findMany({ where: { organizationId: context.organizationId } });
  const config = getAIConfig();
  const configured = isAIConfigured(config);
  const mailbox = await prisma.mailboxConnection.findUnique({ where: { organizationId: context.organizationId }, select: { enabled: true, secretCiphertext: true } });
  return {
    currentUserId: context.userId,
    canManage: canManageAgents(context),
    provider: { configured, name: configured ? config.provider : "none", model: configured ? config.defaultModel : null, fastModel: configured ? config.fastModel : null, reasoningModel: configured ? config.reasoningModel : null },
    policy: "Runs start on request or on schedules explicitly created by a reviewer. Schedules run while the Nautex backend is available; closing the standalone app stops them. Disable blocks new work; admitted module requests may finish. Results require review. Provider actions may incur usage. Learning activation remains a separate human decision.",
    agents: getAllAgents().map(agent => {
      const saved = settings.find(row => row.agentId === agent.id);
      return { id: agent.id, enabled: saved?.enabled ?? agent.enabled, revision: saved?.revision ?? 0, available: implementedAgent(agent.id), actions: AGENT_ACTIONS.filter(action => action.agentId === agent.id).map(action => ({ ...action, permitted: hasPermission(context, action.permission), ready: action.mode === "mailbox" ? Boolean(mailbox?.enabled && mailbox.secretCiphertext) : action.mode !== "provider" || configured })) };
    }),
  };
}
