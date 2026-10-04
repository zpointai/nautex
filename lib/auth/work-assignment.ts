import type { AuthContext } from "@/lib/auth/authorization";
import { hasPermission } from "@/lib/auth/authorization";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { prisma } from "@/lib/prisma";

export function canChangeAssignment(context: AuthContext, currentAssigneeId: string | null, targetAssigneeId: string | null) {
  if (hasPermission(context, PERMISSIONS.PROCUREMENT_APPROVE)) return true;
  if (targetAssigneeId === context.userId) return true;
  return targetAssigneeId === null && currentAssigneeId === context.userId;
}

export async function findAssignableUser(organizationId: string, userId: string) {
  const membership = await prisma.organizationMembership.findFirst({
    where: {
      organizationId,
      userId,
      status: "Active",
      user: { status: "Active" },
      roles: { some: { role: { permissions: { some: { permission: { code: PERMISSIONS.PROCUREMENT_WRITE } } } } } },
    },
    select: { user: { select: { id: true, name: true, email: true } } },
  });
  return membership?.user ?? null;
}

export function assignmentFilter(value: string | null, currentUserId: string) {
  if (!value) return undefined;
  if (value === "me") return currentUserId;
  if (value === "unassigned") return null;
  return value;
}
