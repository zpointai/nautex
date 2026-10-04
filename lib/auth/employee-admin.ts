import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ApiRequestError } from "@/lib/api/request";
import { hasPermission, type AuthContext } from "./authorization";
import { hashLocalPassword, isManagedUserStatus } from "./local-users";
import { PERMISSIONS, ROLE_CODES, type RoleCode } from "./permissions";

export function entitySelection(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > 100 || value.some(id => typeof id !== "string" || !id || id.length > 128) || new Set(value).size !== value.length) throw new ApiRequestError("ENTITY_ACCESS_INVALID", "Select valid, distinct seller entities.", 400);
  return value as string[];
}
export async function validateEntityAccess(tx: Prisma.TransactionClient, organizationId: string, ids: string[]) {
  const count = await tx.legalEntity.count({ where: { organizationId, id: { in: ids } } });
  if (count !== ids.length) throw new ApiRequestError("ENTITY_ACCESS_INVALID", "Seller entities must belong to this company.", 400);
}
export function employeeStatus(memberStatus: string, userStatus: string) {
  return memberStatus === "Removed" ? "Disabled" : memberStatus !== "Active" ? "Suspended" : userStatus;
}
export async function lockEmployeeAdministration(tx: Prisma.TransactionClient, context: AuthContext & { organizationId: string }) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`employees:${context.organizationId}`}))`;
  if (!context.development) {
    const actor = await tx.organizationMembership.findFirst({ where: { organizationId: context.organizationId, userId: context.userId, status: "Active", user: { status: "Active" }, roles: { some: { role: { permissions: { some: { permission: { code: PERMISSIONS.ADMIN_USERS } } } } } } } });
    if (!actor) throw new ApiRequestError("PERMISSION_DENIED", "Your administration access changed. Sign in again.", 403);
  }
}
export async function updateEmployee(context: AuthContext, id: string, body: Record<string, unknown>) {
  if (!context.organizationId || context.roles.includes("system-agent") || !hasPermission(context, PERMISSIONS.ADMIN_USERS)) throw new ApiRequestError("PERMISSION_DENIED", "An authorized company administrator is required.", 403);
  const organizationId = context.organizationId;
  const roleCode = body.roleCode as RoleCode | undefined, status = body.status;
  if (roleCode !== undefined && (!ROLE_CODES.includes(roleCode) || roleCode === "system-agent")) throw new ApiRequestError("ROLE_INVALID", "Select a human employee role.", 400);
  if (status !== undefined && !isManagedUserStatus(status)) throw new ApiRequestError("STATUS_INVALID", "Select Active, Suspended or Disabled.", 400);
  if (id === context.userId && status !== undefined && status !== "Active") throw new ApiRequestError("SELF_DISABLE_BLOCKED", "You cannot suspend or disable your own account.", 409);
  const entities = entitySelection(body.legalEntityIds);
  if (body.password !== undefined && (typeof body.password !== "string" || body.password.length < 12 || body.password.length > 128)) throw new ApiRequestError("PASSWORD_INVALID", "Password must contain 12–128 characters.", 400);
  const passwordHash = typeof body.password === "string" ? await hashLocalPassword(body.password) : undefined;
  if (roleCode === undefined && status === undefined && entities === undefined && !passwordHash) throw new ApiRequestError("UPDATE_EMPTY", "Choose a change to save.", 400);
  return prisma.$transaction(async tx => {
    await lockEmployeeAdministration(tx, { ...context, organizationId });
    const membership = await tx.organizationMembership.findUnique({ where: { organizationId_userId: { organizationId, userId: id } }, include: { user: true, roles: { include: { role: true } }, legalEntityAccess: true } });
    if (!membership) throw new ApiRequestError("EMPLOYEE_NOT_FOUND", "Employee account was not found in this company.", 404);
    const wasAdmin = membership.roles.some(entry => entry.role.code === "admin");
    if (wasAdmin && ((roleCode && roleCode !== "admin") || (status && status !== "Active"))) {
      const remaining = await tx.organizationMembership.count({ where: { organizationId, userId: { not: id }, status: "Active", user: { status: "Active" }, roles: { some: { role: { code: "admin" } } } } });
      if (!remaining) throw new ApiRequestError("LAST_ADMIN_REQUIRED", "At least one active administrator must remain.", 409);
    }
    const shared = await tx.organizationMembership.count({ where: { userId: id, organizationId: { not: organizationId } } });
    if (shared && (passwordHash || (status === "Active" && membership.user.status !== "Active"))) throw new ApiRequestError("SHARED_ACCOUNT_RECOVERY", "This account belongs to another company as well. Company administrators cannot change its global credentials or account status.", 409);
    if (entities !== undefined) {
      await validateEntityAccess(tx, organizationId, entities);
      await tx.legalEntityAccess.deleteMany({ where: { membershipId: membership.id } });
      await tx.legalEntityAccess.createMany({ data: entities.map(legalEntityId => ({ membershipId: membership.id, legalEntityId })) });
    }
    if (roleCode) {
      const role = await tx.role.findUnique({ where: { code: roleCode } });
      if (!role) throw new ApiRequestError("ROLE_INVALID", "The selected role is unavailable.", 409);
      await tx.organizationMembershipRole.deleteMany({ where: { membershipId: membership.id } });
      await tx.organizationMembershipRole.create({ data: { membershipId: membership.id, roleId: role.id } });
    }
    if (status) {
      await tx.organizationMembership.update({ where: { id: membership.id }, data: { status: status === "Disabled" ? "Removed" : status as "Active" | "Suspended" } });
      if (status === "Active" && membership.user.status !== "Active") await tx.user.update({ where: { id }, data: { status: "Active" } });
    }
    if (passwordHash) await tx.account.update({ where: { providerId_accountId: { providerId: "credential", accountId: id } }, data: { password: passwordHash } });
    await tx.session.deleteMany({ where: { userId: id } });
    await tx.auditEvent.create({ data: { organizationId, entityType: "User", entityId: id, entityNumber: membership.user.email, eventType: "employee_updated", actorType: "User", actorId: context.userId, actorName: context.displayName, sourceModule: "admin", before: { status: employeeStatus(membership.status, membership.user.status), roles: membership.roles.map(entry => entry.role.code), legalEntityIds: membership.legalEntityAccess.map(entry => entry.legalEntityId) }, after: { status: status ?? employeeStatus(membership.status, membership.user.status), role: roleCode ?? membership.roles[0]?.role.code, legalEntityIds: entities ?? membership.legalEntityAccess.map(entry => entry.legalEntityId), passwordReset: Boolean(passwordHash), sessionsRevoked: true } } });
    return { id, status: status ?? employeeStatus(membership.status, membership.user.status), sessionsRevoked: true };
  });
}
