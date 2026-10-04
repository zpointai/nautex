import { NextResponse } from "next/server";
import { extractUploadedDocument } from "@/lib/documents/extract";
import { runPurchaseOrderIntakeAgent } from "@/lib/purchase-orders/intake-agent";
import { logApiError } from "@/lib/api/response";
import { authorizeOrganizationRequest } from "@/lib/auth/authorization";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { ApiRequestError } from "@/lib/api/request";
import { assertAgentEnabled } from "@/lib/agents/controls";

const MAX_UPLOAD_BYTES = 12 * 1024 * 1024;
const ALLOWED_EXTENSIONS = new Set(["pdf", "xlsx", "xls", "csv"]);

function extensionFrom(name: string) {
  return name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? "";
}

export async function POST(req: Request) {
  try {
    const authorization = await authorizeOrganizationRequest(req, PERMISSIONS.PROCUREMENT_WRITE);
    if (!authorization.ok) return authorization.response;
    await assertAgentEnabled(authorization.context.organizationId, "nautex_po_intake");
    const formData = await req.formData();
    const file = formData.get("file");

    if (!(file instanceof File)) {
      return NextResponse.json(
        { ok: false, error: { code: "PO_INTAKE_FILE_REQUIRED", message: "Upload a PDF, Excel, or CSV purchase order file." } },
        { status: 400 },
      );
    }

    const extension = extensionFrom(file.name);
    if (!ALLOWED_EXTENSIONS.has(extension)) {
      return NextResponse.json(
        { ok: false, error: { code: "PO_INTAKE_UNSUPPORTED_FILE", message: "Supported formats are PDF, XLSX, XLS, and CSV." } },
        { status: 415 },
      );
    }

    if (file.size > MAX_UPLOAD_BYTES) {
      return NextResponse.json(
        { ok: false, error: { code: "PO_INTAKE_FILE_TOO_LARGE", message: "Purchase order uploads are limited to 12 MB." } },
        { status: 413 },
      );
    }

    const data = Buffer.from(await file.arrayBuffer()).toString("base64");
    const extracted = await extractUploadedDocument({
      name: file.name,
      type: file.type,
      mimeType: file.type,
      data,
    });

    if (!extracted.text.trim()) {
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: "PO_INTAKE_NO_TEXT",
            message: "The file was read, but no extractable text was found. Scanned PDFs will need OCR before intake.",
            details: extracted.warnings,
          },
        },
        { status: 422 },
      );
    }

    const draft = await runPurchaseOrderIntakeAgent(extracted.text, {
      organizationId: authorization.context.organizationId,
      signal: req.signal,
      fileName: extracted.fileName,
      warnings: extracted.warnings,
    });

    return NextResponse.json({
      ok: true,
      data: draft,
      meta: {
        agent: "nautex_po_intake",
        status: "review_required",
        source: "document_extraction",
      },
    });
  } catch (error) {
    if (error instanceof ApiRequestError) return NextResponse.json({ ok: false, error: { code: error.code, message: error.message } }, { status: error.status });
    logApiError("POST /api/v1/purchase-orders/process-upload", error);
    return NextResponse.json(
      { ok: false, error: { code: "PO_INTAKE_FAILED", message: "Failed to process purchase order upload." } },
      { status: 500 },
    );
  }
}
