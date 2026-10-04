import { authorizeOrganizationRequest } from "@/lib/auth/authorization";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { ApiRequestError, readJsonObject } from "@/lib/api/request";
import { fail, ok } from "@/lib/api/response";
import { improvementSnapshot, recordObservation, proposeImprovement, decideImprovement } from "@/lib/improvements/service";

async function handle(request: Request, method: "GET" | "POST" | "PATCH") {
  try {
    const authorization = await authorizeOrganizationRequest(request, method === "GET" ? PERMISSIONS.APP_READ : method === "PATCH" ? PERMISSIONS.AGENTS_APPROVE : PERMISSIONS.APP_WRITE);
    if (!authorization.ok) return authorization.response;
    const context = authorization.context;
    if (method === "GET") return ok(await improvementSnapshot(context, new URL(request.url).searchParams.get("module")), undefined, { headers: { "Cache-Control": "no-store" } });
    const body = await readJsonObject(request, 20 * 1024);
    const result = method === "PATCH" ? await decideImprovement(context, body)
      : body.action === "propose" ? await proposeImprovement(context, body)
        : await recordObservation(context, body);
    return ok(result);
  } catch (error) {
    if (error instanceof ApiRequestError) return fail(error.code, error.message, error.status);
    // Duplicate submissions and competing transactions must be retried with the same request key.
    if (error && typeof error === "object" && "code" in error && ["P2002", "P2034"].includes(String(error.code))) return fail("IMPROVEMENT_CONFLICT", "Concurrent update. Refresh and retry with the same request key.", 409);
    console.error(JSON.stringify({ event: "improvement_request_failed", method }));
    return fail("IMPROVEMENT_FAILED", "The improvement request could not be completed.");
  }
}
export const GET = (request: Request) => handle(request, "GET");
export const POST = (request: Request) => handle(request, "POST");
export const PATCH = (request: Request) => handle(request, "PATCH");
