import { authorizeOrganizationRequest } from "@/lib/auth/authorization";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { ApiRequestError, readJsonObject } from "@/lib/api/request";
import { fail, ok } from "@/lib/api/response";
import { prisma } from "@/lib/prisma";
import type { ReplyCandidate } from "@/lib/mailbox/microsoft365";
export async function POST(request: Request) {
  const auth = await authorizeOrganizationRequest(request, PERMISSIONS.PROCUREMENT_WRITE);
  if (!auth.ok) return auth.response;
  if (auth.context.roles.includes("system-agent")) return fail("HUMAN_REQUIRED", "A human must review possible replies.", 403);
  try {
    const body = await readJsonObject(request, 4096);
    if (typeof body.runId !== "string" || typeof body.messageId !== "string" || typeof body.backorderId !== "string" || !["Accepted", "Rejected"].includes(String(body.status))) return fail("INVALID_REVIEW", "Choose a reply from a completed mailbox run and accept or reject it.", 400);
    return await prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`reply-review:${auth.context.organizationId}:${body.messageId}:${body.backorderId}`}))`;
      const run = await tx.agentRun.findFirst({ where: { id: body.runId as string, organizationId: auth.context.organizationId, agent: "backorder_reply_monitor", status: "Completed" }, include: { tasks: true } });
      const output = run?.tasks.find(task => task.action === "check_supplier_mailbox")?.output as { candidates?: ReplyCandidate[] } | null;
      const candidate = output?.candidates?.find(row => row.messageId === body.messageId && row.backorderId === body.backorderId);
      if (!candidate || !await tx.backorder.findFirst({ where: { id: candidate.backorderId, organizationId: auth.context.organizationId } })) return fail("REPLY_NOT_FOUND", "Possible reply was not found in this company's completed run.", 404);
      const prior = await tx.mailboxReply.findUnique({ where: { organizationId_messageId_backorderId: { organizationId: auth.context.organizationId, messageId: candidate.messageId, backorderId: candidate.backorderId } } });
      if (prior) return prior.status === body.status ? ok({ id: prior.id, status: prior.status, backorderStatusChanged: false }) : fail("REPLY_ALREADY_REVIEWED", "This reply already has a different decision. Review its audit before changing the business record.", 409);
      const row = await tx.mailboxReply.upsert({ where: { organizationId_messageId_backorderId: { organizationId: auth.context.organizationId, messageId: candidate.messageId, backorderId: candidate.backorderId } }, create: { organizationId: auth.context.organizationId, messageId: candidate.messageId, backorderId: candidate.backorderId, subject: candidate.subject, sender: candidate.sender, receivedAt: new Date(candidate.receivedAt), status: String(body.status), reviewedBy: auth.context.userId, runId: run!.id }, update: {} });
      if (row.status !== body.status) return fail("REPLY_ALREADY_REVIEWED", "This reply already has a different decision. Review its audit before changing the business record.", 409);
      await tx.auditEvent.create({ data: { organizationId: auth.context.organizationId, entityType: "Backorder", entityId: candidate.backorderId, eventType: "mailbox_reply_reviewed", actorId: auth.context.userId, actorName: auth.context.displayName, sourceModule: "backorders", after: { replyId: row.id, status: row.status, runId: run!.id, backorderStatusChanged: false } } });
      return ok({ id: row.id, status: row.status, backorderStatusChanged: false });
    });
  } catch (error) { return error instanceof ApiRequestError ? fail(error.code, error.message, error.status) : fail("REPLY_REVIEW_FAILED", "Could not record the reply review.", 500); }
}
