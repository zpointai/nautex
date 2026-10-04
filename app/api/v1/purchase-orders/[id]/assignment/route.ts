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
    const order = await prisma.purchaseOrder.findFirst({
      where: { id, organizationId: authorization.context.organizationId },
      select: { id: true, poNumber: true, assignedToId: true, assignedTo: { select: { name: true } } },
    });
    if (!order) return fail("PURCHASE_ORDER_NOT_FOUND", "Purchase order was not found.", 404);
    if (!canChangeAssignment(authorization.context, order.assignedToId, targetAssigneeId)) {
      return fail("ASSIGNMENT_PERMISSION_DENIED", "Procurement approval authority is required to assign work to another employee.", 403);
    }
    const assignee = targetAssigneeId
      ? await findAssignableUser(authorization.context.organizationId, targetAssigneeId)
      : null;
    if (targetAssigneeId && !assignee) return fail("ASSIGNEE_NOT_AVAILABLE", "The selected employee is not an active procurement member.", 409);
    const updated = await prisma.$transaction(async (tx) => {
      const saved = await tx.purchaseOrder.update({
        where: { id: order.id },
        data: { assignedToId: targetAssigneeId },
        include: {
          assignedTo: { select: { id: true, name: true, email: true } },
          lines: { orderBy: { lineNumber: "asc" } },
          _count: { select: { lines: true, childOrders: true } },
        },
      });
      const eventType = targetAssigneeId ? (order.assignedToId ? "reassigned" : "assigned") : "unassigned";
      await Promise.all([
        tx.purchaseOrderEvent.create({
          data: {
            orderId: order.id,
            type: eventType,
            summary: targetAssigneeId ? `Assigned to ${assignee!.name}` : "Assignment removed",
            detail: JSON.stringify({ before: order.assignedToId, after: targetAssigneeId }),
            actor: authorization.context.displayName,
          },
        }),
        tx.auditEvent.create({
          data: {
            organizationId: authorization.context.organizationId,
            entityType: "PurchaseOrder",
            entityId: order.id,
            entityNumber: order.poNumber,
            eventType,
            actorType: "User",
            actorId: authorization.context.userId,
            actorName: authorization.context.displayName,
            sourceModule: "purchase_orders",
            before: { assignedToId: order.assignedToId, assignedToName: order.assignedTo?.name ?? null },
            after: { assignedToId: targetAssigneeId, assignedToName: assignee?.name ?? null },
          },
        }),
      ]);
      return saved;
    });
    return ok(updated);
  } catch (error) {
    logApiError("PUT /api/v1/purchase-orders/:id/assignment", error);
    return fail("PURCHASE_ORDER_ASSIGNMENT_FAILED", "Purchase order assignment could not be updated.", 500);
  }
}
