/**
 * Agreement Comparison Engine
 *
 * Adapted from SupplyChain Lens processAgreementComparison.
 * Compares uploaded supplier file rows against baseline agreement items,
 * detecting new/removed/changed/price_change items.
 */

import { prisma } from "@/lib/prisma";
import type { NormalizedRow } from "./parser";
import { normalizeNumber } from "./parser";
import { generateComparisonInsight } from "./insights";

/* -- Types ---------------------------------------------------------- */

interface BaselineItem {
  id: string;
  lineNumber: number;
  offiNumber: string | null;
  systemId: string | null;
  vendorPartNumber: string | null;
  description: string;
  basePrice: number;
  unit: string | null;
  moq: number | null;
  leadTimeDays: number | null;
  hsCode: string | null;
  countryOfOrigin: string | null;
  manufacturer: string | null;
  currency: string;
}

interface ChangeRecord {
  changeType: "New" | "Removed" | "PriceChange" | "FieldChange";
  matchKey: string;
  offiNumber: string | null;
  systemId: string | null;
  vendorPartNumber: string | null;
  description: string | null;
  oldValues: Record<string, unknown>;
  newValues: Record<string, unknown>;
  changedFields: string[];
  priceOld: number | null;
  priceNew: number | null;
  priceDiffPct: number | null;
  baselineItemId: string | null;
}

interface ComparisonSummary {
  totalItems: number;
  changedItems: number;
  newItems: number;
  removedItems: number;
  priceChanges: number;
  totalPriceImpact: number;
}

/* -- Helpers -------------------------------------------------------- */

function normalizeString(str: string | null | undefined): string {
  if (!str) return "";
  return str.toLowerCase().trim().replace(/\s+/g, " ");
}

function isValidValue(value: unknown): boolean {
  return value !== null && value !== undefined && value !== "" && String(value).trim() !== "";
}

function valuesAreDifferent(oldVal: unknown, newVal: unknown, fieldName: string): boolean {
  const isNumeric = ["price", "moq", "lead_time_days"].includes(fieldName);
  const oldN = isNumeric ? normalizeNumber(oldVal) : normalizeString(String(oldVal || ""));
  const newN = isNumeric ? normalizeNumber(newVal) : normalizeString(String(newVal || ""));
  if (oldN === newN) return false;
  if (oldN === null && newN === null) return false;
  if (oldN === "" && newN === "") return false;
  return true;
}

function getOutputValue(value: unknown, fieldName: string): unknown {
  if (value === null || value === undefined || value === "") return null;
  if (["price", "moq", "lead_time_days"].includes(fieldName)) {
    return normalizeNumber(value);
  }
  return String(value).trim();
}

function getMatchKey(baseline: BaselineItem | null, newRow: NormalizedRow | null): string {
  if (baseline?.offiNumber && isValidValue(baseline.offiNumber)) return baseline.offiNumber;
  if (newRow?.offi_number && isValidValue(newRow.offi_number)) return newRow.offi_number;
  if (baseline?.systemId && isValidValue(baseline.systemId)) return baseline.systemId;
  if (newRow?.system_id && isValidValue(newRow.system_id)) return newRow.system_id;
  if (baseline?.vendorPartNumber && isValidValue(baseline.vendorPartNumber)) return baseline.vendorPartNumber;
  if (newRow?.vendor_part_number && isValidValue(newRow.vendor_part_number)) return newRow.vendor_part_number;
  return "UNKNOWN";
}

/* -- Field mapping between baseline items and normalized rows ------- */

const FIELDS_TO_COMPARE = [
  { baseline: "basePrice", row: "price", label: "price" },
  { baseline: "moq", row: "moq", label: "moq" },
  { baseline: "unit", row: "unit", label: "unit" },
  { baseline: "leadTimeDays", row: "lead_time_days", label: "lead_time_days" },
  { baseline: "hsCode", row: "hs_code", label: "hs_code" },
  { baseline: "countryOfOrigin", row: "country_of_origin", label: "country_of_origin" },
  { baseline: "manufacturer", row: "manufacturer", label: "manufacturer" },
  { baseline: "description", row: "description", label: "description" },
] as const;

/* -- Main Comparison Engine ----------------------------------------- */

