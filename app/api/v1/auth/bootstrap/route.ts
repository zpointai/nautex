import { Prisma } from "@prisma/client";
import { fail, logApiError, ok } from "@/lib/api/response";
import { isLocalAuthMode } from "@/lib/auth/config";
import { createLocalUser, getLocalBootstrapState, prepareLocalCredential } from "@/lib/auth/local-users";
import { prisma } from "@/lib/prisma";
import { ApiRequestError, readJsonObject } from "@/lib/api/request";

export async function GET() {
  if (!isLocalAuthMode()) return ok({ enabled: false, required: false });
  const state = await getLocalBootstrapState();
  return ok({ enabled: true, required: state.required });
}

export async function POST(request: Request) {
  if (!isLocalAuthMode()) return fail("LOCAL_AUTH_DISABLED", "Local account setup is not enabled.", 404);
  try {
    const body = await readJsonObject(request, 16_384);
    const companyName = typeof body.companyName === "string" ? body.companyName.trim() : "";
    if (companyName.length < 2 || companyName.length > 160) {
      return fail("COMPANY_NAME_INVALID", "Company name must contain between 2 and 160 characters.", 400);
    }
    const prepared = await prepareLocalCredential({ name: typeof body.name === "string" ? body.name : "", email: typeof body.email === "string" ? body.email : "", password: typeof body.password === "string" ? body.password : "", roleCode: "admin" });
    const result = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(74101401)::text AS lock_result`;
      if (await tx.user.count()) throw new Error("BOOTSTRAP_ALREADY_COMPLETED");
      const role = await tx.role.findUnique({ where: { code: "admin" }, select: { id: true } });
      if (!role) throw new Error("ADMIN_ROLE_MISSING");
      const demonstration = process.env.NAUTEX_DEMO_WORKSPACE === "1";
      const organization = demonstration ? await tx.organization.findUniqueOrThrow({ where: { id: "demo-organization-001", dataMode: "Demo" } }) : await tx.organization.create({
        data: { code: "local-office", name: companyName, dataMode: "Operational", metadata: { setup: "desktop_local" } },
      });
      const user = await createLocalUser(tx, prepared);
      const membership = await tx.organizationMembership.create({
        data: { organizationId: organization.id, userId: user.id, status: "Active", isDefault: true },
      });
      await Promise.all([
        tx.organizationMembershipRole.create({ data: { membershipId: membership.id, roleId: role.id } }),
        tx.userRoleAssignment.create({ data: { userId: user.id, roleId: role.id } }),
      ]);
      if (demonstration) {
        const entities = await tx.legalEntity.findMany({ where: { organizationId: organization.id }, select: { id: true } });
        await tx.legalEntityAccess.createMany({ data: entities.map(entity => ({ membershipId: membership.id, legalEntityId: entity.id })) });
      }
      await tx.auditEvent.create({
        data: {
          organizationId: organization.id,
          entityType: "User",
          entityId: user.id,
          entityNumber: user.email,
          eventType: "local_admin_bootstrapped",
          actorType: "User",
          actorId: user.id,
          actorName: user.name,
          sourceModule: "auth",
          metadata: { organizationId: organization.id },
        },
      });
      return { organization: { id: organization.id, name: organization.name }, user: { id: user.id, name: user.name, email: user.email } };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return ok(result, undefined, { status: 201 });
  } catch (error) {
    if (error instanceof ApiRequestError) return fail(error.code, error.message, error.status);
    if (error instanceof Error && /Name must|email address|Password must/.test(error.message)) return fail("LOCAL_SETUP_INPUT_INVALID", error.message, 400);
    if (error instanceof Error && error.message === "BOOTSTRAP_ALREADY_COMPLETED") {
      return fail("BOOTSTRAP_ALREADY_COMPLETED", "Local administrator setup has already been completed.", 409);
    }
    logApiError("POST /api/v1/auth/bootstrap", error);
    return fail("LOCAL_BOOTSTRAP_FAILED", "Local administrator setup could not be completed.", 500);
  }
}
