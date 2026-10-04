import { authorizeOrganizationRequest } from "@/lib/auth/authorization";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { ApiRequestError, readJsonObject } from "@/lib/api/request";
import { fail, ok } from "@/lib/api/response";
import { financeWriter } from "@/lib/finance/production";
import { refreshFinanceControls, reviewOrderCosts } from "@/lib/finance/controls";
export async function POST(request: Request) {
  const auth = await authorizeOrganizationRequest(request, PERMISSIONS.FINANCE_WRITE); if (!auth.ok) return auth.response;
  try {
    const body = await readJsonObject(request, 16_384);
    if (body.action === "review_costs") return ok(await reviewOrderCosts(auth.context, body));
    if (body.action !== "refresh") return fail("FINANCE_ACTION", "Choose a supported finance action.", 400);
    financeWriter(auth.context);
    return ok(await refreshFinanceControls(auth.context.organizationId, auth.context));
  } catch (error) { return fail("FINANCE_CONTROL_FAILED", error instanceof Error ? error.message : "Finance checks failed.", error instanceof ApiRequestError ? error.status : 409); }
}
