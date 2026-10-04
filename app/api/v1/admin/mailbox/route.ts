import { authorizeOrganizationRequest } from "@/lib/auth/authorization";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { ApiRequestError, readJsonObject } from "@/lib/api/request";
import { fail, ok } from "@/lib/api/response";
import { beginMailboxConnection, changeMailboxConnection, mailboxStatus, pollMailboxConnection } from "@/lib/mailbox/microsoft365";
export async function GET(request: Request) {
  const auth = await authorizeOrganizationRequest(request, PERMISSIONS.ADMIN_USERS);
  if (!auth.ok) return auth.response;
  return ok(await mailboxStatus(auth.context.organizationId), undefined, { headers: { "Cache-Control": "no-store" } });
}
export async function POST(request: Request) {
  const auth = await authorizeOrganizationRequest(request, PERMISSIONS.ADMIN_USERS);
  if (!auth.ok) return auth.response;
  try {
    const body = await readJsonObject(request, 4096);
    if (body.action === "connect") return ok(await beginMailboxConnection(auth.context, body));
    if (body.action === "poll" && typeof body.flowId === "string") return ok(await pollMailboxConnection(auth.context, body.flowId));
    if (body.action === "enable" || body.action === "disable" || body.action === "disconnect") { await changeMailboxConnection(auth.context, body.action); return ok({ updated: true }); }
    return fail("MAILBOX_ACTION_INVALID", "Choose connect, poll, enable, disable or disconnect.", 400);
  } catch (error) { return error instanceof ApiRequestError ? fail(error.code, error.message, error.status) : fail("MAILBOX_REQUEST_FAILED", "Mailbox request failed. Check the connection and retry; no email was sent.", 502); }
}
