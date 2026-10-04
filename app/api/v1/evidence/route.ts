import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { fail, logApiError, ok } from "@/lib/api/response";
import { executeIdempotentRequest } from "@/lib/api/idempotency";
import { ApiRequestError, assertRequestSize, assertUploadFile } from "@/lib/api/request";
import { authorizeOrganizationRequest } from "@/lib/auth/authorization";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { extractUploadedDocument } from "@/lib/documents/extract";
import {
  buildMetricsPayload,
  evidenceLifecycleLabel,
  extractEvidenceSignals,
  fileTypeFor,
  statusForUi,
  trimExtractedText,
  type EvidenceMetricsPayload,
  type OrderForSlaEvidence,
} from "@/lib/evidence/sla-evidence";
import { prisma } from "@/lib/prisma";
import { sanitizeFileName } from "@/lib/storage/local-object-storage";
import { deleteObject, getObject, getObjectStorageProvider } from "@/lib/storage/object-storage";

const MAX_FILE_BYTES = 25 * 1024 * 1024;
const DELIVERY_EVIDENCE_CATEGORY = "delivery_evidence";

function asStringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function asJson(value: unknown) {
  return value as Prisma.InputJsonValue;
}

function parseOrderIds(form: FormData) {
  const ids = new Set<string>();
  for (const value of form.getAll("purchaseOrderIds")) {
    String(value).split(",").map((item) => item.trim()).filter(Boolean).forEach((item) => ids.add(item));
  }
  const single = String(form.get("purchaseOrderId") || "").trim();
  if (single) ids.add(single);
  return Array.from(ids);
}

function toOrderForSla(order: OrderForSlaEvidence): OrderForSlaEvidence {
  return order;
}

async function readJson(req: Request) {
  try {
    return await req.json() as Record<string, unknown>;
  } catch {
    return {};
  }
}

async function loadMatchedOrders(selectedOrderIds: string[], text: string, organizationId: string) {
  const allOrderRefs = await prisma.purchaseOrder.findMany({
    where: { organizationId },
    select: { id: true, poNumber: true },
    orderBy: { createdAt: "desc" },
  });
  const signals = extractEvidenceSignals(text, allOrderRefs.map((order) => order.poNumber));
  const detectedIds = allOrderRefs
    .filter((order) => signals.poNumbers.some((poNumber) => poNumber.toLowerCase() === order.poNumber.toLowerCase()))
    .map((order) => order.id);
  const orderIds = Array.from(new Set([...selectedOrderIds, ...detectedIds]));
  const orders = orderIds.length > 0
    ? await prisma.purchaseOrder.findMany({
        where: { id: { in: orderIds }, organizationId },
        include: { lines: true },
      })
    : [];

  return { signals, orders: orders.map(toOrderForSla) };
}

function statusFromWarnings(warnings: string[]) {
  return warnings.length > 0 ? "NeedsReview" : "Completed";
}

function buildRecordFromEvidence(evidence: any) {
  const document = evidence.document;
  const linkedOrders = (evidence.links ?? []).map((link: any) => link.order).filter(Boolean) as OrderForSlaEvidence[];
  const metrics = evidence.metrics as EvidenceMetricsPayload;
  const kpis = metrics?.kpis ?? { totalPOs: 0, withinSlaRate: 0, onTimeRate: 0, avgDelayDays: 0, maxDelayDays: 0, arrivedCount: 0 };
  const extractedPOs = metrics?.extractedPOs ?? [];
  const delayDistribution = metrics?.delayDistribution ?? [];
  const parserWarnings = asStringArray(evidence.parserWarnings);
  const firstOrder = linkedOrders[0];
  const supplierLabel = linkedOrders.length > 1
    ? `${new Set(linkedOrders.map((order) => order.supplier)).size} suppliers`
    : evidence.vendorName;

  return {
    id: evidence.id,
    evidenceSource: "sla_evidence",
    documentId: evidence.documentId,
    purchaseOrderId: evidence.primaryOrderId,
    linkedPurchaseOrderIds: linkedOrders.map((order) => order.id),
    linkedPoNumbers: linkedOrders.map((order) => order.poNumber),
    vendorName: supplierLabel,
    fileName: evidence.fileName,
    originalName: evidence.originalName,
    fileType: evidence.fileType,
    sizeBytes: evidence.sizeBytes,
    evidenceDate: evidence.evidenceDate?.toISOString(),
    downloadUrl: document ? `/api/v1/purchase-orders/${document.orderId}/documents/${document.id}` : undefined,
    createdAt: evidence.createdAt.toISOString(),
    lifecycleStatus: evidence.status,
    lifecycleLabel: evidenceLifecycleLabel(evidence.status),
    reviewedAt: evidence.reviewedAt?.toISOString(),
    reviewedBy: evidence.reviewedBy,
    archivedAt: evidence.archivedAt?.toISOString(),
    status: statusForUi(evidence.status),
    grade: metrics?.grade ?? "F",
    kpis,
    delayDistribution,
    extractedPOs,
    parserWarnings,
    extractedTextPreview: evidence.extractedText ? String(evidence.extractedText).slice(0, 600) : null,
    executiveSummary: {
      reliabilityAssessment:
        kpis.withinSlaRate >= 80
          ? `${evidence.vendorName} has persisted SLA evidence${firstOrder ? ` linked to ${firstOrder.poNumber}` : ""} and is within the current threshold.`
          : `${evidence.vendorName} has persisted SLA evidence, but linked orders need SLA review.`,
      patternDetection: parserWarnings.length > 0
        ? parserWarnings.join(" ")
        : `Detected ${linkedOrders.length} linked purchase order${linkedOrders.length === 1 ? "" : "s"} from the evidence packet.`,
    },
    recommendedActions: [
      kpis.maxDelayDays > 0
        ? "Review delayed PO lines and request supplier confirmation before vessel ETA."
        : "Keep this delivery evidence attached to the PO audit trail.",
      parserWarnings.length > 0
        ? "Review parser warnings and mark the evidence reviewed once verified."
        : "Mark the evidence reviewed after confirming the source document.",
    ],
  };
}

