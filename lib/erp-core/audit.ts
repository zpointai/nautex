import { AuditActorType, Prisma, type AuditEvent } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export const ERP_AUDIT_EVENTS = {
  CREATED: "created",
  EDITED: "edited",
  REVIEWED: "reviewed",
  APPROVED: "approved",
  REJECTED: "rejected",
  RESOLVED: "resolved",
  DISMISSED: "dismissed",
  ESCALATED: "escalated",
  REOPENED: "reopened",
  IMPORTED: "imported",
  EXPORTED: "exported",
  AI_ASSISTED: "ai_assisted",
  HUMAN_REVIEWED: "human_reviewed",
  STATUS_CHANGED: "status_changed",
  PRICE_CHANGED: "price_changed",
  QUANTITY_CHANGED: "quantity_changed",
  DOCUMENT_LINKED: "document_linked",
  EXCEPTION_CREATED: "exception_created",
} as const;

export type ErpAuditEventType = (typeof ERP_AUDIT_EVENTS)[keyof typeof ERP_AUDIT_EVENTS] | string;

export interface RecordAuditEventInput {
  organizationId?: string | null;
  entityType: string;
  entityId: string;
  entityNumber?: string | null;
  eventType: ErpAuditEventType;
  actorType?: AuditActorType;
  actorId?: string | null;
  actorName?: string | null;
  sourceModule: string;
  before?: unknown;
  after?: unknown;
  metadata?: Prisma.InputJsonObject;
  aiAssisted?: boolean;
  agentRunId?: string | null;
  requestId?: string | null;
}

function jsonInput(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;
}

export async function recordAuditEvent(input: RecordAuditEventInput, tx?: Prisma.TransactionClient): Promise<AuditEvent> {
  if (!input.entityType.trim()) throw new Error("Audit entityType is required.");
  if (!input.entityId.trim()) throw new Error("Audit entityId is required.");
  if (!input.eventType.trim()) throw new Error("Audit eventType is required.");
  if (!input.sourceModule.trim()) throw new Error("Audit sourceModule is required.");

  return (tx ?? prisma).auditEvent.create({
    data: {
      organizationId: input.organizationId ?? null,
      entityType: input.entityType,
      entityId: input.entityId,
      entityNumber: input.entityNumber ?? null,
      eventType: input.eventType,
      actorType: input.actorType ?? AuditActorType.Operator,
      actorId: input.actorId ?? null,
      actorName: input.actorName ?? null,
      sourceModule: input.sourceModule,
      before: input.before === undefined ? undefined : jsonInput(input.before),
      after: input.after === undefined ? undefined : jsonInput(input.after),
      metadata: input.metadata ?? {},
      aiAssisted: input.aiAssisted ?? false,
      agentRunId: input.agentRunId ?? null,
      requestId: input.requestId ?? null,
    },
  });
}

export async function listAuditEventsForEntity(
  entityType: string,
  entityId: string,
  limit = 50,
  organizationId?: string,
) {
  return prisma.auditEvent.findMany({
    where: { entityType, entityId, organizationId },
    orderBy: { createdAt: "desc" },
    take: Math.max(1, Math.min(limit, 200)),
  });
}
