import { generateText } from "@/lib/ai/provider";
import type { AIServiceContext } from "@/lib/ai/provider";
import type { DerivedBackorder } from "@/lib/backorders/derived";

export interface BackorderDraftEmail {
  to: string | null;
  subject: string;
  body: string;
  confidence: number;
  provider: string;
  model: string;
  fallbackUsed: boolean;
  automationIdeas: string[];
}

export function formatBackorderDate(value: string) {
  return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(value));
}

export function backorderItemSummary(backorder: DerivedBackorder) {
  return backorder.items
    .map((item) => `- ${item.description}: ${item.qty} ${item.unit}, requested ${formatBackorderDate(item.requestedDate)}, ${item.delayDays} day(s) delayed`)
    .join("\n");
}

export function automationIdeasFor(backorder: DerivedBackorder) {
  const ideas = [
    "Monitor this PO daily until every backordered line has a confirmed date.",
    "Create an exception if the supplier has not replied within 24 hours.",
    "Request delivery evidence automatically when the supplier confirms dispatch.",
  ];

  if (backorder.priority === "critical") {
    ideas.unshift("Escalate to procurement lead if no supplier confirmation is received today.");
  }

  if (backorder.items.length > 1) {
    ideas.push("Split partial shipments when some lines become available earlier.");
  }

  return ideas;
}

export function fallbackDraft(backorder: DerivedBackorder): Omit<BackorderDraftEmail, "provider" | "model" | "fallbackUsed" | "automationIdeas"> {
  const subject = `Urgent delivery update requested - ${backorder.poNumber}`;
  const contact = backorder.supplierContact ? `Dear ${backorder.supplierContact},` : "Dear supplier team,";
  const portLine = backorder.port ? ` for delivery at ${backorder.port}` : "";

  return {
    to: backorder.supplierEmail,
    subject,
    body: `${contact}

We are following up on ${backorder.poNumber} for ${backorder.vessel}${portLine}. The following backordered line item(s) are now affecting our delivery plan:

${backorderItemSummary(backorder)}

Please confirm the current availability, revised dispatch date, and any partial shipment options. If an item cannot be supplied within the current schedule, please propose the closest substitute with price, lead time, and country of origin.

Vessel ETA: ${formatBackorderDate(backorder.eta)}
Current delay signal: ${backorder.totalDelayDays} day(s)

Kind regards,
Nautex Procurement`,
    confidence: 0.72,
  };
}

function normalizeModelBody(text: string, backorder: DerivedBackorder) {
  const trimmed = text.trim();
  const subjectMatch = trimmed.match(/^Subject:\s*(.+)$/im);
  const subject = subjectMatch?.[1]?.trim() || `Delivery update requested - ${backorder.poNumber}`;
  const body = trimmed
    .replace(/^To:\s*.+$/im, "")
    .replace(/^Subject:\s*.+$/im, "")
    .trim();

  return {
    subject,
    body: body || fallbackDraft(backorder).body,
  };
}

export async function draftBackorderEmail(backorder: DerivedBackorder, opts?: AIServiceContext & { useAI?: boolean }): Promise<BackorderDraftEmail> {
  const fallback = fallbackDraft(backorder);
  const useAI = opts?.useAI !== false;

  if (!useAI) {
    return {
      ...fallback,
      provider: "deterministic",
      model: "template",
      fallbackUsed: true,
      automationIdeas: automationIdeasFor(backorder),
    };
  }

  const prompt = `Draft a concise supplier follow-up email for a maritime procurement backorder.

Return plain text only with a Subject line and email body. Do not invent missing contact details.

Supplier: ${backorder.vendor}
Supplier contact: ${backorder.supplierContact ?? "unknown"}
PO: ${backorder.poNumber}
Vessel: ${backorder.vessel}
Port: ${backorder.port ?? "unknown"}
Vessel ETA: ${formatBackorderDate(backorder.eta)}
Priority: ${backorder.priority}
Total delay days: ${backorder.totalDelayDays}
Backordered lines:
${backorderItemSummary(backorder)}

Ask for: current availability, revised dispatch date, partial shipment options, substitutes if unavailable, and confirmation of price/lead time/country of origin for substitutes.`;

  const aiResult = await generateText(prompt, {
    organizationId: opts?.organizationId,
    signal: opts?.signal,
    tier: "fast",
    temperature: 0.2,
    maxTokens: 700,
    systemInstruction: "You are a maritime procurement follow-up agent. Write clear, professional supplier emails that preserve operational facts and ask for concrete next actions.",
  });

  const modelDraft = aiResult.ok && aiResult.data ? normalizeModelBody(aiResult.data, backorder) : null;
  return {
    to: backorder.supplierEmail,
    subject: modelDraft?.subject || fallback.subject,
    body: modelDraft?.body || fallback.body,
    confidence: modelDraft ? 0.86 : fallback.confidence,
    provider: modelDraft ? aiResult.provider : "nautex",
    model: modelDraft ? aiResult.model : "backorder-template",
    fallbackUsed: !modelDraft,
    automationIdeas: automationIdeasFor(backorder),
  };
}
