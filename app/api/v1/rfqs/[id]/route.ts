import { fail, logApiError, ok } from "@/lib/api/response";
import { authorizeOrganizationRequest } from "@/lib/auth/authorization";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { ApiRequestError, readJsonObject } from "@/lib/api/request";
import { readRfqReview, reviewedItemNumber, reviewIssues, type ReviewFields, type RfqReview } from "@/lib/rfq/review";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const authorization = await authorizeOrganizationRequest(req, PERMISSIONS.APP_READ);
    if (!authorization.ok) return authorization.response;
    const { id } = await params;
    const rfq = await prisma.rfq.findFirst({
      where: { id, organizationId: authorization.context.organizationId },
      include: {
        lines: {
          orderBy: { lineNumber: "asc" },
          include: { supplierQuotes: { include: { supplier: true }, orderBy: { unitPrice: "asc" } } },
        },
      },
    });

    if (!rfq) return fail("RFQ_NOT_FOUND", "RFQ not found.", 404);

    return ok({
      ok: true,
      summary: `${rfq.lines.length} persisted RFQ line${rfq.lines.length === 1 ? "" : "s"} for ${rfq.vessel}.`,
      rfqId: rfq.id,
      persisted: true,
      review: rfq.review,
      updatedAt: rfq.updatedAt.toISOString(),
      lines: rfq.lines.map((line) => ({
        originalItem: {
          itemNumber: reviewedItemNumber(readRfqReview(rfq.review), line.lineNumber - 1),
          currency: readRfqReview(rfq.review)?.currencies[line.lineNumber - 1] ?? "",
          quantity: line.quantity,
          specifications: line.description,
          unit: line.unit,
        },
        supplierOptions: line.supplierQuotes.map((quote, index) => ({
          rank: index + 1,
          supplierId: quote.supplierId,
          supplierName: quote.supplier.name,
          price: quote.unitPrice,
          currency: quote.currency,
          stockStatus: quote.stockStatus ?? "Unknown",
          leadTimeDays: quote.leadTimeDays ?? 0,
          moqCompliant: true,
          reasoning: "Persisted supplier quote",
          flags: [],
          supplierArticleNumber: "",
          impaCode: line.impaCode ?? "",
          matchConfidence: "HIGH",
          matchMethod: "DIRECT",
        })),
        hasMultipleOptions: line.supplierQuotes.length > 1,
        noMatchFound: line.supplierQuotes.length === 0,
        notes: "Loaded from persisted RFQ data.",
        flags: [],
        matchConfidence: line.supplierQuotes.length ? "HIGH" : "NONE",
        matchMethod: line.supplierQuotes.length ? "DIRECT" : "NONE",
      })),
      audit: {
        invocationId: `persisted-${rfq.id}`,
        timestamp: rfq.updatedAt.toISOString(),
        modelUsed: "persisted-record",
        executionTimeMs: 0,
      },
    }, { source: "postgres" });
  } catch (error) {
    logApiError("GET /api/v1/rfqs/:id", error);
    return fail("RFQ_READ_FAILED", "RFQ could not be opened.", 500);
  }
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await authorizeOrganizationRequest(req, PERMISSIONS.PROCUREMENT_WRITE);
    if (!auth.ok) return auth.response;
    const { id } = await params;
    const body = await readJsonObject(req, 2 * 1024 * 1024);
    if (!Array.isArray(body.lines) || !body.lines.length || body.lines.length > 1000 || !["save", "confirm", "reject"].includes(String(body.action)))
      return fail("REVIEW_INVALID", "Provide 1–1000 lines and a valid review action.", 400);
    const lines = body.lines as ReviewFields[];
    if (lines.some(l => !l || typeof l.itemNumber !== "string" || l.itemNumber.length > 80 || typeof l.specifications !== "string" || l.specifications.length > 10000
      || typeof l.quantity !== "number" || !Number.isFinite(l.quantity) || Math.abs(l.quantity) > 1e9
      || typeof l.unit !== "string" || l.unit.length > 30 || (l.currency !== undefined && (typeof l.currency !== "string" || l.currency.length > 3))))
      return fail("REVIEW_INVALID", "Line values are invalid or exceed supported limits.", 400);
    const issues = reviewIssues(lines);
    if (body.action === "confirm" && issues.some(row => row.some(issue => !issue.startsWith("Possible duplicate"))))
      return fail("REVIEW_UNRESOLVED", "Correct missing or invalid descriptions, quantities, units and currencies before confirming.", 422);
    if (body.action === "confirm" && !body.duplicatesAcknowledged && issues.some(row=>row.some(i=>i.startsWith("Possible duplicate")))) return fail("REVIEW_DUPLICATES", "Check possible duplicates against the source and acknowledge them before confirming.", 422);
    const result = await prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM rfqs WHERE id = ${id} AND organization_id = ${auth.context.organizationId} FOR UPDATE`;
      const rfq = await tx.rfq.findFirst({ where: {id, organizationId:auth.context.organizationId}, include:{lines:{orderBy:{lineNumber:"asc"}}, _count:{select:{supplierInquiries:true, purchaseOrders:true,customerQuotes:true,salesOrders:true}}} });
      if (!rfq) throw new ApiRequestError("RFQ_NOT_FOUND", "RFQ not found.", 404);
      if (rfq.updatedAt.toISOString() !== body.updatedAt) throw new ApiRequestError("REVIEW_CONFLICT", "This RFQ changed elsewhere. Reopen it before saving; your local edits are still visible.", 409);
      if (rfq.status !== "Draft" || Object.values(rfq._count).some(n => n > 0)) throw new ApiRequestError("REVIEW_LOCKED", "This RFQ is linked to downstream work. Its extraction can no longer be edited.", 409);
      if (lines.length !== rfq.lines.length) throw new ApiRequestError("REVIEW_LINE_COUNT", "Keep all source lines; flag unwanted or duplicate lines for review.", 400);
      const previous = readRfqReview(rfq.review);
      const fields = rfq.lines.map((l,i)=>({itemNumber:reviewedItemNumber(previous,i),specifications:l.description,quantity:l.quantity,unit:l.unit,currency:previous?.currencies[i] ?? ""}));
      const now = new Date().toISOString();
      const changes = lines.flatMap((l,i) => (["itemNumber","specifications","quantity","unit","currency"] as const).every(key=>(l[key] ?? "") === (fields[i][key] ?? "")) ? [] : [{at:now,actorId:auth.context.userId,line:i,before:fields[i],after:l}]);
      if ((previous?.edits.length ?? 0) + changes.length > 10000) throw new ApiRequestError("REVIEW_HISTORY_LIMIT", "Review history has reached its safe size limit. Contact an administrator.", 409);
      const review: RfqReview = {...(previous ?? {version:1,sourceText:"",fileName:null,sourceKind:"legacy",warnings:["Original document provenance unavailable for this legacy RFQ."],originals:fields,requestKey:null}),
        itemNumbers:lines.map(l=>l.itemNumber), currencies:lines.map(l=>l.currency ?? ""), selectedLine:Math.max(0,Math.min(lines.length-1,Number.isInteger(body.selectedLine) ? Number(body.selectedLine) : 0)),
        status:body.action === "confirm" ? "confirmed" : body.action === "reject" ? "rejected" : "pending",
        decisionAt:body.action === "save" ? null : now, decisionBy:body.action === "save" ? null : auth.context.userId,
        edits:[...(previous?.edits ?? []),...changes]};
      for (const [i,l] of lines.entries()) {
        if (changes.some(c=>c.line===i)) {
          // An old match does not establish a price for a corrected item or unit.
          await tx.supplierQuote.deleteMany({where:{rfqLineId:rfq.lines[i].id}});
          await tx.rfqLine.update({where:{id:rfq.lines[i].id},data:{description:l.specifications,quantity:l.quantity,unit:l.unit,normalizedDesc:l.specifications.toLowerCase(),impaCode:null}});
        }
      }
      const saved = await tx.rfq.update({where:{id},data:{review:review as unknown as Prisma.InputJsonValue}});
      if (body.action !== "save") await tx.auditEvent.create({data:{organizationId:auth.context.organizationId,entityType:"rfq_review",entityId:id,eventType:"human_review",sourceModule:"rfqAutomation",actorId:auth.context.userId,
        metadata:{outcome:body.action === "reject" ? "rejected" : review.edits.length ? "accepted_with_corrections" : "accepted_unchanged",correctedFields:review.edits.length}}});
      return {review,updatedAt:saved.updatedAt.toISOString()};
    });
    return ok(result,{source:"postgres",status:"draft"});
  } catch (error) {
    if (error instanceof ApiRequestError) return fail(error.code,error.message,error.status);
    logApiError("PATCH /api/v1/rfqs/:id",error);
    return fail("REVIEW_SAVE_FAILED","Review could not be saved.",500);
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const authorization = await authorizeOrganizationRequest(req, PERMISSIONS.PROCUREMENT_WRITE);
    if (!authorization.ok) return authorization.response;
    const { id } = await params;
    const rfq = await prisma.rfq.findFirst({
      where: { id, organizationId: authorization.context.organizationId },
      include: {
        lines: { select: { id: true } },
        _count: { select: { purchaseOrders: true, supplierInquiries: true, customerQuotes: true, salesOrders: true } },
      },
    });

    if (!rfq) return fail("RFQ_NOT_FOUND", "RFQ not found.", 404);
    if (rfq.status !== "Draft") return fail("RFQ_DELETE_BLOCKED", "Only Draft RFQs can be deleted.", 409);

    const linkedCount = Object.values(rfq._count).reduce((total, count) => total + count, 0);
    if (linkedCount > 0) {
      return fail("RFQ_DELETE_BLOCKED", "This RFQ is linked to downstream procurement records and cannot be deleted.", 409);
    }

    await prisma.$transaction(async (tx) => {
      const lineIds = rfq.lines.map((line) => line.id);
      if (lineIds.length) await tx.supplierQuote.deleteMany({ where: { rfqLineId: { in: lineIds } } });
      await tx.rfq.delete({ where: { id: rfq.id } });
    });

    return ok({ id: rfq.id, deleted: true }, { source: "postgres" });
  } catch (error) {
    logApiError("DELETE /api/v1/rfqs/:id", error);
    return fail("RFQ_DELETE_FAILED", "RFQ could not be deleted.", 500);
  }
}
