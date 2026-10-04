/**
 * Agreement Insights Engine
 *
 * Adapted from SupplyChain Lens agent.js patterns:
 * - agentOnComparisonCompleted → comparison result insights
 * - agentOnAgreementVersionChanged → lifecycle insights
 * - agentAnalyzeDaily sections A + C → expiry/stale draft detection
 */

import { prisma } from "@/lib/prisma";

/* -- Insight Creation with Dedup ------------------------------------ */

async function createInsight(insight: {
  organizationId?: string | null;
  type: string;
  severity: string;
  title: string;
  message: string;
  suggestion?: string | null;
  supplierId?: string | null;
  supplierName?: string | null;
  versionId?: string | null;
  comparisonId?: string | null;
  payload?: Record<string, unknown>;
  dedupeKey?: string | null;
}): Promise<string> {
  const supplier = insight.supplierId ? await prisma.supplier.findUnique({ where: { id: insight.supplierId }, select: { organizationId: true } }) : null;
  const organizationId = insight.organizationId ?? supplier?.organizationId ?? null;
  const dedupeKey = insight.dedupeKey || null;

  if (dedupeKey) {
    const existing = await prisma.agreementInsight.findUnique({ where: { dedupeKey } });
    if (existing) {
      await prisma.agreementInsight.update({
        where: { id: existing.id },
        data: {
          organizationId,
          title: insight.title,
          message: insight.message,
          suggestion: insight.suggestion,
          severity: insight.severity,
          payload: (insight.payload ?? {}) as object,
        },
      });
      return existing.id;
    }
  }

  const created = await prisma.agreementInsight.create({
    data: {
      organizationId,
      type: insight.type,
      severity: insight.severity,
      title: insight.title,
      message: insight.message,
      suggestion: insight.suggestion,
      supplierId: insight.supplierId,
      supplierName: insight.supplierName,
      versionId: insight.versionId,
      comparisonId: insight.comparisonId,
      payload: (insight.payload ?? {}) as object,
      dedupeKey,
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
    },
  });

  return created.id;
}

/* -- Comparison Result Insight -------------------------------------- */

interface ComparisonSummary {
  totalItems: number;
  changedItems: number;
  newItems: number;
  removedItems: number;
  priceChanges: number;
  totalPriceImpact: number;
}

interface ChangeRecord {
  changeType: string;
  priceDiffPct: number | null;
  priceOld: number | null;
  priceNew: number | null;
}

export async function generateComparisonInsight(
  comparisonId: string,
  versionId: string,
  supplierId: string,
  supplierName: string,
  summary: ComparisonSummary,
  changes: ChangeRecord[],
): Promise<void> {
  if (summary.changedItems === 0 && summary.newItems === 0 && summary.removedItems === 0) return;

  const PRICE_ALERT_PCT = 15;

  let priceIncreases = 0;
  let priceDecreases = 0;
  let significantChanges = 0;
  let maxPriceChangePct = 0;

  for (const c of changes) {
    if (c.changeType === "PriceChange" && c.priceOld != null && c.priceNew != null) {
      if (c.priceNew > c.priceOld) priceIncreases++;
      else priceDecreases++;
      if (c.priceDiffPct != null) {
        const absPct = Math.abs(c.priceDiffPct);
        if (absPct > PRICE_ALERT_PCT) significantChanges++;
        if (absPct > maxPriceChangePct) maxPriceChangePct = absPct;
      }
    }
  }

  let severity = "info";
  if (significantChanges > 0 || maxPriceChangePct > 25) severity = "warning";
  if (significantChanges > 5 || maxPriceChangePct > 50) severity = "critical";

  const parts: string[] = [];
  if (priceIncreases > 0) parts.push(`${priceIncreases} price increase${priceIncreases > 1 ? "s" : ""}`);
  if (priceDecreases > 0) parts.push(`${priceDecreases} price decrease${priceDecreases > 1 ? "s" : ""}`);
  if (summary.newItems > 0) parts.push(`${summary.newItems} new item${summary.newItems > 1 ? "s" : ""}`);
  if (summary.removedItems > 0) parts.push(`${summary.removedItems} removed`);

  const impactStr = summary.totalPriceImpact !== 0
    ? ` Net impact: €${summary.totalPriceImpact > 0 ? "+" : ""}${Math.round(summary.totalPriceImpact * 100) / 100}.`
    : "";

  await createInsight({
    type: "comparison_result",
    severity,
    title: `${supplierName}: ${changes.length} changes detected`,
    message: `Found: ${parts.join(", ")}.${impactStr}`,
    suggestion: significantChanges > 0
      ? `${significantChanges} item${significantChanges > 1 ? "s have" : " has"} price changes exceeding ${PRICE_ALERT_PCT}%. Review before applying.`
      : "Changes are within normal range. Review and apply when ready.",
    supplierId,
    supplierName,
    versionId,
    comparisonId,
    payload: {
      totalChanges: changes.length,
      priceIncreases,
      priceDecreases,
      newItems: summary.newItems,
      removedItems: summary.removedItems,
      significantChanges,
      totalPriceImpact: Math.round(summary.totalPriceImpact * 100) / 100,
      maxPriceChangePct: Math.round(maxPriceChangePct * 10) / 10,
    },
    dedupeKey: `comparison_${comparisonId}`,
  });
}