export async function runComparison(
  comparisonId: string,
  versionId: string,
  normalizedRows: NormalizedRow[],
): Promise<void> {
  const startTime = Date.now();

  // Update status to processing
  await prisma.agreementComparison.update({
    where: { id: comparisonId },
    data: { status: "Processing", startedAt: new Date(), progressPct: 5, progressMessage: "Loading baseline..." },
  });

  try {
    // Load baseline items
    const baselineItems = await prisma.agreementItem.findMany({
      where: { versionId },
      orderBy: { lineNumber: "asc" },
    });

    await prisma.agreementComparison.update({
      where: { id: comparisonId },
      data: { progressPct: 20, progressMessage: `Loaded ${baselineItems.length} baseline items` },
    });

    // Build lookup indexes (multi-key matching from SCL)
    const bySystemId = new Map<string, BaselineItem>();
    const byOffiNumber = new Map<string, BaselineItem>();
    const byVendorPart = new Map<string, BaselineItem[]>();

    for (const item of baselineItems) {
      const bi = item as BaselineItem;
      if (isValidValue(bi.systemId)) bySystemId.set(normalizeString(bi.systemId), bi);
      if (isValidValue(bi.offiNumber)) byOffiNumber.set(normalizeString(bi.offiNumber), bi);
      if (isValidValue(bi.vendorPartNumber)) {
        const k = normalizeString(bi.vendorPartNumber);
        if (!byVendorPart.has(k)) byVendorPart.set(k, []);
        byVendorPart.get(k)!.push(bi);
      }
    }

    await prisma.agreementComparison.update({
      where: { id: comparisonId },
      data: { progressPct: 40, progressMessage: "Comparing rows..." },
    });

    // Compare each uploaded row against baseline
    const changes: ChangeRecord[] = [];
    const summary: ComparisonSummary = {
      totalItems: 0, changedItems: 0, newItems: 0, removedItems: 0, priceChanges: 0, totalPriceImpact: 0,
    };
    const matchedIds = new Set<string>();

    for (let i = 0; i < normalizedRows.length; i++) {
      const newRow = normalizedRows[i];
      let matched: BaselineItem | null = null;

      // Multi-key matching: system_id → offi_number → vendor_part_number
      if (!matched && isValidValue(newRow.system_id)) {
        matched = bySystemId.get(normalizeString(newRow.system_id)) || null;
      }
      if (!matched && isValidValue(newRow.offi_number)) {
        matched = byOffiNumber.get(normalizeString(newRow.offi_number)) || null;
      }
      if (!matched && isValidValue(newRow.vendor_part_number)) {
        const cands = byVendorPart.get(normalizeString(newRow.vendor_part_number)) || [];
        if (cands.length === 1) {
          matched = cands[0];
        } else if (cands.length > 1) {
          // Multiple vendor part matches — try description match
          const desc = normalizeString(newRow.description);
          for (const c of cands) {
            const cd = normalizeString(c.description);
            if (cd === desc || cd.includes(desc) || desc.includes(cd)) {
              matched = c;
              break;
            }
          }
        }
      }

      summary.totalItems++;

      if (matched) {
        matchedIds.add(matched.id);

        // Detect field-level changes
        const changedFields: string[] = [];
        const oldValues: Record<string, unknown> = {};
        const newValues: Record<string, unknown> = {};
        let hasPriceChange = false;

        for (const field of FIELDS_TO_COMPARE) {
          const oldVal = matched[field.baseline as keyof BaselineItem];
          const newVal = newRow[field.row as keyof NormalizedRow];

          if (valuesAreDifferent(oldVal, newVal, field.label)) {
            changedFields.push(field.label);
            oldValues[field.label] = getOutputValue(oldVal, field.label);
            newValues[field.label] = getOutputValue(newVal, field.label);
            if (field.label === "price") hasPriceChange = true;
          }
        }

        if (changedFields.length > 0) {
          summary.changedItems++;
          if (hasPriceChange) summary.priceChanges++;

          const priceOld = matched.basePrice;
          const priceNew = newRow.price;
          let priceDiffPct: number | null = null;
          if (hasPriceChange && priceOld && priceNew && priceOld > 0) {
            priceDiffPct = Math.round(((priceNew - priceOld) / priceOld) * 10000) / 100;
            summary.totalPriceImpact += priceNew - priceOld;
          }

          changes.push({
            changeType: hasPriceChange ? "PriceChange" : "FieldChange",
            matchKey: getMatchKey(matched, newRow),
            offiNumber: matched.offiNumber || newRow.offi_number,
            systemId: matched.systemId || newRow.system_id,
            vendorPartNumber: matched.vendorPartNumber || newRow.vendor_part_number,
            description: newRow.description || matched.description,
            oldValues,
            newValues,
            changedFields,
            priceOld,
            priceNew,
            priceDiffPct,
            baselineItemId: matched.id,
          });
        }
      } else {
        // New item not in baseline
        summary.newItems++;
        const newValues: Record<string, unknown> = {};
        for (const field of FIELDS_TO_COMPARE) {
          const val = getOutputValue(newRow[field.row as keyof NormalizedRow], field.label);
          if (val !== null) newValues[field.label] = val;
        }

        changes.push({
          changeType: "New",
          matchKey: getMatchKey(null, newRow),
          offiNumber: newRow.offi_number,
          systemId: newRow.system_id,
          vendorPartNumber: newRow.vendor_part_number,
          description: newRow.description,
          oldValues: {},
          newValues,
          changedFields: Object.keys(newValues),
          priceOld: null,
          priceNew: newRow.price,
          priceDiffPct: null,
          baselineItemId: null,
        });
      }

      // Update progress every 50 rows
      if (i % 50 === 0 && i > 0) {
        await prisma.agreementComparison.update({
          where: { id: comparisonId },
          data: {
            progressPct: 40 + Math.floor((i / normalizedRows.length) * 40),
            progressMessage: `Row ${i + 1}/${normalizedRows.length}`,
          },
        });
      }
    }

    // Detect removed items (in baseline but not in uploaded file)
    for (const item of baselineItems) {
      if (!matchedIds.has(item.id)) {
        summary.removedItems++;
        summary.totalItems++;

        const oldValues: Record<string, unknown> = {};
        for (const field of FIELDS_TO_COMPARE) {
          const val = getOutputValue(item[field.baseline as keyof BaselineItem], field.label);
          if (val !== null) oldValues[field.label] = val;
        }

        changes.push({
          changeType: "Removed",
          matchKey: getMatchKey(item as BaselineItem, null),
          offiNumber: item.offiNumber,
          systemId: item.systemId,
          vendorPartNumber: item.vendorPartNumber,
          description: item.description,
          oldValues,
          newValues: {},
          changedFields: Object.keys(oldValues),
          priceOld: item.basePrice,
          priceNew: null,
          priceDiffPct: null,
          baselineItemId: item.id,
        });
      }
    }

    await prisma.agreementComparison.update({
      where: { id: comparisonId },
      data: { progressPct: 90, progressMessage: "Saving results..." },
    });

    // Persist all change records
    if (changes.length > 0) {
      await prisma.agreementChange.createMany({
        data: changes.map((c) => ({
          comparisonId,
          changeType: c.changeType === "PriceChange" ? "PriceChange"
            : c.changeType === "FieldChange" ? "FieldChange"
            : c.changeType === "New" ? "New"
            : "Removed",
          matchKey: c.matchKey,
          offiNumber: c.offiNumber,
          systemId: c.systemId,
          vendorPartNumber: c.vendorPartNumber,
          description: c.description,
          oldValues: c.oldValues as object ?? undefined,
          newValues: c.newValues as object ?? undefined,
          changedFields: c.changedFields,
          priceOld: c.priceOld,
          priceNew: c.priceNew,
          priceDiffPct: c.priceDiffPct,
          baselineItemId: c.baselineItemId,
        })),
      });
    }

    // Update comparison as completed
    await prisma.agreementComparison.update({
      where: { id: comparisonId },
      data: {
        status: "ComparisonCompleted",
        progressPct: 100,
        progressMessage: "Complete",
        completedAt: new Date(),
        durationMs: Date.now() - startTime,
        sourceRowCount: normalizedRows.length,
        totalChanges: changes.length,
        newItems: summary.newItems,
        removedItems: summary.removedItems,
        changedItems: summary.changedItems,
        priceChanges: summary.priceChanges,
        totalPriceImpact: Math.round(summary.totalPriceImpact * 100) / 100,
      },
    });

    // Generate insight for the comparison result
    const version = await prisma.agreementVersion.findUnique({
      where: { id: versionId },
      select: { supplierId: true, supplierName: true },
    });
    if (version) {
      await generateComparisonInsight(comparisonId, versionId, version.supplierId, version.supplierName, summary, changes);
    }

    console.log(
      `[agreements] Comparison ${comparisonId} complete: ` +
      `total=${summary.totalItems}, changed=${summary.changedItems}, new=${summary.newItems}, removed=${summary.removedItems}`,
    );
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : "Unknown error";
    await prisma.agreementComparison.update({
      where: { id: comparisonId },
      data: {
        status: "ComparisonFailed",
        progressPct: 0,
        progressMessage: "Failed",
        error: errMsg,
        durationMs: Date.now() - startTime,
      },
    });
    console.error(`[agreements] Comparison ${comparisonId} failed:`, errMsg);
    throw error;
  }
}
