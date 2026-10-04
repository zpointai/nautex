import { dispatchAction } from "./actions";
import { assertAgentEnabled } from "@/lib/agents/controls";
import { AGENT_ACTIONS } from "@/lib/agents/capabilities";
import { prisma } from "@/lib/prisma";
import { hasPermission, type AuthContext } from "@/lib/auth/authorization";
/**
 * Command Router
 *
 * Parses natural-language commands and routes them to the correct agent.
 * This is the entry point for all command-triggered workflows.
 *
 * Pattern: command text → intent detection → agent dispatch → workflow execution
 */

import { generateJSON, isAIConfigured } from "@/lib/ai";
import { getAgent, getEnabledAgents, type AgentDefinition } from "./agents";
import { startRun, startTask, completeTask, failTask, completeRun } from "./workflow";
import { logAudit } from "./audit";

/* ── Types ───────────────────────────────────────────────────── */

export interface RouteResult {
  routingExecution?: { provider: string; model: string };
  agentId: string;
  action: string;
  params: Record<string, unknown>;
  confidence: number;
}

export interface CommandResult {
  runId: string;
  agentId: string;
  action: string;
  status: "completed" | "awaiting_approval" | "failed";
  output?: Record<string, unknown>;
  confidence?: number;
  error?: string;
}

/* ── Intent Detection ────────────────────────────────────────── */

/**
 * Uses AI to determine which agent and action should handle a command.
 * Falls back to keyword matching when AI is not configured.
 */
async function detectIntent(command: string, organizationId: string): Promise<RouteResult> {
  const controls = await prisma.agentControl.findMany({ where: { organizationId } });
  const agents = getEnabledAgents().filter(agent => controls.find(row => row.agentId === agent.id)?.enabled !== false)
    .map(agent => ({ ...agent, actions: AGENT_ACTIONS.filter(action => action.agentId === agent.id).map(action => action.action) }));

  // Try AI-powered routing first
  if (isAIConfigured()) {
    const agentDescriptions = agents
      .map((a) => `- ${a.id}: ${a.description} [actions: ${a.actions.join(", ")}]`)
      .join("\n");

    const prompt = `You are a command router for a maritime procurement ERP.
Given a user command, determine which agent and action should handle it.

Available agents:
${agentDescriptions}

User command: "${command}"

Return JSON:
{
  "agentId": "agent_id from list above",
  "action": "specific action from agent's action list",
  "params": { extracted parameters from the command },
  "confidence": 0.0 to 1.0
}`;

    const result = await generateJSON<RouteResult>(prompt, {
      organizationId,
      tier: "fast",
      systemInstruction: "Route commands to the most appropriate agent. Extract relevant parameters. Return valid JSON only.",
      temperature: 0.1,
    });

    if (result.ok && result.data) {
      // Validate the routed agent exists
      const agent = getAgent(result.data.agentId);
      if (agent?.enabled && agent.actions.includes(result.data.action)
        && typeof result.data.confidence === "number" && Number.isFinite(result.data.confidence)
        && result.data.confidence >= 0 && result.data.confidence <= 1
        && result.data.params && typeof result.data.params === "object" && !Array.isArray(result.data.params)) {
        return { ...result.data, routingExecution: { provider: result.provider, model: result.model } };
      }
    }
  }

  // Fallback: keyword-based routing
  return keywordRoute(command, agents);
}

/* ── Keyword Fallback ────────────────────────────────────────── */

const KEYWORD_MAP: Record<string, { agentId: string; action: string }> = {
  // Classification
  "classify": { agentId: "classification", action: "classify_hs" },
  "hs code": { agentId: "classification", action: "classify_hs" },
  "hs-code": { agentId: "classification", action: "classify_hs" },
  "impa": { agentId: "classification", action: "classify_impa" },
  "country of origin": { agentId: "classification", action: "identify_coo" },
  "coo": { agentId: "classification", action: "identify_coo" },
  "normalize": { agentId: "classification", action: "normalize_description" },
  // RFQ
  "rfq": { agentId: "rfq_intake", action: "parse_rfq" },
  "requisition": { agentId: "rfq_intake", action: "parse_rfq" },
  "quote request": { agentId: "rfq_intake", action: "parse_rfq" },
  // Suppliers
  "find supplier": { agentId: "supplier_discovery", action: "find_suppliers" },
  "supplier": { agentId: "supplier_discovery", action: "find_suppliers" },
  "vendor": { agentId: "supplier_discovery", action: "find_suppliers" },
  // Validation
  "validate order": { agentId: "order_validation", action: "validate_order" },
  "check order": { agentId: "order_validation", action: "validate_order" },
  "validate quote": { agentId: "procurement_validation", action: "validate_quote_vs_po" },
  "compare quote": { agentId: "procurement_validation", action: "validate_quote_vs_po" },
};

