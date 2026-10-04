/**
 * Audit Logger
 *
 * Records all agent actions to the audit_log table.
 * Every AI operation, data write, and workflow step is logged.
 */

import { prisma } from "@/lib/prisma";

export interface AuditLogParams {
  runId?: string;
  agent: string;
  action: string;
  target?: string;
  input?: Record<string, unknown>;
  output?: Record<string, unknown>;
  model?: string;
  provider?: string;
  durationMs?: number;
  committed?: boolean;
}

export async function logAudit(params: AuditLogParams): Promise<string> {
  const entry = await prisma.auditLog.create({
    data: {
      runId: params.runId ?? null,
      agent: params.agent,
      action: params.action,
      target: params.target ?? null,
      input: (params.input ?? {}) as object,
      output: (params.output ?? {}) as object,
      model: params.model ?? null,
      provider: params.provider ?? null,
      durationMs: params.durationMs ?? null,
      committed: params.committed ?? false,
    },
  });
  return entry.id;
}
