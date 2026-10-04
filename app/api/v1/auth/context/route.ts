import { ok } from "@/lib/api/response";
import { authorizeRequest } from "@/lib/auth/authorization";
import { PERMISSIONS } from "@/lib/auth/permissions";

export async function GET(request: Request) {
  const authorization = await authorizeRequest(request, PERMISSIONS.APP_READ);
  if (!authorization.ok) return authorization.response;
  return ok(authorization.context, { source: authorization.context.development ? "development_auth" : "database_session" });
}
