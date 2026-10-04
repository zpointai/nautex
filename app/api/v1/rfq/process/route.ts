import crypto from "crypto";
import { isAIConfigured } from "@/lib/ai";
import { processRFQ } from "@/lib/ai/services/rfq";
import { ApiRequestError, assertUploadFile, readJsonObject } from "@/lib/api/request";
import { fail, logApiError, ok } from "@/lib/api/response";
import { authorizeOrganizationRequest } from "@/lib/auth/authorization";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { extractUploadedDocument } from "@/lib/documents/extract";
import { processRFQDeterministic } from "@/lib/rfq/deterministic";
import { persistRFQProcessResult } from "@/lib/rfq/persistence";
import type { RFQProcessResult } from "@/lib/ai/services/rfq";
import type { SourceUpload } from "@/lib/documents/source-storage";

import { boundedFormData } from "@/lib/api/bounded-form";
import { executeIdempotentRequest } from "@/lib/api/idempotency";
import { prisma } from "@/lib/prisma";
import { assertAgentEnabled } from "@/lib/agents/controls";
import { GET as reopenRFQ } from "@/app/api/v1/rfqs/[id]/route";

const MAX_UPLOAD_BYTES = 12 * 1024 * 1024;
const ALLOWED_EXTENSIONS = new Set(["pdf", "xlsx", "xls", "csv", "docx", "txt"]);

function isUsableRFQResult(data: RFQProcessResult) {
  return Array.isArray(data.lines) && data.lines.every((line) =>
    line.originalItem
    && typeof line.originalItem.specifications === "string"
    && Array.isArray(line.supplierOptions)
    && line.supplierOptions.every((option) =>
      option
      && typeof option === "object"
      && typeof option.supplierName === "string"
      && typeof option.price === "number"
    )
  );
}

/**
 * POST /api/v1/rfq/process
 *
 * RFQ document processing — parses uploaded documents and matches
 * line items against supplier database using AI when configured.
 * Returns empty result when AI is not available.
 */
