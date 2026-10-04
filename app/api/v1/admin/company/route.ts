import { Prisma } from "@prisma/client";
import { authorizeOrganizationRequest } from "@/lib/auth/authorization";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { ApiRequestError, readJsonObject } from "@/lib/api/request";
import { fail, logApiError, ok } from "@/lib/api/response";
import { createCompanyRecord } from "@/lib/organizations/company-setup";
import { prisma } from "@/lib/prisma";

export async function GET(request: Request) {
  const authorization = await authorizeOrganizationRequest(request, PERMISSIONS.ADMIN_USERS);
  if (!authorization.ok) return authorization.response;
  const { organizationId } = authorization.context;
  const [organization, legalEntities, customers] = await Promise.all([
    prisma.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { name: true, dataMode: true } }),
    prisma.legalEntity.findMany({ where: { organizationId }, orderBy: { createdAt: "asc" } }),
    prisma.customerAccount.findMany({ where: { organizationId }, orderBy: { name: "asc" } }),
  ]);
  return ok({ organization, legalEntities, customers });
}

export async function POST(request: Request) {
  const authorization = await authorizeOrganizationRequest(request, PERMISSIONS.ADMIN_USERS);
  if (!authorization.ok) return authorization.response;
  try {
    const result = await createCompanyRecord(await readJsonObject(request, 16_384), authorization.context);
    return ok(result, undefined, { status: result.reused ? 200 : 201 });
  } catch (error) {
    if (error instanceof ApiRequestError) return fail(error.code, error.message, error.status);
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return fail("SETUP_CODE_UNAVAILABLE", "This code is unavailable. Choose a different code; no existing record was changed.", 409);
    logApiError("POST /api/v1/admin/company", error);
    return fail("COMPANY_SETUP_FAILED", "Company setup could not be saved. Your existing records were preserved; retry or contact support.", 500);
  }
}
