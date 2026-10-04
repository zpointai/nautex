import type { PermissionCode } from "@/lib/auth/permissions";
import { authorizeOrganizationRequest } from "@/lib/auth/authorization";
import { prisma } from "@/lib/prisma";
import { fail } from "@/lib/api/response";

export async function authorizeCustomerContractRequest(request: Request, contractId: string) {
  const authorization = await authorizeOrganizationRequest(request);
  if (!authorization.ok) return authorization;
  const contract = await prisma.customerContract.findFirst({
    where: { id: contractId, shippingCompany: { organizationId: authorization.context.organizationId } },
    select: { id: true },
  });
  if (!contract) return { ok: false as const, response: fail("CONTRACT_NOT_FOUND", "Customer contract not found.", 404) };
  return authorization;
}

export async function authorizePurchaseOrderRequest(request: Request, orderId: string, permission?: PermissionCode) {
  const authorization = await authorizeOrganizationRequest(request, permission);
  if (!authorization.ok) return authorization;
  const order = await prisma.purchaseOrder.findFirst({
    where: { id: orderId, organizationId: authorization.context.organizationId },
    select: { id: true, poNumber: true },
  });
  if (!order) return { ...authorization, ok: true as const, order: null };
  return { ...authorization, ok: true as const, order };
}

export async function authorizeAgreementRequest(request: Request, versionId: string, permission?: PermissionCode) {
  const authorization = await authorizeOrganizationRequest(request, permission);
  if (!authorization.ok) return authorization;
  const agreement = await prisma.agreementVersion.findFirst({
    where: { id: versionId, organizationId: authorization.context.organizationId },
    select: { id: true, supplierId: true },
  });
  if (!agreement) return { ...authorization, ok: true as const, agreement: null };
  return { ...authorization, ok: true as const, agreement };
}
