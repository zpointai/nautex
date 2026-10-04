import { fail, logApiError, ok } from "@/lib/api/response";
import { prisma } from "@/lib/prisma";
import { authorizeOrganizationRequest } from "@/lib/auth/authorization";

export async function GET(req: Request) {
  try {
    const authorization = await authorizeOrganizationRequest(req);
    if (!authorization.ok) return authorization.response;
    const url = new URL(req.url);
    const limit = Math.min(50, Math.max(1, Number.parseInt(url.searchParams.get("limit") || "10", 10) || 10));

    const history = await prisma.commandHistory.findMany({
      where: { organizationId: authorization.context.organizationId },
      orderBy: { createdAt: "desc" },
      take: limit,
    });

    return ok(history, { source: "prisma", status: "real" });
  } catch (error) {
    logApiError("GET /api/v1/command/history", error);
    return fail("COMMAND_HISTORY_FAILED", "Failed to fetch command history.");
  }
}
