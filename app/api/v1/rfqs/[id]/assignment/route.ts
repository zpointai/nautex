import { fail, logApiError, ok } from "@/lib/api/response";
import { authorizeOrganizationRequest } from "@/lib/auth/authorization";
import { canChangeAssignment, findAssignableUser } from "@/lib/auth/work-assignment";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { prisma } from "@/lib/prisma";

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const authorization = await authorizeOrganizationRequest(request, PERMISSIONS.PROCUREMENT_WRITE);
  if (!authorization.ok) return authorization.response;
  try {
    const { id } = await params;
    const body = await request.json();
    const targetAssigneeId = body.assignedToId === null ? null : typeof body.assignedToId === "string" ? body.assignedToId : undefined;
    if (targetAssigneeId === undefined) return fail("ASSIGNEE_INVALID", "assignedToId must be a user ID or null.", 400);
    const rfq = await prisma.rfq.findFirst({
      where: { id, organizationId: authorization.context.organizationId },
      select: { id: true, status: true, vessel: true, assignedToId: true, assignedTo: { select: { name: true } } },
    });
    if (!rfq) return fail("RFQ_NOT_FOUND", "RFQ was not found.", 404);
    if (!canChangeAssignment(authorization.context, rfq.assignedToId, targetAssigneeId)) {
      return fail("ASSIGNMENT_PERMISSION_DENIED", "Procurement approval authority is required to assign work to another employee.", 403);
    }
    const assignee = targetAssigneeId
      ? await findAssignableUser(authorization.context.organizationId, targetAssigneeId)
      : null;
    if (targetAssigneeId && !assignee) return fail("ASSIGNEE_NOT_AVAILABLE", "The selected employee is not an active procurement member.", 409);
    const updated = await prisma.$transaction(async (tx) => {
      const saved = await tx.rfq.update({
        where: { id: rfq.id },
        data: { assignedToId: targetAssigneeId },
        include: { assignedTo: { select: { id: true, name: true, email: true } }, lines: { orderBy: { lineNumber: "asc" } } },
      });
      await tx.auditEvent.create({
        data: {
          organizationId: authorization.context.organizationId,
          entityType: "Rfq",
          entityId: rfq.id,
          eventType: targetAssigneeId ? (rfq.assignedToId ? "reassigned" : "assigned") : "unassigned",
          actorType: "User",
          actorId: authorization.context.userId,
          actorName: authorization.context.displayName,
          sourceModule: "rfq",
          before: { assignedToId: rfq.assignedToId, assignedToName: rfq.assignedTo?.name ?? null },
          after: { assignedToId: targetAssigneeId, assignedToName: assignee?.name ?? null },
        },
      });
      return saved;
    });
    return ok(updated);
  } catch (error) {
    logApiError("PUT /api/v1/rfqs/:id/assignment", error);
    return fail("RFQ_ASSIGNMENT_FAILED", "RFQ assignment could not be updated.", 500);
  }
}
