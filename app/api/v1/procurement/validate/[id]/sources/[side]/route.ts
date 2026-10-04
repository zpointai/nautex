import { ApiRequestError } from "@/lib/api/request";
import { fail, logApiError } from "@/lib/api/response";
import { authorizeOrganizationRequest } from "@/lib/auth/authorization";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { sourceDocumentResponse } from "@/lib/documents/source-storage";
import { prisma } from "@/lib/prisma";
import type { ValidationSourceDocument } from "@/lib/procurement/validator";

export async function GET(req: Request, { params }: { params: Promise<{ id: string; side: string }> }) {
  try {
    const auth = await authorizeOrganizationRequest(req, PERMISSIONS.APP_READ);
    if (!auth.ok) return auth.response;
    const { id, side } = await params;
    if (side !== "left" && side !== "right") return fail("SOURCE_NOT_FOUND", "Source side not found.", 404);
    const run = await prisma.validationRun.findFirst({ where: { id, organizationId: auth.context.organizationId }, select: { summary: true } });
    if (!run) return fail("VALIDATION_NOT_FOUND", "Validation run not found.", 404);
    const summary = run.summary as { sourceDocuments?: ValidationSourceDocument[] };
    return await sourceDocumentResponse(summary.sourceDocuments?.[side === "left" ? 0 : 1]?.sourceDocument, auth.context.organizationId);
  } catch (error) {
    if (error instanceof ApiRequestError) return fail(error.code, error.message, error.status);
    logApiError("GET validation source", error);
    return fail("SOURCE_DOWNLOAD_FAILED", "Source could not be downloaded.", 500);
  }
}
