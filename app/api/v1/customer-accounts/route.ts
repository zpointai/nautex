import { fail, logApiError, ok } from "@/lib/api/response";
import { authorizeOrganizationRequest } from "@/lib/auth/authorization";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { prisma } from "@/lib/prisma";

export async function GET(req: Request) {
  try {
    const authorization = await authorizeOrganizationRequest(req, PERMISSIONS.APP_READ);
    if (!authorization.ok) return authorization.response;
    const data = await prisma.customerAccount.findMany({
      where: { organizationId: authorization.context.organizationId, status: "Active" },
      select: {
        id: true,
        customerCode: true,
        name: true,
        city: true,
        country: true,
        paymentTerms: true,
        defaultCurrency: true,
        partyId: true,
      },
      orderBy: [{ name: "asc" }, { id: "asc" }],
    });
    return ok(data, { source: "postgres" });
  } catch (error) {
    logApiError("GET /api/v1/customer-accounts", error);
    return fail("CUSTOMER_ACCOUNT_LIST_FAILED", "Failed to load customer accounts.", 500);
  }
}
