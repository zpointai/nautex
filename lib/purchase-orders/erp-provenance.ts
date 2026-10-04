import { Prisma } from "@prisma/client";
import {
  inferProvenanceKind,
  provenanceKindForOrganizationDataMode,
  recordProvenance,
} from "@/lib/erp-core/provenance";
import { prisma } from "@/lib/prisma";

interface PurchaseOrderProvenanceOrder {
  id: string;
  organizationId?: string | null;
  poNumber: string;
  orderType?: string | null;
  supplier?: string | null;
  vessel?: string | null;
}

interface PurchaseOrderProvenanceSignals {
  source?: string | null;
  trigger?: string | null;
  scenario?: string | null;
  metadata?: Prisma.InputJsonObject;
}

interface RecordPurchaseOrderProvenanceInput extends PurchaseOrderProvenanceSignals {
  order: PurchaseOrderProvenanceOrder;
  lineCount?: number;
}

function asString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asJsonObject(value: unknown): Prisma.InputJsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonObject;
}

export function normalizePurchaseOrderProvenanceSignals(value: unknown): PurchaseOrderProvenanceSignals {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const input = value as Record<string, unknown>;

  return {
    source: asString(input.source),
    trigger: asString(input.trigger),
    scenario: asString(input.scenario),
    metadata: asJsonObject(input.metadata),
  };
}

export async function recordPurchaseOrderProvenance(input: RecordPurchaseOrderProvenanceInput) {
  const metadata = {
    ...(input.metadata ?? {}),
    poNumber: input.order.poNumber,
    orderType: input.order.orderType ?? null,
    supplier: input.order.supplier ?? null,
    vessel: input.order.vessel ?? null,
    lineCount: input.lineCount ?? null,
  } satisfies Prisma.InputJsonObject;

  const organization = input.order.organizationId
    ? await prisma.organization.findUnique({ where: { id: input.order.organizationId }, select: { dataMode: true } })
    : null;
  const kind = organization
    ? provenanceKindForOrganizationDataMode(organization.dataMode)
    : inferProvenanceKind({
      id: input.order.id,
      source: input.source,
      trigger: input.trigger,
      metadata,
    });

  try {
    await recordProvenance({
      entityType: "PurchaseOrder",
      entityId: input.order.id,
      organizationId: input.order.organizationId ?? null,
      kind,
      source: input.source ?? "purchase_orders",
      scenario: input.scenario ?? input.order.orderType ?? null,
      metadata,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[erp-provenance] PurchaseOrder ${input.order.poNumber}: ${message}`);
  }
}
