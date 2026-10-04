import { generateJSON, isAIConfigured } from "@/lib/ai";
import type { AIServiceContext } from "@/lib/ai/provider";
import { startRun, startTask, completeRun, failTask } from "@/lib/ai/engine/workflow";
import { prisma } from "@/lib/prisma";
import { parsePurchaseOrderText, type PurchaseOrderIntakeDraft, type PurchaseOrderIntakeLineDraft, type PurchaseOrderIntakeSourceType } from "./intake";

interface IntakeAgentOptions extends AIServiceContext {
  onExecution?: (provider: string, model: string) => void;
  fileName?: string | null;
  sourceType?: PurchaseOrderIntakeSourceType;
  warnings?: string[];
}

interface AIIntakeDraft {
  poNumber?: string | null;
  buyerName?: string | null;
  buyerRef?: string | null;
  vessel?: string | null;
  vesselImo?: string | null;
  vesselOwner?: string | null;
  port?: string | null;
  eta?: string | null;
  requestedDate?: string | null;
  currency?: string | null;
  priority?: "High" | "Normal" | "Low" | null;
  lines?: Array<Partial<PurchaseOrderIntakeLineDraft>>;
  confidence?: number | null;
  warnings?: string[];
}

function cleanText(value: unknown, fallback = "") {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() || fallback : fallback;
}

function cleanNumber(value: unknown, fallback = 0) {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number.parseFloat(value.replace(",", ".")) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeIsoDate(value: unknown) {
  const raw = cleanText(value);
  if (!raw) return "";
  const date = new Date(raw);
  if (!Number.isNaN(date.getTime())) return date.toISOString().slice(0, 10);
  const eu = raw.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](20\d{2})$/);
  if (eu) return `${eu[3]}-${eu[2].padStart(2, "0")}-${eu[1].padStart(2, "0")}`;
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : "";
}

function hasLineSequenceWarning(warnings: string[]) {
  return warnings.some((warning) => /line item sequence has gaps/i.test(warning));
}

function detectLineSequenceGaps(lines: PurchaseOrderIntakeLineDraft[]) {
  const numbers = Array.from(
    new Set(lines.map((line) => line.lineNumber).filter((value): value is number => typeof value === "number" && Number.isFinite(value))),
  ).sort((a, b) => a - b);
  if (numbers.length < 2) return [];

  const missing: number[] = [];
  for (let expected = numbers[0]; expected <= numbers[numbers.length - 1]; expected += 1) {
    if (!numbers.includes(expected)) missing.push(expected);
  }
  return missing;
}

function sanitizeAiDraft(ai: AIIntakeDraft, base: PurchaseOrderIntakeDraft): PurchaseOrderIntakeDraft {
  const aiLines = (ai.lines ?? [])
    .map((line, index) => {
      const description = cleanText(line.description);
      if (!description || description.length < 3) return null;
      const qtyOrdered = cleanNumber(line.qtyOrdered, 1) || 1;
      const unitPrice = cleanNumber(line.unitPrice, 0);
      const uom = cleanText(line.uom, "EA").toUpperCase().slice(0, 8) || "EA";
      return {
        lineNumber: typeof line.lineNumber === "number" ? line.lineNumber : index + 1,
        itemCode: cleanText(line.itemCode) || null,
        supplierPartNo: cleanText(line.supplierPartNo) || null,
        description,
        qtyOrdered,
        uom,
        unitPrice,
        lineTotal: cleanNumber(line.lineTotal, qtyOrdered * unitPrice),
        requestedDate: normalizeIsoDate(line.requestedDate) || null,
        remarks: cleanText(line.remarks) || null,
      } satisfies PurchaseOrderIntakeLineDraft;
    })
    .filter(Boolean) as PurchaseOrderIntakeLineDraft[];

  const baseGaps = detectLineSequenceGaps(base.lines);
  const aiGaps = detectLineSequenceGaps(aiLines);
  const aiImprovesSequence = aiLines.length > base.lines.length && aiGaps.length < baseGaps.length;
  const selectedLines = baseGaps.length > 0 ? (aiImprovesSequence ? aiLines : base.lines) : aiLines.length > 0 ? aiLines : base.lines;
  const sequenceGaps = detectLineSequenceGaps(selectedLines);
  const mergedWarnings = Array.from(
    new Set([...base.warnings, ...(ai.warnings ?? []).map((warning) => cleanText(warning)).filter(Boolean)].filter((warning) => !hasLineSequenceWarning([warning]))),
  );
  if (sequenceGaps.length > 0 && !hasLineSequenceWarning(mergedWarnings)) {
    mergedWarnings.push(`Line item sequence has gaps (${sequenceGaps.join(", ")}). The PDF text layer may be incomplete; use OCR/visual review before creating the order.`);
  }
  const rawConfidence = Math.max(base.confidence, Math.min(95, Math.max(20, Math.round(cleanNumber(ai.confidence, base.confidence)))));
  const confidence = sequenceGaps.length > 0 || hasLineSequenceWarning(mergedWarnings) ? Math.min(rawConfidence, 60) : rawConfidence;
  return {
    ...base,
    poNumber: cleanText(ai.poNumber, base.poNumber ?? "") || base.poNumber,
    buyerName: cleanText(ai.buyerName, base.buyerName ?? "") || base.buyerName,
    buyerRef: cleanText(ai.buyerRef, base.buyerRef ?? "") || base.buyerRef,
    vessel: cleanText(ai.vessel, base.vessel) || base.vessel,
    vesselImo: cleanText(ai.vesselImo, base.vesselImo ?? "") || base.vesselImo,
    vesselOwner: cleanText(ai.vesselOwner, base.vesselOwner ?? "") || cleanText(ai.buyerName, base.vesselOwner ?? "") || base.vesselOwner,
    supplier: "Nautex",
    port: cleanText(ai.port, base.port ?? "") || base.port,
    eta: normalizeIsoDate(ai.eta) || base.eta,
    requestedDate: normalizeIsoDate(ai.requestedDate) || base.requestedDate,
    currency: cleanText(ai.currency, base.currency).toUpperCase().slice(0, 3) || base.currency,
    priority: ai.priority === "High" || ai.priority === "Low" ? ai.priority : base.priority,
    lines: selectedLines,
    confidence,
    warnings: mergedWarnings,
    extractionSummary: `Nautex PO Intake Agent extracted ${selectedLines.length} line item${selectedLines.length === 1 ? "" : "s"} for human review.`,
  };
}

