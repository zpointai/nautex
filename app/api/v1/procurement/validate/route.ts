import { ApiRequestError, readJsonObject } from "@/lib/api/request";
import { fail } from "@/lib/api/response";
import { readRfqReview, reviewedItemNumber } from "@/lib/rfq/review";
import { validationReviewStatus, type ValidationHumanReview } from "@/lib/procurement/review";
import { retainSourceDocument, uploadedSource, discardUnreferencedSources } from "@/lib/documents/source-storage";
import type { StoredSourceDocument } from "@/lib/documents/source-types";
import { NextResponse } from "next/server";
import { authorizeOrganizationRequest } from "@/lib/auth/authorization";
import { PERMISSIONS } from "@/lib/auth/permissions";
import type { Prisma } from "@prisma/client";
import { isAIConfigured } from "@/lib/ai";
import { extractUploadedDocument } from "@/lib/documents/extract";
import { prisma } from "@/lib/prisma";
import {
  buildProcurementValidation,
  type ProcurementDocumentRole,
  type ProcurementValidationInputDocument,
  type ProcurementValidationResult,
  type ProcurementValidationType,
  type ValidationExceptionDraft,
} from "@/lib/procurement/validator";

const DEFAULT_VALIDATION_TYPE: ProcurementValidationType = "supplier_quote_vs_purchase_order";

const VALIDATION_CONFIG: Record<ProcurementValidationType, { left: ProcurementDocumentRole; right: ProcurementDocumentRole; label: string }> = {
  supplier_quote_vs_rfq: {left:"supplier_quote",right:"rfq",label:"Supplier Quote vs Reviewed RFQ"},
  supplier_quote_vs_purchase_order: { left: "supplier_quote", right: "purchase_order", label: "Supplier Quote vs Purchase Order" },
  supplier_confirmation_vs_purchase_order: { left: "supplier_confirmation", right: "purchase_order", label: "Supplier Confirmation vs Purchase Order" },
  supplier_invoice_vs_purchase_order: { left: "supplier_invoice", right: "purchase_order", label: "Supplier Invoice vs Purchase Order" },
  supplier_invoice_vs_goods_receipt: { left: "supplier_invoice", right: "goods_receipt", label: "Supplier Invoice vs Goods Receipt" },
  customer_po_vs_nautex_quote: { left: "customer_po", right: "nautex_quote", label: "Customer PO vs Nautex Quote" },
  agreement_price_vs_supplier_price: { left: "agreement", right: "supplier_quote", label: "Agreement Price vs Supplier Quote / PO Price" },
  delivered_items_vs_ordered_items: { left: "goods_receipt", right: "purchase_order", label: "Delivered Items vs Ordered Items" },
};

type PurchaseOrderForValidation = {
  id: string;
  poNumber: string;
  vessel: string;
  supplier: string;
  currency: string;
  requestedDate: Date | null;
  lines: Array<{
    lineNumber: number;
    itemCode: string | null;
    description: string;
    supplierPartNo: string | null;
    qtyOrdered: number;
    uom: string;
    unitPrice: number;
    currency: string;
    lineTotal: number;
    requestedDate: Date | null;
  }>;
};

