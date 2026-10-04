import { authorizeOrganizationRequest } from "@/lib/auth/authorization";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { ApiRequestError, readJsonObject } from "@/lib/api/request";
import { fail, ok } from "@/lib/api/response";
import { runEvaluation } from "@/lib/improvements/evaluations";
export async function POST(request: Request) {
  try {
    const auth = await authorizeOrganizationRequest(request, PERMISSIONS.AGENTS_APPROVE);
    if (!auth.ok) return auth.response;
    return ok(await runEvaluation(auth.context, await readJsonObject(request, 4 * 1024)));
  } catch (error) {
    if (error instanceof ApiRequestError) return fail(error.code, error.message, error.status);
    if (error && typeof error === "object" && "code" in error && ["P2002", "P2034"].includes(String(error.code))) return fail("EVALUATION_CONFLICT", "Concurrent update. Refresh and retry with the same request key.", 409);
    return fail("EVALUATION_FAILED", "Evaluation failed. No result or business change was committed.");
  }
}