function keywordRoute(command: string, agents: AgentDefinition[]): RouteResult {
  const lower = command.toLowerCase();

  for (const [keyword, route] of Object.entries(KEYWORD_MAP).sort(([a], [b]) => b.length - a.length)) {
    if (new RegExp(`\\b${keyword}\\b`, "i").test(lower)) {
      const agent = agents.find((a) => a.id === route.agentId);
      if (agent) {
        return { ...route, params: { rawCommand: command }, confidence: 0.6 };
      }
    }
  }

  // Default: unknown command
  return {
    agentId: "command_router",
    action: "route_command",
    params: { rawCommand: command },
    confidence: 0.2,
  };
}

/* ── Command Execution ───────────────────────────────────────── */

/**
 * Main entry point: route a command and execute it through the workflow engine.
 */
export async function executeCommand(command: string, organizationId: string, context?: AuthContext): Promise<CommandResult> {
  // 1. Start a run for the routing phase
  const run = await startRun({
    organizationId,
    agent: "command_router",
    domain: "system",
    trigger: "command",
    commandText: command,
  });

  try {
    // 2. Detect intent
    const routeTask = await startTask({
      runId: run.id,
      agent: "command_router",
      action: "route_command",
      input: { command },
    });

    const route = await detectIntent(command, organizationId);
    route.params = { ...(route.params ?? {}), rawCommand: command };

    await prisma.agentTask.update({ where: { id: routeTask.id }, data: { output: { route } as object, status: "Completed", completedAt: new Date(), confidence: null, ...(route.routingExecution ?? { provider: "nautex", model: "keyword-router" }) } });

    // 3. Log the routing decision
    await logAudit({
      runId: run.id,
      agent: "command_router",
      action: "route_command",
      input: { command },
      output: { agentId: route.agentId, action: route.action, confidence: route.confidence },
    });

    // 4. If confidence is too low, complete as failed routing
    if (route.confidence < 0.3 && route.agentId === "command_router") {
      await completeRun(run.id, "Failed");
      return {
        runId: run.id,
        agentId: route.agentId,
        action: route.action,
        status: "failed",
        error: "Could not determine which agent should handle this command.",
        confidence: route.confidence,
      };
    }

    // 5. Execute the routed action
    const capability = AGENT_ACTIONS.find(action => action.agentId === route.agentId && action.action === route.action);
    if (!capability) throw new Error("This action is unavailable. Select an implemented action in Agent Monitor.");
    if (context && (!hasPermission(context, capability.permission) || context.roles.includes("system-agent"))) throw new Error(`Permission ${capability.permission} and a human operator are required.`);
    await assertAgentEnabled(organizationId, route.agentId);
    const child = await startRun({ organizationId, agent: route.agentId, domain: getAgent(route.agentId)!.domain, trigger: "command", commandText: command });
    await prisma.agentRun.update({ where: { id: child.id }, data: { parentRunId: run.id } });
    const actionTask = await startTask({
      runId: child.id,
      agent: route.agentId,
      action: route.action,
      input: route.params,
    });

    try {
      const output = await dispatchAction(route, organizationId);
      if (output.error || output._stub || output._pending) {
        throw new Error(typeof output.error === "string" ? output.error : "The requested agent action is unavailable.");
      }

      const provenance = (output._ai ?? output._execution ?? { provider: "nautex", model: "local-rules" }) as { provider: string; model: string };
      await prisma.agentTask.update({ where: { id: actionTask.id }, data: { output: { ...output, humanReviewRequired: true, businessRecordsChanged: false } as object, confidence: null, status: "Completed", completedAt: new Date(), model: provenance.model, provider: provenance.provider } });
      await logAudit({ runId: child.id, agent: route.agentId, action: route.action, model: provenance.model, provider: provenance.provider, committed: false });
      const status = "completed" as const;
      await completeRun(child.id, "Completed");
      await completeRun(run.id, "Completed");

      return {
        runId: run.id,
        agentId: route.agentId,
        action: route.action,
        status,
        output,
        confidence: route.confidence,
      };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      await failTask(actionTask.id, errorMsg);
      await completeRun(child.id, "Failed");
      await completeRun(run.id, "Failed");

      return {
        runId: run.id,
        agentId: route.agentId,
        action: route.action,
        status: "failed",
        error: errorMsg,
        confidence: route.confidence,
      };
    }
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    await completeRun(run.id, "Failed");

    return {
      runId: run.id,
      agentId: "command_router",
      action: "route_command",
      status: "failed",
      error: errorMsg,
    };
  }
}
