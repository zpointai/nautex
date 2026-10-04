import { ApiRequestError } from "@/lib/api/request";
import { fail, logApiError } from "@/lib/api/response";
import { authorizeOrganizationRequest } from "@/lib/auth/authorization";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { sourceDocumentResponse } from "@/lib/documents/source-storage";
import { prisma } from "@/lib/prisma";
import { readRfqReview } from "@/lib/rfq/review";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await authorizeOrganizationRequest(req, PERMISSIONS.APP_READ);
    if (!auth.ok) return auth.response;
    const { id } = await params;
    const rfq = await prisma.rfq.findFirst({ where: { id, organizationId: auth.context.organizationId }, select: { review: true } });
    if (!rfq) return fail("RFQ_NOT_FOUND", "RFQ not found.", 404);
    return await sourceDocumentResponse(readRfqReview(rfq.review)?.sourceDocument, auth.context.organizationId);
  } catch (error) {
    if (error instanceof ApiRequestError) return fail(error.code, error.message, error.status);
    logApiError("GET RFQ source", error);
    return fail("SOURCE_DOWNLOAD_FAILED", "Source could not be downloaded.", 500);
  }
}
