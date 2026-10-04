import { NextResponse } from "next/server";
import { OrganizationDataMode, type UserStatus } from "@prisma/client";
import { auth } from "@/lib/auth/server";
import {
  getAuthConfigurationIssues,
  isAuthRequired,
} from "@/lib/auth/config";
import { PERMISSIONS, permissionForRequest, type PermissionCode, type RoleCode } from "@/lib/auth/permissions";
import { prisma } from "@/lib/prisma";
import { allowedOrganizationDataModes, isOrganizationDataModeAllowed } from "@/lib/data-environment";

export interface AuthContext {
  userId: string;
  displayName: string;
  email: string;
  image: string | null;
  status: UserStatus;
  roles: RoleCode[];
  permissions: string[];
  organizationId: string | null;
  organizationName: string | null;
  organizationDataMode: OrganizationDataMode | null;
  legalEntityIds: string[];
  activeLegalEntityId: string | null;
  development: boolean;
}

const DEVELOPMENT_CONTEXT: AuthContext = {
  userId: "development-operator",
  displayName: "Development Operator",
  email: "development@localhost",
  image: null,
  status: "Active",
  roles: ["admin"],
  permissions: ["*"],
  organizationId: null,
  organizationName: null,
  organizationDataMode: null,
  legalEntityIds: [],
  activeLegalEntityId: null,
  development: true,
};

const ORGANIZATION_HEADER = "x-nautex-organization-id";
const LEGAL_ENTITY_HEADER = "x-nautex-legal-entity-id";

async function getDevelopmentContext(requestHeaders: Headers): Promise<AuthContext> {
  const requestedOrganizationId = requestHeaders.get(ORGANIZATION_HEADER)
    ?? process.env.NAUTEX_DEVELOPMENT_ORGANIZATION_ID
    ?? undefined;
  const allowedDataModes = allowedOrganizationDataModes();
  const organization = await prisma.organization.findFirst({
    where: {
      ...(requestedOrganizationId ? { id: requestedOrganizationId } : {}),
      status: "Active",
      ...(allowedDataModes ? { dataMode: { in: allowedDataModes } } : {}),
    },
    include: { legalEntities: { select: { id: true }, orderBy: { createdAt: "asc" } } },
    orderBy: { createdAt: "asc" },
  }).catch(() => null);
  if (!organization) return DEVELOPMENT_CONTEXT;

  const legalEntityIds = organization.legalEntities.map((entity) => entity.id);
  const requestedLegalEntityId = requestHeaders.get(LEGAL_ENTITY_HEADER)
    ?? process.env.NAUTEX_DEVELOPMENT_LEGAL_ENTITY_ID
    ?? null;
  const activeLegalEntityId = requestedLegalEntityId && legalEntityIds.includes(requestedLegalEntityId)
    ? requestedLegalEntityId
    : legalEntityIds[0] ?? null;

  return {
    ...DEVELOPMENT_CONTEXT,
    organizationId: organization.id,
    organizationName: organization.name,
    organizationDataMode: organization.dataMode,
    legalEntityIds,
    activeLegalEntityId,
  };
}

