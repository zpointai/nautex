import { OrganizationDataMode, Prisma, ProvenanceKind, type DataProvenance } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export type ProvenanceMode = "operational" | "demo" | "screenshot" | "test" | "all";

export interface RecordProvenanceInput {
  organizationId?: string | null;
  entityType: string;
  entityId: string;
  kind: ProvenanceKind;
  source?: string | null;
  scenario?: string | null;
  metadata?: Prisma.InputJsonObject;
}

export function inferProvenanceKind(input: {
  id?: string | null;
  source?: string | null;
  trigger?: string | null;
  metadata?: Record<string, unknown> | null;
}): ProvenanceKind {
  const haystack = [
    input.id,
    input.source,
    input.trigger,
    input.metadata ? JSON.stringify(input.metadata) : null,
  ].filter(Boolean).join(" ").toLowerCase();

  if (haystack.includes("screenshot")) return ProvenanceKind.Screenshot;
  if (haystack.includes("test")) return ProvenanceKind.Test;
  if (haystack.includes("demo")) return ProvenanceKind.Demo;
  if (haystack.includes("seed")) return ProvenanceKind.Seed;
  if (haystack.includes("import")) return ProvenanceKind.Imported;
  if (haystack.includes("system")) return ProvenanceKind.System;
  return ProvenanceKind.Operational;
}

export function isOperationalKind(kind: ProvenanceKind) {
  return kind === ProvenanceKind.Operational || kind === ProvenanceKind.Imported;
}

export function provenanceKindForOrganizationDataMode(mode: OrganizationDataMode): ProvenanceKind {
  if (mode === OrganizationDataMode.Demo) return ProvenanceKind.Demo;
  if (mode === OrganizationDataMode.Screenshot) return ProvenanceKind.Screenshot;
  if (mode === OrganizationDataMode.Test) return ProvenanceKind.Test;
  return ProvenanceKind.Operational;
}

export function matchesProvenanceMode(kind: ProvenanceKind, mode: ProvenanceMode) {
  if (mode === "all") return true;
  if (mode === "operational") return isOperationalKind(kind);
  if (mode === "demo") return kind === ProvenanceKind.Demo || kind === ProvenanceKind.Seed;
  if (mode === "screenshot") return kind === ProvenanceKind.Screenshot;
  return kind === ProvenanceKind.Test;
}

export async function recordProvenance(input: RecordProvenanceInput, tx?: Prisma.TransactionClient): Promise<DataProvenance> {
  if (!input.entityType.trim()) throw new Error("Provenance entityType is required.");
  if (!input.entityId.trim()) throw new Error("Provenance entityId is required.");

  return (tx ?? prisma).dataProvenance.upsert({
    where: { entityType_entityId: { entityType: input.entityType, entityId: input.entityId } },
    update: {
      organizationId: input.organizationId ?? null,
      kind: input.kind,
      source: input.source ?? null,
      scenario: input.scenario ?? null,
      metadata: input.metadata ?? {},
    },
    create: {
      organizationId: input.organizationId ?? null,
      entityType: input.entityType,
      entityId: input.entityId,
      kind: input.kind,
      source: input.source ?? null,
      scenario: input.scenario ?? null,
      metadata: input.metadata ?? {},
    },
  });
}

export async function getProvenance(entityType: string, entityId: string, organizationId?: string) {
  return prisma.dataProvenance.findFirst({
    where: { entityType, entityId, organizationId },
  });
}

export async function listProvenanceForEntities(entityType: string, entityIds: string[], organizationId?: string) {
  if (entityIds.length === 0) return new Map<string, DataProvenance>();

  const rows = await prisma.dataProvenance.findMany({
    where: { entityType, entityId: { in: entityIds }, organizationId },
  });

  return new Map(rows.map((row) => [row.entityId, row]));
}