function buildLegacyEvidenceRecord(document: any, scopedOrders: OrderForSlaEvidence[], complianceCases: Array<{ vessel: string; details: string }>) {
  const metrics = buildMetricsPayload(scopedOrders, null);
  const firstOrder = scopedOrders[0];
  const vendorName = firstOrder?.supplier ?? "Nautex Demo Evidence";
  const relatedCase = complianceCases.find((item) =>
    scopedOrders.some((order) => order.vessel === item.vessel || order.poNumber === document.relatedId)
  );

  return {
    id: document.id,
    evidenceSource: "legacy_document_record",
    vendorName,
    fileName: `${document.relatedId}-${document.type.toLowerCase()}-evidence.demo`,
    fileType: fileTypeFor(document.type),
    createdAt: document.uploadedAt.toISOString(),
    lifecycleStatus: "Legacy",
    lifecycleLabel: "Legacy",
    status: "complete",
    grade: metrics.grade,
    kpis: metrics.kpis,
    delayDistribution: metrics.delayDistribution,
    extractedPOs: metrics.extractedPOs,
    parserWarnings: ["Legacy seeded evidence record. Upload a source file to create a persisted SLA evidence record."],
    extractedTextPreview: null,
    executiveSummary: {
      reliabilityAssessment:
        metrics.kpis.withinSlaRate >= 80
          ? `${vendorName} is within the SLA threshold for the linked evidence sample.`
          : `${vendorName} needs review because linked orders show delayed or pending evidence.`,
      patternDetection: relatedCase?.details
        ?? "Legacy evidence record derived from seeded document data.",
    },
    recommendedActions: [
      metrics.kpis.maxDelayDays > 0
        ? "Review delayed PO lines and request supplier confirmation before vessel ETA."
        : "Keep the evidence packet attached to the related PO for audit traceability.",
      "Upload the source delivery evidence file to replace this legacy derived record.",
    ],
  };
}

async function createEvidenceEvents(orderIds: string[], summary: string, detail: Record<string, unknown>, actor: string) {
  if (!orderIds.length) return;
  await prisma.purchaseOrderEvent.createMany({
    data: orderIds.map((orderId) => ({
      orderId,
      type: "document_attached",
      summary,
      detail: JSON.stringify(detail),
      actor,
    })),
  });
}