export async function getAuthContext(requestHeaders: Headers): Promise<AuthContext | null> {
  if (!isAuthRequired()) return getDevelopmentContext(requestHeaders);
  if (getAuthConfigurationIssues().length) return null;

  const session = await auth.api.getSession({ headers: requestHeaders });
  if (!session?.user?.id) return null;

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    include: {
      memberships: {
        where: { status: "Active" },
        include: {
          organization: true,
          roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } },
          legalEntityAccess: { select: { legalEntityId: true } },
        },
        orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
      },
    },
  });
  if (!user || user.status !== "Active") return null;

  const requestedOrganizationId = requestHeaders.get(ORGANIZATION_HEADER);
  const membership = requestedOrganizationId
    ? user.memberships.find((entry) => entry.organizationId === requestedOrganizationId)
    : user.memberships[0];
  if (!membership || membership.organization.status !== "Active" || !isOrganizationDataModeAllowed(membership.organization.dataMode)) return null;

  const roles = membership.roles.map((assignment) => assignment.role.code as RoleCode);
  const permissions = [...new Set(membership.roles.flatMap((assignment) =>
    assignment.role.permissions.map((entry) => entry.permission.code),
  ))];
  const legalEntityIds = membership.legalEntityAccess.map((entry) => entry.legalEntityId);
  const requestedLegalEntityId = requestHeaders.get(LEGAL_ENTITY_HEADER);
  if (requestedLegalEntityId && !legalEntityIds.includes(requestedLegalEntityId)) return null;

  return {
    userId: user.id,
    displayName: user.name,
    email: user.email,
    image: user.image,
    status: user.status,
    roles,
    permissions,
    organizationId: membership.organizationId,
    organizationName: membership.organization.name,
    organizationDataMode: membership.organization.dataMode,
    legalEntityIds,
    activeLegalEntityId: requestedLegalEntityId ?? legalEntityIds[0] ?? null,
    development: false,
  };
}

export function hasPermission(context: Pick<AuthContext, "permissions">, permission: PermissionCode) {
  return context.permissions.includes("*") || context.permissions.includes(permission);
}

export type AuthorizationResult =
  | { ok: true; context: AuthContext }
  | { ok: false; response: NextResponse };

export async function authorizeRequest(request: Request, permission?: PermissionCode): Promise<AuthorizationResult> {
  const issues = getAuthConfigurationIssues();
  if (issues.length) {
    return {
      ok: false,
      response: NextResponse.json(
        { ok: false, error: { code: "AUTH_CONFIGURATION_INVALID", message: "Authentication is not configured for required mode." } },
        { status: 503 },
      ),
    };
  }

  const context = await getAuthContext(request.headers);
  if (!context) {
    return {
      ok: false,
      response: NextResponse.json(
        { ok: false, error: { code: "AUTHENTICATION_REQUIRED", message: "A valid Nautex session is required." } },
        { status: 401 },
      ),
    };
  }

  const requiredPermission = permission ?? permissionForRequest(new URL(request.url).pathname, request.method);
  if (!hasPermission(context, requiredPermission)) {
    return {
      ok: false,
      response: NextResponse.json(
        { ok: false, error: { code: "PERMISSION_DENIED", message: `Permission ${requiredPermission} is required.` } },
        { status: 403 },
      ),
    };
  }

  return { ok: true, context };
}

export type OrganizationAuthorizationResult =
  | { ok: true; context: AuthContext & { organizationId: string } }
  | { ok: false; response: NextResponse };

export async function authorizeOrganizationRequest(
  request: Request,
  permission?: PermissionCode,
): Promise<OrganizationAuthorizationResult> {
  const authorization = await authorizeRequest(request, permission);
  if (!authorization.ok) return authorization;
  if (!authorization.context.organizationId) {
    return {
      ok: false,
      response: NextResponse.json(
        { ok: false, error: { code: "ORGANIZATION_CONTEXT_REQUIRED", message: "An active customer organization is required." } },
        { status: 409 },
      ),
    };
  }
  return {
    ok: true,
    context: authorization.context as AuthContext & { organizationId: string },
  };
}

export function actorFromContext(context: AuthContext) {
  return {
    actorId: context.userId,
    actorName: context.displayName,
    actorType: context.development ? "Operator" as const : "User" as const,
    organizationId: context.organizationId,
    activeLegalEntityId: context.activeLegalEntityId,
  };
}

export function canAccessLegalEntity(context: AuthContext, legalEntityId: string) {
  return context.development
    ? context.legalEntityIds.length === 0 || context.legalEntityIds.includes(legalEntityId)
    : context.legalEntityIds.includes(legalEntityId);
}

export function canReadApplication(context: AuthContext) {
  return hasPermission(context, PERMISSIONS.APP_READ);
}