export async function POST(req: Request) {
  try {
    const authorization = await authorizeOrganizationRequest(req, PERMISSIONS.PROCUREMENT_WRITE);
    if (!authorization.ok) return authorization.response;
    await assertAgentEnabled(authorization.context.organizationId, "rfq_intake");
    const contentType = req.headers.get("content-type") ?? "";
    let documentText = "";
    let fileName: string | null = null;
    let extractionWarnings: string[] = [];
    let forceFallback = false;
    let vessel: string | undefined;
    let port: string | undefined;
    let neededBy: string | undefined;
    let sourceUpload: SourceUpload | undefined;

    // Support both JSON and FormData
    if (contentType.includes("application/json")) {
      const body = await readJsonObject(req);
      documentText = typeof (body.text ?? body.documentText) === "string" ? String(body.text ?? body.documentText) : "";
      forceFallback = body.forceFallback === true;
      vessel = typeof body.vessel === "string" ? body.vessel.slice(0,200) : undefined;
      port = typeof body.port === "string" ? body.port.slice(0,200) : undefined;
      neededBy = typeof body.neededBy === "string" ? body.neededBy.slice(0,200) : undefined;
    } else if (contentType.includes("multipart/form-data")) {
      const formData = await boundedFormData(req, MAX_UPLOAD_BYTES + 64 * 1024);
      forceFallback = formData.get("forceFallback") === "true";
      vessel = formData.get("vessel")?.toString();
      port = formData.get("port")?.toString();
      neededBy = formData.get("neededBy")?.toString();
      const file = formData.get("file");
      if (file instanceof File) {
        fileName = file.name.slice(0,255);
        // Reading the file as text would return the raw container bytes for
        // binary formats: a PDF arrives as "%PDF-1.5 << /Type /Pages ...",
        // which the line-item parser then treats as content. Route uploads
        // through the shared extractor so PDF, spreadsheet, and Word documents
        // yield their actual text.
        assertUploadFile(file, {
          requiredCode: "RFQ_FILE_REQUIRED",
          emptyCode: "RFQ_FILE_EMPTY",
          tooLargeCode: "RFQ_FILE_TOO_LARGE",
          maxBytes: MAX_UPLOAD_BYTES,
          allowedExtensions: ALLOWED_EXTENSIONS,
        });
        const bytes = Buffer.from(await file.arrayBuffer());
        sourceUpload = { data: bytes, fileName, mimeType: file.type || "application/octet-stream" };
        const data = bytes.toString("base64");
        const extracted = await extractUploadedDocument({
          name: file.name,
          type: file.type,
          mimeType: file.type,
          data,
        });
        documentText = extracted.text;
        extractionWarnings = extracted.warnings;
      }
    }

    // A scanned or image-only PDF yields no selectable text. Say so instead of
    // routing an empty document and reporting every line as "no supplier match".
    if (!documentText.trim() && extractionWarnings.length) {
      return fail("RFQ_TEXT_NOT_EXTRACTED", extractionWarnings.join(" "), 422);
    }

    if (!documentText.trim()) return fail("RFQ_TEXT_REQUIRED", "Provide a supported RFQ with selectable text. Image-only PDFs require OCR outside Nautex or a text/spreadsheet export.", 422);
    if (documentText.length > 200000) return fail("RFQ_TEXT_TOO_LARGE", "Extracted text exceeds 200,000 characters. Split the document into smaller RFQs.", 413);
    const sourceSha256 = sourceUpload ? crypto.createHash("sha256").update(sourceUpload.data).digest("hex") : null;
    const normalized = JSON.stringify({documentText,fileName,sourceSha256,forceFallback,vessel,port,neededBy});
    const key = req.headers.get("idempotency-key");
    const requestKey = key ? key + ":" + crypto.createHash("sha256").update(normalized).digest("hex") : null;
    return await executeIdempotentRequest({request:new Request(req.url,{method:"POST",headers:{"content-type":"application/json",...(key ? {"idempotency-key":key} : {})},body:normalized}), organizationId:authorization.context.organizationId, route:"POST /api/v1/rfq/process", handler: async () => {
    if (requestKey) {
      const saved = await prisma.rfq.findFirst({where:{organizationId:authorization.context.organizationId,review:{path:["requestKey"],equals:requestKey}},select:{id:true}});
      if (saved) return reopenRFQ(req,{params:Promise.resolve({id:saved.id})});
    }
    if (req.signal.aborted) return fail("RFQ_CANCELLED", "Processing cancelled before draft creation.", 499);
    const audit = {
      invocationId: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      modelUsed: "none",
      executionTimeMs: 0,
    };

    // ── AI Path ──
    if (documentText && isAIConfigured() && !forceFallback) {
      const start = Date.now();
      const aiResult = await processRFQ(documentText,{organizationId:authorization.context.organizationId,signal:req.signal});
      audit.executionTimeMs = Date.now() - start;

      if (aiResult.ok && aiResult.data && aiResult.data.lines.length > 0 && isUsableRFQResult(aiResult.data)) {
        if (req.signal.aborted) return fail("RFQ_CANCELLED", "Processing cancelled before draft creation.", 499);
        audit.modelUsed = aiResult.model;
        const persisted = await persistRFQProcessResult(aiResult.data, {
          organizationId: authorization.context.organizationId,
          documentText, fileName, sourceUpload, warnings:extractionWarnings, requestKey,
          source: "ai_provider",
          model: aiResult.model,
          provider: aiResult.provider,
          vessel,
          port,
          neededBy,
        });
        return ok(
          {
            ok: true,
            _stub: false,
            ...persisted,
            audit,
            _ai: { model: aiResult.model, provider: aiResult.provider },
          },
          { source: "ai_provider", status: "partial" },
        );
      }
    }

    const start = Date.now();
    const fallbackResult = await processRFQDeterministic(documentText, authorization.context.organizationId);
    if (!fallbackResult.lines.length || fallbackResult.lines.length > 1000) return fail("RFQ_LINES_UNSUPPORTED", "No supported lines found, or the document exceeds 1,000 lines. Supply a smaller structured document.", 422);
    if (req.signal.aborted) return fail("RFQ_CANCELLED", "Processing cancelled before draft creation.", 499);
    audit.executionTimeMs = Date.now() - start;
    const persisted = await persistRFQProcessResult(fallbackResult, {
      organizationId: authorization.context.organizationId,
      documentText, fileName, sourceUpload, warnings: extractionWarnings, requestKey,
      source: "deterministic_prisma",
      model: "deterministic-prisma",
      provider: "nautex",
      vessel,
      port,
      neededBy,
    });

    return ok(
      {
        ok: true,
        _stub: false,
        _fallback: true,
        ...persisted,
        audit: { ...audit, modelUsed: "deterministic-prisma" },
      },
      {
        source: "deterministic_prisma",
        status: "partial",
        message: forceFallback
          ? "Used deterministic Prisma routing because fallback mode was requested."
          : isAIConfigured()
            ? "Used deterministic fallback because the AI response was not usable for supplier routing."
            : "Used deterministic Prisma fallback because AI provider is not configured.",
      },
    );
    }});
  } catch (error) {
    // Upload validation failures are the caller's problem, not a server fault.
    if (error instanceof ApiRequestError) return fail(error.code, error.message, error.status);
    logApiError("POST /api/v1/rfq/process", error);
    return fail("RFQ_PROCESS_FAILED", "RFQ processing failed.");
  }
}
