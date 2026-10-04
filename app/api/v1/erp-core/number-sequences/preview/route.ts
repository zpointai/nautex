import { NumberSequenceDocumentType } from "@prisma/client";
import { fail, logApiError, ok } from "@/lib/api/response";
import { authorizeRequest, canAccessLegalEntity } from "@/lib/auth/authorization";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { previewNextNumber } from "@/lib/erp-core/number-sequences";
import { prisma } from "@/lib/prisma";

const DOCUMENT_TYPES = new Set<string>(Object.values(NumberSequenceDocumentType));

function requireParam(searchParams: URLSearchParams, name: string) {
  const value = searchParams.get(name)?.trim();
  return value || null;
}

function parseFiscalYear(value: string | null) {
  if (!value) return undefined;
  const year = Number(value);
  return Number.isInteger(year) && year >= 2000 && year <= 2200 ? year : null;
}

export async function GET(req: Request) {
  try {
    const authorization = await authorizeRequest(req, PERMISSIONS.APP_READ);
    if (!authorization.ok) return authorization.response;

    const { searchParams } = new URL(req.url);
    const legalEntityId = requireParam(searchParams, "legalEntityId");
    const documentType = requireParam(searchParams, "documentType");
    const prefix = requireParam(searchParams, "prefix");
    const fiscalYear = parseFiscalYear(searchParams.get("fiscalYear"));

    if (!legalEntityId || !documentType || !prefix) {
      return fail("ERP_NUMBER_SEQUENCE_REQUIRED", "legalEntityId, documentType, and prefix are required.", 400);
    }

    if (!DOCUMENT_TYPES.has(documentType)) {
      return fail("ERP_NUMBER_SEQUENCE_DOCUMENT_TYPE_INVALID", "Unsupported documentType.", 400, {
        supportedDocumentTypes: Array.from(DOCUMENT_TYPES),
      });
    }

    if (fiscalYear === null) {
      return fail("ERP_NUMBER_SEQUENCE_FISCAL_YEAR_INVALID", "fiscalYear must be a four-digit year between 2000 and 2200.", 400);
    }

    if (!authorization.context.organizationId) {
      return fail("ERP_ORGANIZATION_CONTEXT_REQUIRED", "Configure an active customer organization before using number sequences.", 409);
    }

    const legalEntity = await prisma.legalEntity.findFirst({
      where: {
        id: legalEntityId,
        ...(authorization.context.organizationId ? { organizationId: authorization.context.organizationId } : {}),
      },
      select: { id: true },
    });
    if (!legalEntity || !canAccessLegalEntity(authorization.context, legalEntityId)) {
      return fail("ERP_LEGAL_ENTITY_ACCESS_DENIED", "Legal entity is not available in the active organization context.", 403);
    }

    const data = await previewNextNumber({
      organizationId: authorization.context.organizationId,
      legalEntityId,
      documentType: documentType as NumberSequenceDocumentType,
      prefix,
      fiscalYear,
    });

    return ok(data, { source: "postgres", status: "real", mutates: false });
  } catch (error) {
    logApiError("GET /api/v1/erp-core/number-sequences/preview", error);
    return fail("ERP_NUMBER_SEQUENCE_PREVIEW_FAILED", "Failed to preview ERP number sequence.");
  }
}
