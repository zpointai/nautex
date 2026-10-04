import { prisma } from "@/lib/prisma";
import { fail, logApiError, ok } from "@/lib/api/response";
import { authorizeOrganizationRequest } from "@/lib/auth/authorization";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { assignmentFilter } from "@/lib/auth/work-assignment";

export async function GET(req: Request) {
  try {
    const authorization = await authorizeOrganizationRequest(req, PERMISSIONS.APP_READ);
    if (!authorization.ok) return authorization.response;
    const assignedToId = assignmentFilter(new URL(req.url).searchParams.get("assignedTo"), authorization.context.userId);
    const data = await prisma.rfq.findMany({
      where: { organizationId: authorization.context.organizationId, ...(assignedToId !== undefined ? { assignedToId } : {}) },
      include: { lines: { orderBy: { lineNumber: "asc" } }, assignedTo: { select: { id: true, name: true, email: true } } },
      orderBy: { createdAt: "desc" },
    });
    return ok(data, { source: "postgres", demoReady: data.length > 0 });
  } catch (error) {
    logApiError("GET /api/v1/rfqs", error);
    return fail("RFQ_LIST_FAILED", "Failed to fetch RFQs.", 500);
  }
}
