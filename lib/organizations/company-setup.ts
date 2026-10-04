import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ApiRequestError } from "@/lib/api/request";
import type { AuthContext } from "@/lib/auth/authorization";

function field(body: Record<string, unknown>, key: string, max = 160, required = true) {
  const value = typeof body[key] === "string" ? body[key].trim() : "";
  if ((required && !value) || value.length > max) throw new ApiRequestError("SETUP_INPUT_INVALID", `${key} ${required ? "is required and " : ""}must be at most ${max} characters.`, 400);
  return value;
}

export async function createCompanyRecord(body: Record<string, unknown>, actor: AuthContext & { organizationId: string }) {
  if (actor.roles.includes("system-agent")) throw new ApiRequestError("HUMAN_REQUIRED", "A human administrator must review company setup.", 403);
  const kind = field(body, "kind");
  if (kind !== "legal_entity" && kind !== "customer") throw new ApiRequestError("SETUP_INPUT_INVALID", "Choose a seller legal entity or customer account.", 400);
  const code = field(body, "code", 40).toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9_-]*$/.test(code)) throw new ApiRequestError("SETUP_INPUT_INVALID", "Code must use letters, numbers, hyphens or underscores.", 400);
  const common = {
    name: field(body, "name"), addressLine1: field(body, "addressLine1", 240),
    city: field(body, "city", 100), country: field(body, "country", 100),
    postalCode: field(body, "postalCode", 30, false) || null,
    defaultCurrency: field(body, "defaultCurrency", 3).toUpperCase(),
  };
  if (!/^[A-Z]{3}$/.test(common.defaultCurrency)) throw new ApiRequestError("SETUP_INPUT_INVALID", "Enter the agreed three-letter currency code.", 400);
  const vatId = field(body, "vatId", 80, kind === "legal_entity");
  const paymentTerms = kind === "customer" ? field(body, "paymentTerms", 40) : "";
  if (kind === "customer" && !/^Net (0|[1-9][0-9]{0,2})$/.test(paymentTerms)) throw new ApiRequestError("SETUP_INPUT_INVALID", "Use explicit payment terms such as Net 30 (0–999 days).", 400);
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`company-setup:${actor.organizationId}`}))::text`;
    const membership = actor.development ? null : await tx.organizationMembership.findFirst({ where: { organizationId: actor.organizationId, userId: actor.userId, status: "Active" } });
    if (!membership && !actor.development) throw new ApiRequestError("MEMBERSHIP_REQUIRED", "Active company membership is required.", 403);
    const input = kind === "legal_entity" ? { ...common, vatId, code } : { ...common, vatId: vatId || null, customerCode: code, paymentTerms };
    const existing = kind === "legal_entity"
      ? await tx.legalEntity.findUnique({ where: { organizationId_code: { organizationId: actor.organizationId, code } } })
      : await tx.customerAccount.findFirst({ where: { organizationId: actor.organizationId, customerCode: code } });
    if (existing) {
      const saved = existing as unknown as Record<string, unknown>;
      if (Object.entries(input).every(([key, value]) => saved[key] === value)) return { record: existing, reused: true };
      throw new ApiRequestError("SETUP_CODE_EXISTS", "This code already exists with different details. Existing records were not changed.", 409);
    }
    if (kind === "customer" && await tx.customerAccount.findFirst({ where: { organizationId: actor.organizationId, name: { equals: common.name, mode: "insensitive" }, status: "Active" } })) {
      throw new ApiRequestError("CUSTOMER_NAME_EXISTS", "An active customer already uses this name. Use the existing account to avoid ambiguous invoice matching.", 409);
    }
    const record = kind === "legal_entity"
      ? await tx.legalEntity.create({ data: { ...common, organizationId: actor.organizationId, code, vatId } })
      : await tx.customerAccount.create({ data: { ...common, organizationId: actor.organizationId, customerCode: code, vatId: vatId || null, paymentTerms } });
    if (kind === "legal_entity" && membership) await tx.legalEntityAccess.create({ data: { membershipId: membership.id, legalEntityId: record.id } });
    await tx.auditEvent.create({ data: { organizationId: actor.organizationId, entityType: kind === "legal_entity" ? "LegalEntity" : "CustomerAccount", entityId: record.id, entityNumber: code, eventType: "company_record_created", actorType: "User", actorId: actor.userId, actorName: actor.displayName, sourceModule: "company-setup", after: input as Prisma.InputJsonValue } });
    return { record, reused: false };
  });
}
