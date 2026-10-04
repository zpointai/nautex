import { ok } from "@/lib/api/response";
import { authorizeOrganizationRequest } from "@/lib/auth/authorization";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { prisma } from "@/lib/prisma";

export async function GET(request: Request) {
  const authorization = await authorizeOrganizationRequest(request, PERMISSIONS.APP_READ);
  if (!authorization.ok) return authorization.response;
  const memberships = await prisma.organizationMembership.findMany({
    where: {
      organizationId: authorization.context.organizationId,
      status: "Active",
      user: { status: "Active" },
      roles: { some: { role: { permissions: { some: { permission: { code: PERMISSIONS.PROCUREMENT_WRITE } } } } } },
    },
    select: { user: { select: { id: true, name: true, email: true } } },
    orderBy: { user: { name: "asc" } },
  });
  return ok(memberships.map((membership) => membership.user));
}