/* -- Version Lifecycle Insights ------------------------------------- */

export async function generateVersionInsight(
  versionId: string,
  supplierId: string,
  supplierName: string,
  eventType: "created" | "status_changed" | "updated",
  details: {
    status?: string;
    previousStatus?: string;
    totalItems?: number;
    markupPercent?: number;
    validFrom?: Date | null;
    validTo?: Date | null;
    itemDiff?: number;
    markupDiff?: number;
  },
): Promise<void> {
  const { status, previousStatus, totalItems = 0, markupPercent = 0, validFrom, validTo } = details;

  if (eventType === "created") {
    const validityStr = validFrom && validTo
      ? `Valid: ${validFrom.toLocaleDateString("en-GB")} – ${validTo.toLocaleDateString("en-GB")}.`
      : "";

    await createInsight({
      type: "agreement_created",
      severity: "info",
      title: `${supplierName}: New ${status || "draft"} agreement`,
      message: `${totalItems} items. Markup: ${markupPercent}%. ${validityStr}`.trim(),
      suggestion: status === "Draft"
        ? "Review the draft and finalize when pricing is confirmed."
        : "Agreement is active. Monitor for future price updates.",
      supplierId,
      supplierName,
      versionId,
      payload: { versionId, status, totalItems, markupPercent },
      dedupeKey: `agreement_created_${versionId}`,
    });
    return;
  }

  if (eventType === "status_changed" && previousStatus) {
    const severityMap: Record<string, string> = {
      AgreementActive: "info", Sent: "info", AgreementExpired: "warning", Archived: "info",
    };
    await createInsight({
      type: "agreement_status_changed",
      severity: severityMap[status || ""] || "info",
      title: `${supplierName}: Agreement ${previousStatus} → ${status}`,
      message: `${totalItems} items. Markup: ${markupPercent}%.`,
      suggestion: status === "AgreementActive"
        ? "Agreement is now active. Items will use these prices for new orders."
        : status === "AgreementExpired"
          ? "Agreement has expired. Consider creating a renewal."
          : `Agreement moved to ${status}. No immediate action needed.`,
      supplierId,
      supplierName,
      versionId,
      payload: { versionId, previousStatus, status, totalItems, markupPercent },
      dedupeKey: `agreement_status_${versionId}_${status}`,
    });
    return;
  }

  if (eventType === "updated") {
    const { itemDiff = 0, markupDiff = 0 } = details;
    const changeParts: string[] = [];
    if (itemDiff > 0) changeParts.push(`${itemDiff} items added`);
    else if (itemDiff < 0) changeParts.push(`${Math.abs(itemDiff)} items removed`);
    if (markupDiff !== 0) changeParts.push(`markup ${markupDiff > 0 ? "+" : ""}${Math.round(markupDiff * 10) / 10}%`);

    if (changeParts.length > 0) {
      await createInsight({
        type: "agreement_updated",
        severity: "info",
        title: `${supplierName}: Agreement updated`,
        message: `${changeParts.join(", ")}. Now ${totalItems} items at ${markupPercent}% markup.`,
        suggestion: "Review the changes and confirm they match your expectations.",
        supplierId,
        supplierName,
        versionId,
        payload: { versionId, status, totalItems, markupPercent, itemDiff, markupDiff },
        dedupeKey: `agreement_updated_${versionId}`,
      });
    }
  }
}

