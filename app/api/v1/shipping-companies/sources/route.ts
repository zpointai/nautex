import { authorizeOrganizationRequest } from "@/lib/auth/authorization";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { ApiRequestError, readJsonObject } from "@/lib/api/request";
import { fail, ok } from "@/lib/api/response";
import { discoverCompany, reviewCompanySources } from "@/lib/shipping-companies/source-discovery";

export async function POST(request: Request) {
  const authorization = await authorizeOrganizationRequest(request, PERMISSIONS.SUPPLIERS_WRITE);
  if (!authorization.ok) return authorization.response;
  if (authorization.context.roles.includes("system-agent")) return fail("HUMAN_REQUIRED", "A human operator must request and review company-source discovery.", 403);
  try {
    const body = await readJsonObject(request, 16_384);
    if (Object.keys(body).some(key => !["action", "companyId", "reviewId", "candidateId", "fields", "confirmIdentity", "reviewNote", "allowPublicLookup"].includes(key))) return fail("SOURCE_FIELDS_INVALID", "Unsupported source-review field.", 400);
    if (typeof body.companyId !== "string" || !body.companyId || body.companyId.length > 150) return fail("COMPANY_ID_REQUIRED", "Select a shipping company.", 400);
    if (body.action === "search") {
      if (body.allowPublicLookup !== true) return fail("SOURCE_LOOKUP_CONSENT", "Confirm that the company name may be used in a public source search.", 400);
      return ok(await discoverCompany(authorization.context, body.companyId, request.signal));
    }
    return ok(await reviewCompanySources(authorization.context, body));
  } catch (error) {
    return error instanceof ApiRequestError ? fail(error.code, error.message, error.status) : fail("SOURCE_REVIEW_FAILED", "Could not complete source review. Your saved company remains available.", 500);
  }
}
