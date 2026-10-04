/**
 * AI Orchestration Types
 *
 * Foundation types for the future agent orchestration system.
 * These types define the interfaces that agents, tasks, and
 * approval workflows will implement in the next phase.
 *
 * NOT fully implemented yet — this is the structural contract.
 */

/* ── Agent System ────────────────────────────────────────────── */

export type AgentDomain = "procurement" | "classification" | "validation" | "inventory" | "logistics";

export type AgentStatus = "idle" | "running" | "completed" | "failed" | "awaiting_approval";

export interface AgentTask {
  id: string;
  agent: string;
  domain: AgentDomain;
  action: string;
  input: Record<string, unknown>;
  status: AgentStatus;
  result?: Record<string, unknown>;
  error?: string;
  startedAt: string;
  completedAt?: string;
}

/* ── Approval Workflow ───────────────────────────────────────── */

export type ApprovalStatus = "pending" | "approved" | "rejected" | "auto_approved";

export interface ApprovalRequest {
  id: string;
  taskId: string;
  agent: string;
  domain: AgentDomain;
  description: string;
  impact: "low" | "medium" | "high";
  status: ApprovalStatus;
  requestedAt: string;
  resolvedAt?: string;
  resolvedBy?: string;
}

/* ── Exception Handling ──────────────────────────────────────── */

export type ExceptionSeverity = "critical" | "warning" | "info";

export interface AgentException {
  id: string;
  taskId: string;
  agent: string;
  domain: AgentDomain;
  severity: ExceptionSeverity;
  title: string;
  description: string;
  suggestedAction?: string;
  timestamp: string;
}

/* ── Audit Log ───────────────────────────────────────────────── */

export interface AuditEntry {
  id: string;
  taskId: string;
  agent: string;
  action: string;
  input: Record<string, unknown>;
  output: Record<string, unknown>;
  model: string;
  provider: string;
  durationMs: number;
  timestamp: string;
}

/* ── Command Routing ─────────────────────────────────────────── */

export interface AgentCommand {
  domain: AgentDomain;
  action: string;
  params: Record<string, unknown>;
  priority?: "normal" | "high" | "urgent";
  requiresApproval?: boolean;
}
