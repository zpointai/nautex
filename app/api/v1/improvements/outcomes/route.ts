import { authorizeOrganizationRequest } from "@/lib/auth/authorization";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { ApiRequestError, readJsonObject } from "@/lib/api/request";
import { fail, ok } from "@/lib/api/response";
import { submitOutcome, reviewOutcome } from "@/lib/improvements/outcomes";
async function handle(request: Request, method: "POST" | "PATCH") {
  try {
    const auth = await authorizeOrganizationRequest(request, method === "PATCH" ? PERMISSIONS.AGENTS_APPROVE : PERMISSIONS.APP_WRITE);
    if (!auth.ok) return auth.response;
    const body = await readJsonObject(request, 12 * 1024);
    return ok(await (method === "POST" ? submitOutcome(auth.context, body) : reviewOutcome(auth.context, body)));
  } catch (error) {
    if (error instanceof ApiRequestError) return fail(error.code, error.message, error.status);
    if (error && typeof error === "object" && "code" in error && ["P2002", "P2034"].includes(String(error.code))) return fail("OUTCOME_CONFLICT", "Concurrent update. Refresh and retry.", 409);
    return fail("OUTCOME_FAILED", "Outcome request failed.");
  }
}
export const POST = (request: Request) => handle(request, "POST");
export const PATCH = (request: Request) => handle(request, "PATCH");