function jsonInput(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function getValidationType(value: unknown): ProcurementValidationType {
  return typeof value === "string" && value in VALIDATION_CONFIG ? value as ProcurementValidationType : DEFAULT_VALIDATION_TYPE;
}

function fileMeta(file: unknown) {
  if (!file || typeof file !== "object") return { size: null };
  const size = (file as { size?: unknown }).size;
  return { size: typeof size === "number" ? size : null };
}

function money(value: unknown) {
  if (value === null || value === undefined) return "";
  return String(value);
}

function purchaseOrderToText(order: PurchaseOrderForValidation | null) {
  if (!order) return "";
  const lines = order.lines;
  return [
    `PO Ref,${order.poNumber}`,
    `Vessel,${order.vessel}`,
    `Supplier,${order.supplier}`,
    `Currency,${order.currency}`,
    "Line,Item Code,Description,Part Number,Quantity,Unit,Unit Price,Currency,Total,Delivery Date,PO Ref,Vessel",
    ...lines.map((line) => [
      line.lineNumber,
      line.itemCode ?? "",
      line.description,
      line.supplierPartNo ?? "",
      line.qtyOrdered,
      line.uom,
      money(line.unitPrice),
      line.currency,
      money(line.lineTotal),
      line.requestedDate?.toISOString().slice(0, 10) ?? order.requestedDate?.toISOString().slice(0, 10) ?? "",
      order.poNumber,
      order.vessel,
    ].map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")),
  ].join("\n");
}

async function resolvePurchaseOrderDocument(id: string | null | undefined, role: ProcurementDocumentRole, organizationId: string): Promise<ProcurementValidationInputDocument | null> {
  if (!id) return null;
  const order = await prisma.purchaseOrder.findFirst({
    where: { id, organizationId },
    include: { lines: { orderBy: { lineNumber: "asc" } } },
  });
  if (!order) return null;
  return {
    role,
    text: purchaseOrderToText(order),
    fileName: null,
    mimeType: "application/vnd.nautex.purchase-order",
    recordId: order.id,
    recordLabel: order.poNumber,
    warnings: [],
  };
}

async function buildUploadedDocument(params: {
  role: ProcurementDocumentRole;
  file: unknown;
  text: unknown;
  fallbackFileName: string;
}): Promise<ProcurementValidationInputDocument> {
  const extracted = await extractUploadedDocument(params.file);
  const explicitText = typeof params.text === "string" ? params.text : "";
  const text = explicitText || extracted.text;
  return {
    role: params.role,
    text,
    fileName: extracted.fileName ?? params.fallbackFileName,
    mimeType: extracted.mimeType,
    size: fileMeta(params.file).size,
    warnings: extracted.warnings,
  };
}

async function persistValidation(params: {
  organizationId: string;
  result: ProcurementValidationResult;
  source: string;
  model?: string;
  provider?: string;
}) {
  return prisma.$transaction(async tx => {
  const validation = await tx.validationRun.create({
    data: {
      organizationId: params.organizationId,
      quoteFileName: params.result.sourceDocuments[0]?.fileName ?? params.result.sourceDocuments[0]?.recordLabel ?? null,
      poFileName: params.result.sourceDocuments[1]?.fileName ?? params.result.sourceDocuments[1]?.recordLabel ?? null,
      status: "Completed",
      source: params.source,
      comparisonResults: jsonInput(params.result.comparisonResults),
      summary: jsonInput({
        validationType: params.result.validationType,
        documentStatus: params.result.documentStatus,
        reviewStatus: params.result.reviewStatus,
        sourceDocuments: params.result.sourceDocuments,
        normalizedLines: params.result.normalizedLines,
        summary: params.result.summary,
        exceptionDrafts: params.result.exceptionDrafts,
        auditMetadata: params.result.auditMetadata,
        humanReview: {
          status: params.result.reviewStatus,
          reviewedBy: null,
          reviewedAt: null,
          note: null,
        },
      }),
      model: params.model,
      provider: params.provider,
    },
  });

  await tx.agentRun.create({
    data: {
      organizationId: params.organizationId,
      agent: "procurement_validation",
      domain: "procurement",
      trigger: "module",
      status: "Completed",
      completedAt: new Date(),
      tasks: {
        create: {
          agent: "procurement_validation",
          action: "deterministic_procurement_validation",
          input: jsonInput({
            validationRunId: validation.id,
            validationType: params.result.validationType,
            sourceDocuments: params.result.sourceDocuments.map(doc => ({ role: doc.role, fileName: doc.fileName, recordId: doc.recordId, sourceDocument: doc.sourceDocument })),
          }),
          output: jsonInput({
            summary: params.result.summary,
            exceptionDraftCount: params.result.exceptionDrafts.length,
          }),
          status: "Completed",
          model: params.model,
          provider: params.provider,
          completedAt: new Date(),
        },
      },
      auditLogs: {
        create: {
          agent: "procurement_validation",
          action: "persist_validation_run",
          target: validation.id,
          input: jsonInput({ validationType: params.result.validationType }),
          output: jsonInput({ validationRunId: validation.id, readinessStatus: params.result.summary.readinessStatus }),
          model: params.model,
          provider: params.provider,
          committed: true,
        },
      },
    },
  });

  return validation.id;
  });
}

function countHistoryStatuses(comparisonResults: unknown) {
  const counts = {
    matched: 0,
    mismatched: 0,
    added: 0,
    missing: 0,
    priceVariance: 0,
    quantityVariance: 0,
  };

  if (!Array.isArray(comparisonResults)) return counts;

  for (const item of comparisonResults) {
    if (!item || typeof item !== "object") continue;
    const result = item as { status?: unknown; statuses?: unknown };
    const statuses = Array.isArray(result.statuses) ? result.statuses : [result.status];
    const statusSet = new Set(statuses.filter((status): status is string => typeof status === "string"));

    if (statusSet.has("Matched")) counts.matched += 1;
    if (statusSet.has("Extra Line")) counts.added += 1;
    if (statusSet.has("Missing Line")) counts.missing += 1;
    if (statusSet.has("Price Variance") || statusSet.has("Agreement Price Mismatch")) counts.priceVariance += 1;
    if (statusSet.has("Quantity Variance")) counts.quantityVariance += 1;
    if ([...statusSet].some((status) => status !== "Matched")) counts.mismatched += 1;
  }

  return counts;
}

function hydratePersistedRun(run: { id: string; comparisonResults: unknown; summary: unknown; createdAt?: Date }) {
  const summary = run.summary as Partial<ProcurementValidationResult> & {
    summary?: ProcurementValidationResult["summary"];
    humanReview?: ValidationHumanReview;
  };
  const reviewStatus = validationReviewStatus(summary);
  const comparisonResults = Array.isArray(run.comparisonResults)
    ? run.comparisonResults.map(line => ({ ...line, reviewStatus })) : [];
  const counts = countHistoryStatuses(comparisonResults);
  const fallbackSummary: ProcurementValidationResult["summary"] = {
    totalLinesCompared: comparisonResults.length,
    matchedLines: counts.matched,
    partialMatches: 0,
    discrepancies: counts.mismatched,
    highRiskDiscrepancies: counts.added + counts.missing + counts.priceVariance,
    missingLines: counts.missing,
    extraLines: counts.added,
    totalValueVariance: null,
    currencies: [],
    currencyVariance: false,
    readinessStatus: counts.mismatched > 0 ? "Review required" : "Ready for approval",
    recommendedNextAction: counts.mismatched > 0 ? "Review validation discrepancies before downstream action." : "No discrepancies require review.",
  };

  return {
    validationRunId: run.id,
    validationType: summary.validationType ?? DEFAULT_VALIDATION_TYPE,
    documentStatus: summary.documentStatus ?? (counts.mismatched > 0 ? "Needs Review" : "Matched"),
    reviewStatus,
    sourceDocuments: summary.sourceDocuments ?? [],
    normalizedLines: summary.normalizedLines ?? { left: [], right: [] },
    comparisonResults,
    summary: summary.summary ?? fallbackSummary,
    exceptionDrafts: summary.exceptionDrafts ?? [],
    auditMetadata: summary.auditMetadata ?? {
      deterministic: true,
      aiAssisted: false,
      parserVersion: "validator-parser-1",
      matchVersion: "validator-match-1",
      generatedAt: run.createdAt?.toISOString() ?? new Date().toISOString(),
    },
    discrepancyBreakdown: summary.discrepancyBreakdown ?? {
      added: counts.added,
      removed: counts.missing,
      quantityChanges: counts.quantityVariance,
      priceChanges: counts.priceVariance,
      compoundChanges: 0,
    },
    keyInsights: summary.keyInsights ?? {
      expandedScope: {
        impact: counts.added > 0 ? "HIGH" : "LOW",
        details: [counts.added > 0 ? `${counts.added} purchase order line(s) are not present in the supplier quotation.` : "No additional PO-only lines detected."],
      },
      consistency: {
        impact: counts.mismatched > 0 ? "MEDIUM" : "LOW",
        details: [`${counts.matched} matched line(s), ${counts.mismatched} line(s) requiring review.`],
      },
      procurementObstacles: {
        impact: counts.mismatched > 0 ? "MEDIUM" : "LOW",
        details: [summary.summary?.recommendedNextAction ?? fallbackSummary.recommendedNextAction],
      },
    },
  };
}

async function selectorContext(organizationId: string) {
  const [purchaseOrders, rfqs, agreements] = await Promise.all([
    prisma.purchaseOrder.findMany({
      where: { organizationId },
      orderBy: { updatedAt: "desc" },
      take: 30,
      select: {
        id: true,
        poNumber: true,
        vessel: true,
        supplier: true,
        currency: true,
        total: true,
        status: true,
        lines: { select: { id: true }, take: 1 },
      },
    }),
    prisma.rfq.findMany({
      where: { organizationId },
      orderBy: { updatedAt: "desc" },
      take: 20,
      select: { id: true, vessel: true, port: true, status: true, neededBy: true },
    }),
    prisma.agreementVersion.findMany({
      where: { organizationId },
      orderBy: { updatedAt: "desc" },
      take: 20,
      select: { id: true, supplierName: true, versionNumber: true, status: true, currency: true },
    }),
  ]);

  return { purchaseOrders, rfqs, agreements };
}

/**
 * GET /api/v1/procurement/validate
 *
 * Recent validation run history or selector context via ?context=selectors.
 */
export async function GET(req: Request) {
  const authorization = await authorizeOrganizationRequest(req, PERMISSIONS.APP_READ);
  if (!authorization.ok) return authorization.response;
  const { searchParams } = new URL(req.url);
  if (searchParams.get("context") === "selectors") {
    const data = await selectorContext(authorization.context.organizationId);
    return NextResponse.json({ ok: true, data, meta: { source: "postgres" } });
  }

  const id = searchParams.get("id") ?? searchParams.get("runId");
  if (id) {
    const run = await prisma.validationRun.findFirst({ where: { id, organizationId: authorization.context.organizationId } });
    if (!run) return NextResponse.json({ ok: false, error: { message: "Validation run not found." } }, { status: 404 });
    return NextResponse.json({ ok: true, data: hydratePersistedRun(run), meta: { source: "postgres", historical: true } });
  }

  const limit = Math.min(Number(searchParams.get("limit") || 10), 50);
  const rows = await prisma.validationRun.findMany({
    where: { organizationId: authorization.context.organizationId },
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  const data = rows.map((run) => ({
    id: run.id,
    quoteFileName: run.quoteFileName,
    poFileName: run.poFileName,
    status: run.status,
    source: run.source,
    createdAt: run.createdAt,
    summary: {
      ...(run.summary as Record<string, unknown>),
      reviewStatus: hydratePersistedRun(run).reviewStatus,
      humanReview: { ...((run.summary as { humanReview?: ValidationHumanReview }).humanReview ?? {}), status: hydratePersistedRun(run).reviewStatus },
    },
    counts: countHistoryStatuses(run.comparisonResults),
  }));

  return NextResponse.json({ ok: true, data, meta: { source: "postgres" } });
}

export async function DELETE(req: Request) {
  try {
    const authorization = await authorizeOrganizationRequest(req, PERMISSIONS.PROCUREMENT_APPROVE);
    if (!authorization.ok) return authorization.response;
    await prisma.validationRun.deleteMany({ where: { organizationId: authorization.context.organizationId } });
    return NextResponse.json({ ok: true, data: { cleared: true }, meta: { source: "postgres" } });
  } catch (error) {
    if (error instanceof ApiRequestError) return fail(error.code,error.message,error.status);
    console.error("[api] DELETE /api/v1/procurement/validate:", error instanceof Error ? error.message : String(error));
    return NextResponse.json({ ok: false, error: { message: "Failed to clear validation history." } }, { status: 500 });
  }
}

/**
 * POST /api/v1/procurement/validate
 *
 * Operational procurement validation. It compares uploaded/pasted documents
 * and can compare an upload against a selected Nautex purchase order record.
 */
export async function POST(req: Request) {
  const retainedSources: StoredSourceDocument[] = [];
  let sourceReferencesSaved = false;
  try {
    const authorization = await authorizeOrganizationRequest(req, PERMISSIONS.PROCUREMENT_WRITE);
    if (!authorization.ok) return authorization.response;
    const { assertAgentEnabled } = await import("@/lib/agents/controls");
    await assertAgentEnabled(authorization.context.organizationId, "procurement_validation");
    const body = await readJsonObject(req, 18 * 1024 * 1024);
    const validationType = getValidationType(body.validationType);
    const config = VALIDATION_CONFIG[validationType];

    const leftFile = body.leftFile ?? body.quoteFile;
    const rightFile = body.rightFile ?? body.poFile;
    const leftText = body.leftText ?? body.quoteText;
    const rightText = body.rightText ?? body.poText;
    const leftUpload = uploadedSource(leftFile);
    const rightUpload = body.rightRecordType ? undefined : uploadedSource(rightFile);

    const [uploadedLeft, uploadedRight, selectedRightPo] = await Promise.all([
      buildUploadedDocument({ role: config.left, file: leftFile, text: leftText, fallbackFileName: config.left }),
      buildUploadedDocument({ role: config.right, file: rightFile, text: rightText, fallbackFileName: config.right }),
      body.rightRecordType === "purchase_order" ? resolvePurchaseOrderDocument(typeof body.rightRecordId === "string" ? body.rightRecordId : null, config.right, authorization.context.organizationId) : Promise.resolve(null),
    ]);

    const leftDocument = uploadedLeft;
    let rightDocument = selectedRightPo ?? uploadedRight;
    let rfqSource: StoredSourceDocument | undefined;
    if (body.rightRecordType === "rfq") {
      if (validationType !== "supplier_quote_vs_rfq" || typeof body.rightRecordId !== "string") return fail("RFQ_CONTEXT_INVALID","Select the RFQ comparison type.",400);
      const rfq = await prisma.rfq.findFirst({where:{id:body.rightRecordId,organizationId:authorization.context.organizationId},include:{lines:{orderBy:{lineNumber:"asc"}}}});
      if (!rfq) return fail("RFQ_NOT_FOUND","RFQ not found.",404);
      const review = readRfqReview(rfq.review);
      if (review?.status !== "confirmed") return fail("RFQ_REVIEW_REQUIRED","Confirm RFQ extraction before comparison.",409);
      rfqSource = review.sourceDocument;
      const csv = (v:unknown) => '"' + String(v ?? "").replaceAll('"','""') + '"';
      rightDocument = {role:"rfq",recordId:rfq.id,recordLabel:"Reviewed RFQ",fileName:review.fileName,
        text:["Line,Description,Quantity,Unit,Currency",...rfq.lines.map((l,i)=>[reviewedItemNumber(review,i),l.description,l.quantity,l.unit,review.currencies[i]].map(csv).join(","))].join("\n"),
        warnings:["RFQ prices are unspecified. Compare quantities and units; a quotation does not establish an approved purchase price."]};
    }
    if (body.rightRecordType === "purchase_order" && !selectedRightPo) return fail("PO_NOT_FOUND","Purchase order not found.",404);

    if (!leftDocument.text || !rightDocument.text) return fail("VALIDATION_TEXT_REQUIRED", "Both documents need selectable text. Scanned PDFs require an external OCR/text export; Nautex does not provide OCR.", 422);

    const result = buildProcurementValidation({ validationType, leftDocument, rightDocument });
    if (result.normalizedLines.left.length === 0 || result.normalizedLines.right.length === 0) {
      return NextResponse.json({
        ok: true,
        data: {
          _stub: true,
          ...result,
          documentStatus: "Blocked",
          reviewStatus: "Blocked",
          message: "Documents were extracted, but no comparable procurement lines were found.",
        },
      });
    }

    for (const [index, document] of [leftDocument, rightDocument].entries()) {
      let retained = index === 1 ? rfqSource : undefined;
      if (!retained) {
        retained = await retainSourceDocument(authorization.context.organizationId, document.text,
          index === 0 ? leftUpload : rightUpload, document.recordId ? "record_snapshot" : "text");
        retainedSources.push(retained);
      }
      result.sourceDocuments[index].sourceDocument = retained;
    }
    const validationRunId = await persistValidation({
      organizationId: authorization.context.organizationId,
      result,
      source: selectedRightPo ? "record_and_upload" : "manual_upload",
      model: "deterministic-validator",
      provider: "nautex",
    });
    sourceReferencesSaved = true;

    return NextResponse.json({
      ok: true,
      data: {
        _stub: false,
        validationRunId,
        ...result,
        _ai: { enabled: false, provider: "nautex", model: "deterministic-validator" },
      },
      meta: { source: "postgres", workflow: VALIDATION_CONFIG[validationType].label },
    });
  } catch (error) {
    if (error instanceof ApiRequestError) return fail(error.code,error.message,error.status);
    console.error("[api] POST /api/v1/procurement/validate:", error instanceof Error ? error.message : String(error));
    return NextResponse.json({ ok: false, error: { message: "Validation failed." } }, { status: 500 });
  } finally {
    if (!sourceReferencesSaved) await discardUnreferencedSources(retainedSources);
  }
}

export async function PATCH(req: Request) {
  try {
    const authorization = await authorizeOrganizationRequest(req, PERMISSIONS.PROCUREMENT_APPROVE);
    if (!authorization.ok) return authorization.response;

    const body = await req.json();
    const id = typeof body.id === "string" ? body.id : "";
    const action = typeof body.action === "string" ? body.action : "";
    if (!id || !["approve", "reject", "block", "create_exceptions"].includes(action)) {
      return NextResponse.json({ ok: false, error: { message: "Valid id and action are required." } }, { status: 400 });
    }

    const run = await prisma.validationRun.findFirst({ where: { id, organizationId: authorization.context.organizationId } });
    if (!run) return NextResponse.json({ ok: false, error: { message: "Validation run not found." } }, { status: 404 });

    const current = run.summary as Record<string, unknown>;

    if (action === "create_exceptions") {
      const existingCreation = current.exceptionCreation as { ids?: unknown; count?: unknown } | undefined;
      if (existingCreation && Array.isArray(existingCreation.ids)) {
        return NextResponse.json({
          ok: true,
          data: hydratePersistedRun(run),
          meta: { createdExceptions: 0, existingExceptions: existingCreation.ids.length },
        });
      }

      const drafts = Array.isArray(current.exceptionDrafts) ? current.exceptionDrafts as ValidationExceptionDraft[] : [];
      const created = await prisma.$transaction(drafts.map((draft) => prisma.agentException.create({
        data: {
          organizationId: authorization.context.organizationId,
          agent: "procurement_validation",
          domain: "procurement",
          severity: draft.severity,
          title: draft.title,
          description: draft.description,
          suggestedAction: draft.suggestedAction,
          status: "Open",
        },
      })));

      const updated = await prisma.validationRun.update({
        where: { id },
        data: {
          summary: jsonInput({
            ...current,
            exceptionDrafts: drafts.map((draft) => ({ ...draft, status: "Created" })),
            exceptionCreation: {
              createdAt: new Date().toISOString(),
              createdBy: authorization.context.displayName,
              count: created.length,
              ids: created.map((item) => item.id),
            },
          }),
        },
      });
      return NextResponse.json({ ok: true, data: hydratePersistedRun(updated), meta: { createdExceptions: created.length } });
    }

    const humanReview = {
      status: action === "approve" ? "Approved" : action === "reject" ? "Rejected" : "Blocked",
      reviewedBy: authorization.context.displayName,
      reviewedAt: new Date().toISOString(),
      note: typeof body.note === "string" ? body.note : null,
    };

    const updated = await prisma.validationRun.update({
      where: { id },
      data: { summary: jsonInput({ ...current, humanReview }) },
    });

    return NextResponse.json({ ok: true, data: hydratePersistedRun(updated), meta: { source: "postgres" } });
  } catch (error) {
    if (error instanceof ApiRequestError) return fail(error.code,error.message,error.status);
    console.error("[api] PATCH /api/v1/procurement/validate:", error instanceof Error ? error.message : String(error));
    return NextResponse.json({ ok: false, error: { message: "Failed to update validation run." } }, { status: 500 });
  }
}
