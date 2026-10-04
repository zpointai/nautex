import type { RouteResult } from "./router";
import type { AIServiceContext } from "@/lib/ai/provider";
const STOPWORDS = new Set([
  "find", "search", "lookup", "look", "for", "the", "and", "with", "from", "code", "item", "items",
  "classify", "classification", "impa", "supplier", "suppliers", "vendor", "vendors", "country", "origin",
  "normalize", "description", "describe", "please", "need", "marine", "maritime",
]);

function commandTerms(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .map((term) => term.trim())
    .filter((term) => term.length >= 3 && !STOPWORDS.has(term))
    .slice(0, 8);
}

function cleanedCommand(value: string) {
  return value
    .replace(/\b(classify|find|search|lookup|identify|normalize|country of origin|coo|impa|supplier|vendor|for|please)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function matchScore(text: string, query: string, terms: string[]) {
  const haystack = text.toLowerCase();
  const normalizedQuery = query.toLowerCase();
  let score = 0;
  if (normalizedQuery && haystack.includes(normalizedQuery)) score += 20;
  for (const [index, term] of terms.entries()) {
    const weight = index === 0 ? 3 : 0;
    if (new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(haystack)) score += 6;
    else if (haystack.includes(term)) score += 2;
    if (score > 0 && weight > 0 && haystack.includes(term)) score += weight;
  }
  return score;
}

export async function dispatchAction(route: RouteResult, organizationId: string, context: AIServiceContext = {}): Promise<Record<string, unknown>> {
  const { agentId, action, params } = route;

  switch (`${agentId}:${action}`) {
    case "backorder_follow_up:draft_backorder_follow_up": {
      const { listBackorders } = await import("@/lib/backorders/service");
      const { draftBackorderEmail } = await import("@/lib/backorders/email-draft");
      const backorder = (await listBackorders(organizationId)).find(row => row.id === params.id || row.poNumber === params.id);
      if (!backorder) throw new Error("Backorder not found in the active organization.");
      const draft = await draftBackorderEmail(backorder, { useAI: false });
      return { to: draft.to, subject: draft.subject, body: draft.body, backorderId: backorder.id, sent: false, _execution: { provider: "nautex", model: "backorder-template" } };
    }
    case "backorder_reply_monitor:monitor_backorder_replies": {
      if (!["active", "critical", "escalated"].includes(String(params.scope))) throw new Error("Choose active, critical or escalated scope.");
      const { listBackorders } = await import("@/lib/backorders/service");
      const candidates = (await listBackorders(organizationId)).filter(row => ["open", "escalated"].includes(row.status) && (params.scope !== "critical" || row.priority === "critical") && (params.scope !== "escalated" || row.status === "escalated"));
      return { candidates: candidates.map(row => ({ backorderId: row.id, poNumber: row.poNumber, supplier: row.vendor, delayDays: row.totalDelayDays, priority: row.priority, lines: row.items.length })), scope: params.scope, mailboxChecked: false, recommendation: "Review overdue records and confirm supplier responses manually. This check does not connect to a mailbox or establish when a supplier replied.", _execution: { provider: "nautex", model: "backorder-status-rules" } };
    }
    case "backorder_reply_monitor:check_supplier_mailbox": {
      const { supplierReplyCandidates } = await import("@/lib/mailbox/microsoft365");
      return supplierReplyCandidates(organizationId, Number(params.days), context.signal);
    }
    case "finance_exception:analyze_finance_exception": {
      const { prisma } = await import("@/lib/prisma");
      const { refreshFinanceControls } = await import("@/lib/finance/controls");
      await refreshFinanceControls(organizationId);
      const exceptions = await prisma.financeException.findMany({ where: { organizationId, ...(params.id === "all" ? { status: "Open" as const } : { id: String(params.id) }) }, orderBy: { createdAt: "asc" }, take: 100 });
      if (params.id !== "all" && !exceptions.length) throw new Error("Finance exception not found in the active organization.");
      return { count: exceptions.length, scopeLimit: 100, exceptions: exceptions.map(row => ({ id: row.id, type: row.type, severity: row.severity, status: row.status, title: row.title, description: row.description, orderId: row.orderId, customerInvoiceId: row.customerInvoiceId, supplierInvoiceId: row.supplierInvoiceId, creditNoteId: row.creditNoteId, review: "Inspect the linked source documents and recorded variance in Finance before resolving this exception. No accounting decision has been made." })), summary: `${exceptions.length} recorded finance exception(s) to inspect. Sorted oldest first; limited to 100 records.`, _execution: { provider: "nautex", model: "finance-exception-review" } };
    }
    case "classification:classify_hs": {
      const { classifyProduct } = await import("@/lib/ai/services/hs-code");
      const description = (params.description as string) || (params.rawCommand as string) || "";
      const { datasetClassification, findHsMatches } = await import("@/lib/datasets/hs-codes");
      const dataset = datasetClassification(description, await findHsMatches(description, 5));
      if (dataset) return { ...dataset, _execution: { provider: "postgres", model: "local-hs-dataset" } };
      const result = await classifyProduct(description, { ...context, organizationId });
      if (!result.ok) return { error: result.reason, _stub: true };
      return { ...result.data, _ai: { model: result.model, provider: result.provider } };
    }

    case "classification:classify_impa": {
      const { prisma } = await import("@/lib/prisma");
      const raw = (params.description as string) || (params.rawCommand as string) || "";
      const code = raw.match(/\b\d{6}\b/)?.[0];
      const terms = commandTerms(raw);
      const query = cleanedCommand(raw) || raw;
      const items = await prisma.item.findMany({
        where: {
          isDeleted: false,
          impaCode: { not: null },
          OR: [
            ...(code ? [{ impaCode: code }] : []),
            { description: { contains: query, mode: "insensitive" } },
            { normalizedDesc: { contains: query, mode: "insensitive" } },
            ...terms.map((term) => ({ description: { contains: term, mode: "insensitive" as const } })),
          ],
        },
        orderBy: { impaCode: "asc" },
        take: 50,
      });
      const ranked = items
        .map((item) => ({
          item,
          score: matchScore(`${item.impaCode || ""} ${item.description} ${item.normalizedDesc || ""} ${item.category || ""}`, query, terms),
        }))
        .sort((a, b) => b.score - a.score || String(a.item.impaCode).localeCompare(String(b.item.impaCode)))
        .slice(0, 5);
      return {
        query,
        matchCount: items.length,
        matches: ranked.map(({ item, score }) => ({
          impaCode: item.impaCode,
          description: item.description,
          unit: item.unit,
          category: item.category,
          hsCodeEu: item.hsCodeEu,
          countryOrigin: item.countryOrigin,
          score,
        })),
        recommendation: ranked[0]?.item.impaCode
          ? `Review ${ranked[0].item.impaCode} in the IMPA Catalogue before committing it to a line item.`
          : "No local IMPA match found. Review the catalogue or import the licensed dataset.",
      };
    }

    case "classification:identify_coo": {
      const { prisma } = await import("@/lib/prisma");
      const raw = (params.description as string) || (params.rawCommand as string) || "";
      const query = cleanedCommand(raw) || raw;
      const terms = commandTerms(raw);
      const items = await prisma.item.findMany({
        where: {
          isDeleted: false,
          countryOrigin: { not: null },
          OR: [
            { description: { contains: query, mode: "insensitive" } },
            { normalizedDesc: { contains: query, mode: "insensitive" } },
            ...terms.map((term) => ({ description: { contains: term, mode: "insensitive" as const } })),
          ],
        },
        take: 8,
      });
      const countries = Array.from(new Set(items.map((item) => item.countryOrigin).filter(Boolean)));
      return {
        query,
        countries,
        supportingItems: items.slice(0, 5).map((item) => ({
          description: item.description,
          impaCode: item.impaCode,
          countryOrigin: item.countryOrigin,
        })),
        recommendation: countries.length === 1
          ? `Use ${countries[0]} as a draft COO only after supplier documentation confirms it.`
          : "COO requires supplier documentation or a more specific item match.",
      };
    }

    case "classification:normalize_description": {
      const raw = (params.description as string) || (params.rawCommand as string) || "";
      const withoutCommand = cleanedCommand(raw) || raw;
      const normalized = withoutCommand
        .replace(/\b(\d+)\s*(pcs|pieces)\b/gi, "$1 PCS")
        .replace(/\b(stainless steel|s\/s|ss)\b/gi, "stainless steel")
        .replace(/\b(mm|cm|mtr|meter|metre)\b/gi, (match) => match.toUpperCase())
        .replace(/\s+/g, " ")
        .trim();
      return {
        original: raw,
        normalized,
        tokens: commandTerms(normalized),
        recommendation: "Review the normalized text before applying it to RFQ, PO, IMPA, or HS records.",
      };
    }

    case "rfq_intake:parse_rfq": {
      const { processRFQ } = await import("@/lib/ai/services/rfq");
      const text = (params.documentText as string) || (params.rawCommand as string) || "";
      const { isAIConfigured } = await import("@/lib/ai");
      if (!isAIConfigured()) {
        const { processRFQDeterministic } = await import("@/lib/rfq/deterministic");
        return { ...await processRFQDeterministic(text, organizationId), _execution: { provider: "nautex", model: "deterministic-prisma" } };
      }
      const result = await processRFQ(text, { ...context, organizationId });
      if (!result.ok) return { error: result.reason, _stub: true };
      return { ...result.data, _ai: { model: result.model, provider: result.provider } };
    }

    case "supplier_discovery:find_suppliers": {
      const { searchRecordedSuppliers } = await import("@/lib/learning/supplier-search");
      const raw = (params.query as string) || (params.rawCommand as string) || "";
      const { query, suppliers, correctionId } = await searchRecordedSuppliers(organizationId, raw);
      return {
        query,
        correctionId,
        matchingBasis: correctionId ? "Explicitly activated, reviewed supplier alias" : "Recorded supplier search",
        candidateCount: suppliers.length,
        candidates: suppliers.map((supplier, index) => ({
          rank: index + 1,
          supplierCode: supplier.supplierCode,
          name: supplier.name,
          country: supplier.country,
          city: supplier.city,
          score: supplier.score,
          leadTimeDays: supplier.leadTimeDays,
          categories: supplier.categories,
          portsCovered: supplier.portsCovered,
        })),
        recommendation: suppliers[0]
          ? `Review ${suppliers[0].name} as the top candidate before RFQ routing.`
          : "No active supplier candidate found. Add a supplier or broaden the criteria.",
      };
    }

    case "order_validation:validate_order": {
      const { validateOrder } = await import("@/lib/ai/services/order-validation");
      const { prisma } = await import("@/lib/prisma");
      const raw = `${(params.rawCommand as string) || ""} ${(params.id as string) || ""}`.trim();
      const poToken = typeof params.id === "string" ? params.id : raw.match(/\b(?:PO|NAX-PO|PO-)[A-Z0-9-]+\b/i)?.[0];
      const order = poToken
        ? await prisma.purchaseOrder.findFirst({
            where: {
              organizationId,
              OR: [
                { id: { equals: poToken } },
                { poNumber: { equals: poToken, mode: "insensitive" } },
                { poNumber: { contains: poToken, mode: "insensitive" } },
              ],
            },
            include: { lines: { orderBy: { lineNumber: "asc" } } },
          })
        : null;

      if (!order) throw new Error("Purchase order not found in the active organization.");
      const orderData = order ? {
        id: order.poNumber,
        vessel: order.vessel,
        supplier: order.supplier,
        total: order.total,
        marginPct: order.marginPct,
        items: order.lines.slice(0, 25).map((line) => `${line.lineNumber}. ${line.description} (${line.qtyOrdered} ${line.uom})`),
      } : {
        id: (params.id as string) || "unknown",
        vessel: (params.vessel as string) || "unknown",
        supplier: (params.supplier as string) || "unknown",
        total: (params.total as number) || 0,
        marginPct: (params.marginPct as number) || 0,
        currency: typeof params.currency === "string" ? params.currency : undefined,
        items: params.items as string[] | undefined,
      };
      const result = await validateOrder(orderData, { ...context, organizationId });
      if (!result.ok) return { error: result.reason, _stub: true };
      return {
        ...result.data,
        purchaseOrderId: order?.id,
        poNumber: order?.poNumber ?? orderData.id,
        humanReviewRequired: true,
        _ai: { model: result.model, provider: result.provider },
      };
    }

    case "procurement_validation:validate_quote_vs_po": {
      const { validateQuoteVsPO } = await import("@/lib/ai/services/procurement");
      const quoteText = (params.quoteText as string) || "";
      const poText = (params.poText as string) || "";
      if (!quoteText.trim() || !poText.trim()) throw new Error("Provide both quote text and purchase order text in Agent Monitor.");
      const result = await validateQuoteVsPO(quoteText, poText, { ...context, organizationId });
      if (!result.ok) return { error: result.reason, _stub: true };
      return { ...result.data, _ai: { model: result.model, provider: result.provider } };
    }

    default:
      return { error: `No handler for ${agentId}:${action}`, _pending: true };
  }
}
