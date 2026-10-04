import { AuditActorType, Prisma } from "@prisma/client";
import { ERP_AUDIT_EVENTS, recordAuditEvent, type ErpAuditEventType } from "@/lib/erp-core/audit";

export const PURCHASE_ORDER_AUDIT_EVENTS = {
  CREATED: ERP_AUDIT_EVENTS.CREATED,
  STATUS_CHANGED: ERP_AUDIT_EVENTS.STATUS_CHANGED,
  NOTE_ADDED: "note_added",
  DOCUMENT_ATTACHED: ERP_AUDIT_EVENTS.DOCUMENT_LINKED,
} as const;

interface PurchaseOrderAuditInput {
  order: { id: string; poNumber: string };
  eventType: ErpAuditEventType;
  actorType?: AuditActorType;
  actorId?: string | null;
  actorName?: string | null;
  before?: unknown;
  after?: unknown;
  metadata?: Prisma.InputJsonObject;
  aiAssisted?: boolean;
  requestId?: string | null;
}

export async function recordPurchaseOrderAuditEvent(input: PurchaseOrderAuditInput) {
  try {
    await recordAuditEvent({
      entityType: "PurchaseOrder",
      entityId: input.order.id,
      entityNumber: input.order.poNumber,
      eventType: input.eventType,
      actorType: input.actorType ?? AuditActorType.Operator,
      actorId: input.actorId ?? null,
      actorName: input.actorName ?? "operator",
      sourceModule: "purchase_orders",
      before: input.before,
      after: input.after,
      metadata: input.metadata ?? {},
      aiAssisted: input.aiAssisted ?? false,
      requestId: input.requestId ?? null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[erp-audit] PurchaseOrder ${input.order.poNumber}: ${message}`);
  }
}