function shouldEscalateToAi(draft: PurchaseOrderIntakeDraft) {
  if (hasLineSequenceWarning(draft.warnings)) return false;
  return draft.lines.length === 0 || draft.confidence < 70 || !draft.vessel || !draft.poNumber;
}

async function buildPurchaseOrderIntake(text: string, options: IntakeAgentOptions = {}) {
  const deterministic = parsePurchaseOrderText(text, options);
  if (!shouldEscalateToAi(deterministic) || !isAIConfigured()) {
    return deterministic;
  }

  const prompt = `Extract a maritime ship-chandler inbound customer purchase order from this document text.

Return valid JSON only with this exact shape:
{
  "poNumber": "customer purchase order number",
  "buyerName": "shipping company / buyer",
  "buyerRef": "buyer reference or same as poNumber",
  "vessel": "vessel name",
  "vesselImo": "7 digit IMO if present",
  "vesselOwner": "owner/operator if present",
  "port": "delivery port if present",
  "eta": "YYYY-MM-DD if present",
  "requestedDate": "YYYY-MM-DD if present",
  "currency": "EUR",
  "priority": "High|Normal|Low",
  "confidence": 0-100,
  "warnings": ["specific warnings"],
  "lines": [
    {
      "lineNumber": 1,
      "itemCode": "part/impa/customer item code or null",
      "supplierPartNo": null,
      "description": "ordered item only, not terms or comments",
      "qtyOrdered": 1,
      "uom": "PCE",
      "unitPrice": 0,
      "lineTotal": 0,
      "requestedDate": null,
      "remarks": null
    }
  ]
}

Rules:
- This is an inbound customer PO to Nautex, the ship chandler. Do not use the ShipServ supplier record as the Nautex selling entity.
- Extract only real ordered goods/services as lines. Exclude legal terms, buyer comments, payment instructions, VAT clauses, emails, addresses, and packaging instructions.
- Preserve all lines and quantities. ShipServ line tables may be single-line rows or multi-line blocks where description appears before UoM/quantity/price.
- If a value is not present, use null or an empty string, not invented data.

Document text:
"""
${text.slice(0, 28000)}
"""`;

  const result = await generateJSON<AIIntakeDraft>(prompt, {
    organizationId: options.organizationId,
    signal: options.signal,
    tier: "fast",
    systemInstruction: "You are Nautex PO Intake Agent. Extract maritime purchase orders accurately and return JSON only. Never include AI provider names.",
    temperature: 0.1,
    maxTokens: 8192,
  });

  if (!result.ok || !result.data) {
    return {
      ...deterministic,
      warnings: [...deterministic.warnings, "Nautex PO Intake Agent AI escalation was unavailable; deterministic extraction was used."],
    };
  }

  options.onExecution?.(result.provider, result.model);
  return sanitizeAiDraft(result.data, deterministic);
}

export async function runPurchaseOrderIntakeAgent(text: string, options: IntakeAgentOptions = {}) {
  if (!options.organizationId) return buildPurchaseOrderIntake(text, options);
  const run = await startRun({ organizationId: options.organizationId, agent: "nautex_po_intake", domain: "purchase_orders", trigger: "module", commandText: "Process purchase order upload" });
  const task = await startTask({ runId: run.id, agent: "nautex_po_intake", action: "process_purchase_order", input: { fileName: options.fileName ?? null } });
  try {
    let execution = { provider: "nautex", model: "local-po-parser" };
    const draft = await buildPurchaseOrderIntake(text, { ...options, onExecution: (provider, model) => { execution = { provider, model }; } });
    await prisma.agentTask.update({ where: { id: task.id }, data: { status: "Completed", completedAt: new Date(), confidence: null, ...execution, output: JSON.parse(JSON.stringify({ draft, humanReviewRequired: true })) } });
    await completeRun(run.id, "Completed");
    return draft;
  } catch (error) {
    await failTask(task.id, error instanceof Error ? error.message : "PO intake failed.");
    await completeRun(run.id, "Failed"); throw error;
  }
}