async function reprocessEvidence(id: string, actor: string, organizationId: string) {
  const evidence = await prisma.slaEvidence.findFirst({
    where: { id, links: { some: { order: { organizationId } } } },
    include: {
      document: true,
      links: { include: { order: { include: { lines: true } } } },
    },
  });
  if (!evidence) return null;
  if (!evidence.document) throw new Error("Evidence source file is not available for reprocessing.");

  const buffer = await getObject(evidence.document.storageProvider, evidence.document.storageKey);
  const fileType = fileTypeFor(evidence.document.fileName, evidence.document.mimeType);
  const extracted = fileType === "screenshot"
    ? { text: "", warnings: ["Image OCR is not enabled. Review the source image manually."] }
    : await extractUploadedDocument({
        name: evidence.document.originalName ?? evidence.document.fileName,
        mimeType: evidence.document.mimeType,
        type: evidence.document.mimeType,
        data: buffer.toString("base64"),
      });

  const selectedIds = evidence.links.map((link) => link.orderId);
  const text = extracted.text ?? "";
  const { signals, orders } = await loadMatchedOrders(selectedIds, text, organizationId);
  if (orders.length === 0) throw new Error("No linked purchase orders could be resolved for this evidence.");

  const warnings = [...(extracted.warnings ?? []), ...signals.warnings];
  const extractedText = trimExtractedText(text);
  const metrics = buildMetricsPayload(orders, signals.evidenceDate);
  const status = statusFromWarnings(warnings);

  const updated = await prisma.$transaction(async (tx) => {
    await tx.slaEvidencePurchaseOrder.deleteMany({ where: { evidenceId: id } });
    const saved = await tx.slaEvidence.update({
      where: { id },
      data: {
        primaryOrderId: orders[0].id,
        vendorName: orders.length > 1 ? `${orders.length} linked purchase orders` : orders[0].supplier,
        fileType,
        evidenceDate: signals.evidenceDate,
        extractedText,
        extractedPOs: asJson(signals.poNumbers),
        parserWarnings: asJson(warnings),
        metrics: asJson(metrics),
        status,
        archivedAt: null,
      },
      include: {
        document: true,
        links: { include: { order: { include: { lines: true } } } },
      },
    });
    await tx.slaEvidencePurchaseOrder.createMany({
      data: orders.map((order) => ({
        evidenceId: id,
        orderId: order.id,
        matchedBy: selectedIds.includes(order.id) ? "operator" : "parser",
      })),
      skipDuplicates: true,
    });
    await tx.purchaseOrderEvent.createMany({
      data: orders.map((order) => ({
        orderId: order.id,
        type: "document_attached",
        summary: `SLA evidence reprocessed: ${evidence.fileName}`,
        detail: JSON.stringify({ evidenceId: id, parserWarnings: warnings.length }),
        actor,
      })),
    });
    return saved;
  });

  return prisma.slaEvidence.findUnique({
    where: { id: updated.id },
    include: {
      document: true,
      links: { include: { order: { include: { lines: true } } } },
    },
  });
}

export async function GET(req: Request) {
  try {
    const authorization = await authorizeOrganizationRequest(req, PERMISSIONS.APP_READ);
    if (!authorization.ok) return authorization.response;
    const [evidenceRecords, legacyDocuments, purchaseOrders, complianceCases] = await Promise.all([
      prisma.slaEvidence.findMany({
        where: { status: { not: "Archived" }, links: { some: { order: { organizationId: authorization.context.organizationId } } } },
        orderBy: { createdAt: "desc" },
        include: {
          document: true,
          links: { include: { order: { include: { lines: true } } } },
        },
      }),
      prisma.documentRecord.findMany({ orderBy: { uploadedAt: "desc" } }),
      prisma.purchaseOrder.findMany({
        where: { organizationId: authorization.context.organizationId },
        orderBy: { requestedDate: "desc" },
        include: { lines: true },
      }),
      prisma.complianceCase.findMany({ orderBy: { createdAt: "desc" } }),
    ]);

    const records = evidenceRecords.map(buildRecordFromEvidence);
    const linkedLegacyIds = new Set(records.flatMap((record: any) => record.linkedPoNumbers ?? []));
    const legacyRecords = legacyDocuments.map((document) => {
      const scopedOrders = purchaseOrders
        .filter((order) => order.poNumber === document.relatedId || order.rfqId === document.relatedId)
        .map(toOrderForSla);
      if (scopedOrders.length === 0) return null;
      if (scopedOrders.some((order) => linkedLegacyIds.has(order.poNumber))) return null;
      return buildLegacyEvidenceRecord(document, scopedOrders, complianceCases);
    }).filter(Boolean);

    return ok([...records, ...legacyRecords].sort((a: any, b: any) =>
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    ), {
      source: "sla_evidence",
      status: "real",
      evidenceCount: records.length,
      legacyEvidenceCount: legacyRecords.length,
      message: "SLA evidence uses persisted evidence records with source documents, parser metadata, lifecycle state, and linked purchase orders.",
    });
  } catch (error) {
    logApiError("GET /api/v1/evidence", error);
    return fail("EVIDENCE_LIST_FAILED", "Failed to load SLA evidence records.");
  }
}

