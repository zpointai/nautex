/**
 * Agreement Review/Apply API
 *
 * POST /api/v1/agreements/:id/review — accept/reject/auto-apply changes
 *
 * Body:
 *   { action: "accept" | "reject" | "auto_apply", changeIds: string[], comparisonId: string }
 *
 * "accept"     — marks selected changes as Accepted, applies them to agreement items
 * "reject"     — marks selected changes as Rejected, no data modification
 * "auto_apply" — accepts all low-risk changes (field changes, price decreases)
 */

import { NextRequest, NextResponse } from "next/server";
import { authorizeOrganizationRequest } from "@/lib/auth/authorization";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { prisma } from "@/lib/prisma";

type Ctx = { params: Promise<{ id: string }> };

const SIGNIFICANT_PRICE_CHANGE_PCT = 15;

export async function POST(req: NextRequest, ctx: Ctx) {
  const authorization = await authorizeOrganizationRequest(req, PERMISSIONS.AGREEMENTS_APPROVE);
  if (!authorization.ok) return authorization.response;

  const { id: versionId } = await ctx.params;
  const body = await req.json();
  const { action, changeIds, comparisonId } = body;

  if (!action || !comparisonId) {
    return NextResponse.json({ error: "action and comparisonId are required" }, { status: 400 });
  }

  // Verify version and comparison exist
  const version = await prisma.agreementVersion.findFirst({
    where: { id: versionId, organizationId: authorization.context.organizationId },
    select: { id: true, markupPercent: true },
  });
  if (!version) {
    return NextResponse.json({ error: "Agreement version not found" }, { status: 404 });
  }

  const comparison = await prisma.agreementComparison.findUnique({
    where: { id: comparisonId },
    select: { id: true, versionId: true, status: true },
  });
  if (!comparison || comparison.versionId !== versionId) {
    return NextResponse.json({ error: "Comparison not found for this version" }, { status: 404 });
  }

  let targetChanges;

  if (action === "auto_apply") {
    // Auto-apply low-risk changes: field changes + price decreases + small price increases
    targetChanges = await prisma.agreementChange.findMany({
      where: {
        comparisonId,
        reviewStatus: "Pending",
        OR: [
          { changeType: "FieldChange" },
          { changeType: "New" },
          {
            changeType: "PriceChange",
            priceDiffPct: { lte: SIGNIFICANT_PRICE_CHANGE_PCT },
          },
        ],
      },
    });
  } else {
    if (!Array.isArray(changeIds) || changeIds.length === 0) {
      return NextResponse.json({ error: "changeIds array is required" }, { status: 400 });
    }
    targetChanges = await prisma.agreementChange.findMany({
      where: { id: { in: changeIds }, comparisonId, reviewStatus: "Pending" },
    });
  }

  if (targetChanges.length === 0) {
    return NextResponse.json({ message: "No pending changes to process", accepted: 0, rejected: 0 });
  }

  const now = new Date();
  const reviewer = action === "auto_apply" ? "auto" : authorization.context.displayName;
  let accepted = 0;
  let rejected = 0;

  if (action === "reject") {
    // Mark all as rejected
    await prisma.agreementChange.updateMany({
      where: { id: { in: targetChanges.map((c) => c.id) } },
      data: { reviewStatus: "RejectedReview", reviewedAt: now, reviewedBy: reviewer },
    });
    rejected = targetChanges.length;
  } else {
    // Accept or auto-apply: apply changes to agreement items
    const markup = version.markupPercent;

    for (const change of targetChanges) {
      const reviewStatus = action === "auto_apply" ? "AutoApplied" : "Accepted";

      if (change.changeType === "New") {
        // Create new agreement item
        const newValues = change.newValues as Record<string, unknown>;
        const lastItem = await prisma.agreementItem.findFirst({
          where: { versionId },
          orderBy: { lineNumber: "desc" },
          select: { lineNumber: true },
        });
        const basePrice = Number(newValues.price) || 0;
        const markedUpPrice = markup > 0 ? Math.round(basePrice * (1 + markup / 100) * 100) / 100 : basePrice;

        const newItem = await prisma.agreementItem.create({
          data: {
            versionId,
            lineNumber: (lastItem?.lineNumber || 0) + 1,
            offiNumber: change.offiNumber,
            systemId: change.systemId,
            vendorPartNumber: change.vendorPartNumber,
            description: change.description || String(newValues.description || ""),
            basePrice,
            markedUpPrice,
            currency: String(newValues.currency || "EUR"),
            unit: newValues.unit ? String(newValues.unit) : null,
            moq: newValues.moq ? Number(newValues.moq) : null,
            leadTimeDays: newValues.lead_time_days ? Number(newValues.lead_time_days) : null,
            hsCode: newValues.hs_code ? String(newValues.hs_code) : null,
            countryOfOrigin: newValues.country_of_origin ? String(newValues.country_of_origin) : null,
            manufacturer: newValues.manufacturer ? String(newValues.manufacturer) : null,
          },
        });

        await prisma.agreementChange.update({
          where: { id: change.id },
          data: { reviewStatus, reviewedAt: now, reviewedBy: reviewer, appliedToItemId: newItem.id },
        });
      } else if (change.changeType === "Removed" && change.baselineItemId) {
        // Remove item from agreement
        await prisma.agreementItem.delete({ where: { id: change.baselineItemId } }).catch(() => {});
        await prisma.agreementChange.update({
          where: { id: change.id },
          data: { reviewStatus, reviewedAt: now, reviewedBy: reviewer },
        });
      } else if ((change.changeType === "PriceChange" || change.changeType === "FieldChange") && change.baselineItemId) {
        // Update existing item
        const newValues = change.newValues as Record<string, unknown>;
        const updateData: Record<string, unknown> = {};

        for (const field of change.changedFields) {
          const val = newValues[field];
          if (field === "price" && val != null) {
            updateData.basePrice = Number(val);
            updateData.markedUpPrice = markup > 0
              ? Math.round(Number(val) * (1 + markup / 100) * 100) / 100
              : Number(val);
          } else if (field === "description" && val != null) updateData.description = String(val);
          else if (field === "unit" && val != null) updateData.unit = String(val);
          else if (field === "moq" && val != null) updateData.moq = Number(val);
          else if (field === "lead_time_days" && val != null) updateData.leadTimeDays = Number(val);
          else if (field === "hs_code" && val != null) updateData.hsCode = String(val);
          else if (field === "country_of_origin" && val != null) updateData.countryOfOrigin = String(val);
          else if (field === "manufacturer" && val != null) updateData.manufacturer = String(val);
        }

        if (Object.keys(updateData).length > 0) {
          await prisma.agreementItem.update({
            where: { id: change.baselineItemId },
            data: updateData,
          });
        }

        await prisma.agreementChange.update({
          where: { id: change.id },
          data: { reviewStatus, reviewedAt: now, reviewedBy: reviewer, appliedToItemId: change.baselineItemId },
        });
      }

      accepted++;
    }

    // Recalculate version totals
    const items = await prisma.agreementItem.findMany({
      where: { versionId },
      select: { basePrice: true, markedUpPrice: true },
    });
    const totalBaseValue = items.reduce((sum, i) => sum + i.basePrice, 0);
    const totalMarkedUpValue = items.reduce((sum, i) => sum + (i.markedUpPrice || i.basePrice), 0);

    await prisma.agreementVersion.update({
      where: { id: versionId },
      data: {
        totalBaseValue: Math.round(totalBaseValue * 100) / 100,
        totalMarkedUpValue: Math.round(totalMarkedUpValue * 100) / 100,
      },
    });
  }

  return NextResponse.json({
    success: true,
    action,
    accepted,
    rejected,
    total: targetChanges.length,
  });
}