/* -- Expiry & Stale Draft Scanner ----------------------------------- */

export async function scanExpiryAndStaleDrafts(organizationId: string): Promise<{
  expiryInsights: number;
  staleDraftInsights: number;
  cleanedUp: number;
}> {
  if (!organizationId) throw new Error("An organization is required for agreement scans.");
  const now = new Date();
  const EXPIRY_WARNING_DAYS = 30;
  const STALE_DRAFT_DAYS = 14;
  let expiryInsights = 0;
  let staleDraftInsights = 0;

  // A) Contract expiry scanner
  const versions = await prisma.agreementVersion.findMany({
    where: { organizationId, status: { in: ["Draft", "Sent", "AgreementActive"] } },
    select: {
      id: true, supplierId: true, supplierName: true, status: true,
      validTo: true, markupPercent: true,
      _count: { select: { items: true } },
    },
  });

  for (const v of versions) {
    if (!v.validTo) continue;
    const daysUntilExpiry = Math.ceil((v.validTo.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

    if (daysUntilExpiry <= 0) {
      await createInsight({
        type: "contract_expired",
        severity: "critical",
        title: `${v.supplierName}: Agreement EXPIRED`,
        message: `Agreement expired ${Math.abs(daysUntilExpiry)} day${Math.abs(daysUntilExpiry) !== 1 ? "s" : ""} ago. ${v._count.items} items affected.`,
        suggestion: "Create a new agreement version or renew with updated pricing.",
        supplierId: v.supplierId,
        supplierName: v.supplierName,
        versionId: v.id,
        payload: {
          daysExpired: Math.abs(daysUntilExpiry),
          totalItems: v._count.items,
          markupPercent: v.markupPercent,
        },
        dedupeKey: `expiry_${v.id}`,
      });
      expiryInsights++;
    } else if (daysUntilExpiry <= EXPIRY_WARNING_DAYS) {
      await createInsight({
        type: "contract_expiring",
        severity: daysUntilExpiry <= 7 ? "warning" : "info",
        title: `${v.supplierName}: Agreement expires in ${daysUntilExpiry} day${daysUntilExpiry !== 1 ? "s" : ""}`,
        message: `Valid until ${v.validTo.toLocaleDateString("en-GB")}. Markup: ${v.markupPercent}%. ${v._count.items} items.`,
        suggestion: daysUntilExpiry <= 7
          ? "Expiry is imminent. Prepare renewal or notify the customer."
          : "Plan ahead for renewal. Review pricing and negotiate if needed.",
        supplierId: v.supplierId,
        supplierName: v.supplierName,
        versionId: v.id,
        payload: {
          daysUntilExpiry,
          totalItems: v._count.items,
          markupPercent: v.markupPercent,
        },
        dedupeKey: `expiring_${v.id}`,
      });
      expiryInsights++;
    }
  }

  // C) Stale draft detection
  const staleDate = new Date();
  staleDate.setDate(staleDate.getDate() - STALE_DRAFT_DAYS);

  const staleDrafts = await prisma.agreementVersion.findMany({
    where: { organizationId, status: "Draft", createdAt: { lt: staleDate } },
    select: { id: true, supplierName: true, createdAt: true },
  });

  if (staleDrafts.length > 0) {
    const suppliers = [...new Set(staleDrafts.map((d) => d.supplierName))];
    await createInsight({
      type: "stale_drafts",
      organizationId,
      severity: "info",
      title: `${staleDrafts.length} draft agreement${staleDrafts.length > 1 ? "s" : ""} older than ${STALE_DRAFT_DAYS} days`,
      message: `Suppliers: ${suppliers.slice(0, 3).join(", ")}${suppliers.length > 3 ? ` +${suppliers.length - 3} more` : ""}. Consider sending or archiving.`,
      suggestion: "Review stale drafts. If pricing has changed since creation, the drafts may need updating.",
      payload: { count: staleDrafts.length, suppliers },
      dedupeKey: `stale_drafts_${organizationId}_${now.toISOString().split("T")[0]}`,
    });
    staleDraftInsights++;
  }

  // Cleanup expired insights
  const cleanedUp = await prisma.agreementInsight.deleteMany({
    where: { organizationId, expiresAt: { lt: now } },
  });

  return { expiryInsights, staleDraftInsights, cleanedUp: cleanedUp.count };
}