export async function POST(req: Request) {
  try {
    const authorization = await authorizeOrganizationRequest(req, PERMISSIONS.APP_WRITE);
    if (!authorization.ok) return authorization.response;

    return await executeIdempotentRequest({
      request: req,
      organizationId: authorization.context.organizationId,
      route: "POST /api/v1/evidence",
      handler: async () => {
    assertRequestSize(req, MAX_FILE_BYTES + 1024 * 1024);
    const form = await req.formData();
    const file = assertUploadFile(form.get("file"), {
      requiredCode: "EVIDENCE_FILE_REQUIRED",
      emptyCode: "EVIDENCE_FILE_EMPTY",
      tooLargeCode: "EVIDENCE_FILE_TOO_LARGE",
      maxBytes: MAX_FILE_BYTES,
    });
    const selectedOrderIds = parseOrderIds(form);
    const description = String(form.get("description") || "").trim() || null;
    const uploadedBy = authorization.context.displayName;

    const documentId = randomUUID();
    const safeName = sanitizeFileName(file.name || "delivery-evidence");
    const buffer = Buffer.from(await file.arrayBuffer());
    const fileType = fileTypeFor(safeName, file.type);
    const extracted = fileType === "screenshot"
      ? { text: "", warnings: ["Image OCR is not enabled. Review the source image manually."] }
      : await extractUploadedDocument({
          name: file.name || safeName,
          mimeType: file.type,
          type: file.type,
          data: buffer.toString("base64"),
        });
    const text = extracted.text ?? "";
    const { signals, orders } = await loadMatchedOrders(selectedOrderIds, text, authorization.context.organizationId);

    if (orders.length === 0) {
      return fail("EVIDENCE_PO_REQUIRED", "Choose at least one purchase order or upload a file containing a known PO number.", 400);
    }

    const primaryOrder = orders[0];
    const storageKey = `purchase-orders/${primaryOrder.id}/${documentId}-${safeName}`;
    const storage = getObjectStorageProvider();
    await storage.put(storageKey, buffer);

    const warnings = [...(extracted.warnings ?? []), ...signals.warnings];
    const metrics = buildMetricsPayload(orders, signals.evidenceDate);
    const extractedText = trimExtractedText(text);
    const status = statusFromWarnings(warnings);

    let evidence;
    try {
      evidence = await prisma.$transaction(async (tx) => {
      const document = await tx.purchaseOrderDocument.create({
        data: {
          id: documentId,
          orderId: primaryOrder.id,
          fileName: safeName,
          originalName: file.name || safeName,
          mimeType: file.type || "application/octet-stream",
          sizeBytes: file.size,
          storageProvider: storage.name,
          storageKey,
          category: DELIVERY_EVIDENCE_CATEGORY,
          description,
          uploadedBy,
        },
      });

      const created = await tx.slaEvidence.create({
        data: {
          documentId: document.id,
          primaryOrderId: primaryOrder.id,
          vendorName: orders.length > 1 ? `${orders.length} linked purchase orders` : primaryOrder.supplier,
          fileName: safeName,
          originalName: file.name || safeName,
          fileType,
          sizeBytes: file.size,
          evidenceDate: signals.evidenceDate,
          source: "upload",
          status,
          extractedText,
          extractedPOs: asJson(signals.poNumbers),
          parserWarnings: asJson(warnings),
          metrics: asJson(metrics),
          links: {
            create: orders.map((order) => ({
              orderId: order.id,
              matchedBy: selectedOrderIds.includes(order.id) ? "operator" : "parser",
            })),
          },
        },
      });

      await tx.purchaseOrderEvent.createMany({
        data: orders.map((order) => ({
          orderId: order.id,
          type: "document_attached",
          summary: `SLA evidence attached: ${safeName}`,
          detail: JSON.stringify({ evidenceId: created.id, documentId: document.id, category: DELIVERY_EVIDENCE_CATEGORY, parserWarnings: warnings.length }),
          actor: uploadedBy,
        })),
      });

        return created;
      });
    } catch (error) {
      await deleteObject(storage.name, storageKey, { permanent: true }).catch(() => undefined);
      throw error;
    }

    const saved = await prisma.slaEvidence.findUnique({
      where: { id: evidence.id },
      include: {
        document: true,
        links: { include: { order: { include: { lines: true } } } },
      },
    });

    return ok(buildRecordFromEvidence(saved), {
      source: "sla_evidence",
      status: "real",
      message: "Delivery evidence uploaded, parsed, linked to purchase orders, and attached to the audit trail.",
    }, { status: 201 });
      },
    });
  } catch (error) {
    if (error instanceof ApiRequestError) return fail(error.code, error.message, error.status);
    logApiError("POST /api/v1/evidence", error);
    return fail("EVIDENCE_UPLOAD_FAILED", "Failed to upload delivery evidence.");
  }
}

