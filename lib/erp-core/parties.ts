import {
  PartyKind,
  PartyRoleType,
  PartyStatus,
  Prisma,
  type Party,
  type PrismaClient,
} from "@prisma/client";
import { prisma } from "@/lib/prisma";

export type PartySourceModel = "Supplier" | "ShippingCompany" | "CustomerAccount";

export interface PartyIdentityInput {
  sourceModel: PartySourceModel;
  sourceId: string;
  displayName: string;
  legalName?: string | null;
  country?: string | null;
  city?: string | null;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
  website?: string | null;
  vatId?: string | null;
  companyNumber?: string | null;
  roles: PartyRoleType[];
  sourceModule?: string;
  metadata?: Prisma.InputJsonObject;
}

export interface PartyResolution {
  party: Party;
  created: boolean;
  matchedBy: "external_reference" | "safe_name_match" | "new_party";
}

type ErpCoreDb = PrismaClient | Prisma.TransactionClient;

export const PARTY_EXTERNAL_REFERENCE_SYSTEM = "nautex";

export function normalizePartyName(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\b(bv|b\.v\.|llc|ltd|limited|inc|gmbh|sa|s\.a\.|ag|nv|n\.v\.)\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function rolesForPartySource(sourceModel: PartySourceModel): PartyRoleType[] {
  if (sourceModel === "Supplier") return [PartyRoleType.Supplier, PartyRoleType.Vendor];
  if (sourceModel === "ShippingCompany") return [PartyRoleType.ShippingCompany, PartyRoleType.Customer];
  return [PartyRoleType.Customer];
}

function cleanOptional(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function sameOptionalText(left: string | null | undefined, right: string | null | undefined) {
  const a = cleanOptional(left)?.toLowerCase() ?? null;
  const b = cleanOptional(right)?.toLowerCase() ?? null;
  return !a || !b || a === b;
}

function metadataInput(value: Prisma.InputJsonObject | undefined): Prisma.InputJsonObject {
  return value ?? {};
}

export async function findSafePartyMatch(input: {
  displayName: string;
  country?: string | null;
  city?: string | null;
}, db: ErpCoreDb = prisma) {
  const normalizedName = normalizePartyName(input.displayName);
  if (!normalizedName) return null;

  const candidates = await db.party.findMany({
    where: { normalizedName },
    orderBy: { createdAt: "asc" },
    take: 5,
  });

  const safe = candidates.filter((candidate) =>
    sameOptionalText(candidate.country, input.country) &&
    sameOptionalText(candidate.city, input.city)
  );

  return safe.length === 1 ? safe[0] : null;
}

async function ensurePartyRole(db: ErpCoreDb, partyId: string, role: PartyRoleType, input: PartyIdentityInput) {
  const existing = await db.partyRoleAssignment.findFirst({
    where: {
      partyId,
      role,
      sourceModel: input.sourceModel,
      sourceId: input.sourceId,
    },
    select: { id: true },
  });

  if (existing) return existing.id;

  const created = await db.partyRoleAssignment.create({
    data: {
      partyId,
      role,
      sourceModel: input.sourceModel,
      sourceId: input.sourceId,
      isPrimary: input.roles[0] === role,
      metadata: metadataInput(input.metadata),
    },
    select: { id: true },
  });

  return created.id;
}

async function ensurePartyAlias(db: ErpCoreDb, partyId: string, input: PartyIdentityInput) {
  const normalizedAlias = normalizePartyName(input.displayName);
  if (!normalizedAlias) return null;

  return db.partyAlias.upsert({
    where: { partyId_normalizedAlias: { partyId, normalizedAlias } },
    update: {
      alias: input.displayName.trim(),
      sourceModule: input.sourceModule ?? input.sourceModel,
    },
    create: {
      partyId,
      alias: input.displayName.trim(),
      normalizedAlias,
      aliasType: "name",
      sourceModule: input.sourceModule ?? input.sourceModel,
      confidence: 1,
      metadata: metadataInput(input.metadata),
    },
  });
}

async function ensureExternalReference(db: ErpCoreDb, partyId: string, input: PartyIdentityInput) {
  return db.externalReference.upsert({
    where: {
      system_referenceType_referenceValue: {
        system: PARTY_EXTERNAL_REFERENCE_SYSTEM,
        referenceType: input.sourceModel,
        referenceValue: input.sourceId,
      },
    },
    update: {
      partyId,
      entityType: input.sourceModel,
      entityId: input.sourceId,
      metadata: metadataInput(input.metadata),
    },
    create: {
      partyId,
      entityType: input.sourceModel,
      entityId: input.sourceId,
      system: PARTY_EXTERNAL_REFERENCE_SYSTEM,
      referenceType: input.sourceModel,
      referenceValue: input.sourceId,
      metadata: metadataInput(input.metadata),
    },
  });
}

export async function ensurePartyForSource(input: PartyIdentityInput, db: ErpCoreDb = prisma): Promise<PartyResolution> {
  const normalizedName = normalizePartyName(input.displayName);
  if (!normalizedName) throw new Error("Party display name is required.");

  const existingReference = await db.externalReference.findUnique({
    where: {
      system_referenceType_referenceValue: {
        system: PARTY_EXTERNAL_REFERENCE_SYSTEM,
        referenceType: input.sourceModel,
        referenceValue: input.sourceId,
      },
    },
    include: { party: true },
  });

  if (existingReference?.party) {
    for (const role of input.roles) await ensurePartyRole(db, existingReference.party.id, role, input);
    await ensurePartyAlias(db, existingReference.party.id, input);
    return { party: existingReference.party, created: false, matchedBy: "external_reference" };
  }

  const safeMatch = await findSafePartyMatch(input, db);
  const party = safeMatch ?? await db.party.create({
    data: {
      displayName: input.displayName.trim(),
      legalName: cleanOptional(input.legalName),
      normalizedName,
      kind: PartyKind.Organization,
      status: PartyStatus.Active,
      country: cleanOptional(input.country),
      city: cleanOptional(input.city),
      address: cleanOptional(input.address),
      phone: cleanOptional(input.phone),
      email: cleanOptional(input.email),
      website: cleanOptional(input.website),
      vatId: cleanOptional(input.vatId),
      companyNumber: cleanOptional(input.companyNumber),
      metadata: metadataInput(input.metadata),
    },
  });

  for (const role of input.roles) await ensurePartyRole(db, party.id, role, input);
  await ensurePartyAlias(db, party.id, input);
  await ensureExternalReference(db, party.id, input);

  return {
    party,
    created: !safeMatch,
    matchedBy: safeMatch ? "safe_name_match" : "new_party",
  };
}
