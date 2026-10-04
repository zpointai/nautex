import { fail, logApiError, ok } from "@/lib/api/response";
import { authorizeOrganizationRequest } from "@/lib/auth/authorization";
import { isLocalAuthMode } from "@/lib/auth/config";
import { createLocalUser, prepareLocalCredential } from "@/lib/auth/local-users";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { prisma } from "@/lib/prisma";
import { ApiRequestError, readJsonObject } from "@/lib/api/request";
import { employeeStatus, entitySelection, validateEntityAccess, lockEmployeeAdministration } from "@/lib/auth/employee-admin";

export async function GET(request: Request) {
  const authorization = await authorizeOrganizationRequest(request, PERMISSIONS.ADMIN_USERS);
  if (!authorization.ok) return authorization.response;
  const memberships = await prisma.organizationMembership.findMany({
    where: { organizationId: authorization.context.organizationId },
    select: {
      id: true,
      status: true,
      isDefault: true,
      legalEntityAccess: { select: { legalEntityId: true } },
      user: { select: { id: true, name: true, email: true, status: true, lastLoginAt: true, createdAt: true } },
      roles: { select: { role: { select: { code: true, name: true } } }, orderBy: { createdAt: "asc" } },
    },
    orderBy: { createdAt: "asc" },
  });
  const [legalEntities, history] = await Promise.all([
    prisma.legalEntity.findMany({ where: { organizationId: authorization.context.organizationId }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.auditEvent.findMany({ where: { organizationId: authorization.context.organizationId, entityType: "User", sourceModule: "admin" }, select: { id: true, eventType: true, actorName: true, entityNumber: true, createdAt: true }, orderBy: { createdAt: "desc" }, take: 15 }),
  ]);
  return ok(memberships.map((membership) => ({
    ...membership.user,
    status: employeeStatus(membership.status, membership.user.status),
    legalEntityIds: membership.legalEntityAccess.map(entry => entry.legalEntityId),
    membershipId: membership.id,
    membershipStatus: membership.status,
    isDefault: membership.isDefault,
    roles: membership.roles.map((entry) => entry.role),
  })), { legalEntities, history });
}

export async function POST(request: Request) {
  const authorization = await authorizeOrganizationRequest(request, PERMISSIONS.ADMIN_USERS);
  if (!authorization.ok) return authorization.response;
  if (!isLocalAuthMode()) return fail("LOCAL_AUTH_DISABLED", "Local employee accounts are available only in local authentication mode.", 409);
  try {
    const body = await readJsonObject(request, 16384);
    if (authorization.context.roles.includes("system-agent") || body.roleCode === "system-agent") throw new ApiRequestError("ROLE_INVALID", "Employee administration requires a human role.", 403);
    const prepared = await prepareLocalCredential(body);
    const legalEntityIds = entitySelection(body.legalEntityIds) ?? [];
    const result = await prisma.$transaction(async (tx) => {
      await lockEmployeeAdministration(tx, authorization.context);
      await validateEntityAccess(tx, authorization.context.organizationId, legalEntityIds);
      const role = await tx.role.findUnique({ where: { code: prepared.roleCode }, select: { id: true, code: true, name: true } });
      if (!role) throw new Error("ROLE_NOT_FOUND");
      const user = await createLocalUser(tx, prepared);
      const membership = await tx.organizationMembership.create({
        data: { organizationId: authorization.context.organizationId, userId: user.id, status: "Active" },
      });
      await tx.organizationMembershipRole.create({ data: { membershipId: membership.id, roleId: role.id } });
      await tx.legalEntityAccess.createMany({ data: legalEntityIds.map(legalEntityId => ({ membershipId: membership.id, legalEntityId })) });
      await tx.auditEvent.create({
        data: {
          organizationId: authorization.context.organizationId,
          entityType: "User",
          entityId: user.id,
          entityNumber: user.email,
          eventType: "employee_created",
          actorType: "User",
          actorId: authorization.context.userId,
          actorName: authorization.context.displayName,
          sourceModule: "admin",
          after: { name: user.name, email: user.email, role: role.code, legalEntityIds },
        },
      });
      return { id: user.id, name: user.name, email: user.email, status: user.status, roles: [role] };
    });
    return ok(result, undefined, { status: 201 });
  } catch (error) {
    if (error instanceof ApiRequestError) return fail(error.code, error.message, error.status);
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
    if (code === "P2002") return fail("EMAIL_ALREADY_EXISTS", "An employee with this email already exists.", 409);
    const message = error instanceof Error ? error.message : "Local employee creation failed.";
    if (/Name must|email address|Password must|role is required/.test(message)) return fail("EMPLOYEE_INPUT_INVALID", message, 400);
    logApiError("POST /api/v1/admin/users", error);
    return fail("EMPLOYEE_CREATE_FAILED", "Local employee creation failed.", 500);
  }
}