export async function PATCH(req: Request) {
  try {
    const authorization = await authorizeOrganizationRequest(req, PERMISSIONS.APP_WRITE);
    if (!authorization.ok) return authorization.response;

    const body = await readJson(req);
    const id = String(body.id || "").trim();
    const action = String(body.action || "").trim();
    const actor = authorization.context.displayName;
    if (!id) return fail("EVIDENCE_ID_REQUIRED", "Evidence id is required.", 400);

    if (action === "reprocess") {
      const evidence = await reprocessEvidence(id, actor, authorization.context.organizationId);
      if (!evidence) return fail("EVIDENCE_NOT_FOUND", "SLA evidence record not found.", 404);
      return ok(buildRecordFromEvidence(evidence), { source: "sla_evidence", status: "real", message: "Evidence reprocessed." });
    }

    const data = action === "review"
      ? { status: "Reviewed" as const, reviewedAt: new Date(), reviewedBy: actor }
      : action === "archive"
        ? { status: "Archived" as const, archivedAt: new Date() }
        : null;
    if (!data) return fail("EVIDENCE_ACTION_UNSUPPORTED", "Supported actions: review, archive, reprocess.", 400);

    const scopedEvidence = await prisma.slaEvidence.findFirst({ where: { id, links: { some: { order: { organizationId: authorization.context.organizationId } } } }, select: { id: true } });
    if (!scopedEvidence) return fail("EVIDENCE_NOT_FOUND", "SLA evidence record not found.", 404);
    const evidence = await prisma.slaEvidence.update({
      where: { id: scopedEvidence.id },
      data,
      include: {
        document: true,
        links: { include: { order: { include: { lines: true } } } },
      },
    });

    await createEvidenceEvents(
      evidence.links.map((link) => link.orderId),
      action === "review" ? `SLA evidence reviewed: ${evidence.fileName}` : `SLA evidence archived: ${evidence.fileName}`,
      { evidenceId: evidence.id, action },
      actor,
    );

    return ok(buildRecordFromEvidence(evidence), { source: "sla_evidence", status: "real", message: `Evidence ${action} completed.` });
  } catch (error) {
    logApiError("PATCH /api/v1/evidence", error);
    return fail("EVIDENCE_ACTION_FAILED", "Failed to update SLA evidence.");
  }
}

export async function DELETE(req: Request) {
  try {
    const authorization = await authorizeOrganizationRequest(req, PERMISSIONS.APP_WRITE);
    if (!authorization.ok) return authorization.response;

    const url = new URL(req.url);
    const body = await readJson(req);
    const id = String(url.searchParams.get("id") || body.id || "").trim();
    const actor = authorization.context.displayName;
    if (!id) return fail("EVIDENCE_ID_REQUIRED", "Evidence id is required.", 400);

    const evidence = await prisma.slaEvidence.findFirst({
      where: { id, links: { some: { order: { organizationId: authorization.context.organizationId } } } },
      include: { document: true, links: true },
    });
    if (!evidence) return fail("EVIDENCE_NOT_FOUND", "SLA evidence record not found.", 404);
    if (evidence.status !== "Archived") {
      return fail("EVIDENCE_ARCHIVE_REQUIRED", "Archive SLA evidence before deleting its operational record.", 409);
    }

    const linkedOrderIds = evidence.links.map((link) => link.orderId);
    await prisma.$transaction(async (tx) => {
      await tx.slaEvidence.delete({ where: { id } });
      if (evidence.document) await tx.purchaseOrderDocument.delete({ where: { id: evidence.document.id } });
    });

    const storageDisposition = evidence.document
      ? await deleteObject(evidence.document.storageProvider, evidence.document.storageKey)
        .then((result) => result.disposition)
        .catch((error) => {
          logApiError("DELETE SLA evidence storage cleanup", error);
          return "cleanup_failed";
        })
      : "not_applicable";

    await createEvidenceEvents(
      linkedOrderIds,
      `SLA evidence deleted: ${evidence.fileName}`,
      { evidenceId: id, documentId: evidence.documentId },
      actor,
    );

    return ok({ id }, { source: "sla_evidence", status: "real", storageDisposition, message: "Evidence deleted." });
  } catch (error) {
    logApiError("DELETE /api/v1/evidence", error);
    return fail("EVIDENCE_DELETE_FAILED", "Failed to delete SLA evidence.");
  }
}
