/**
 * Agreement Version Detail API
 *
 * GET    /api/v1/agreements/:id  — get version with items
 * PATCH  /api/v1/agreements/:id  — update version (status, markup, validity, notes)
 * DELETE /api/v1/agreements/:id  — delete version (draft only)
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { generateVersionInsight } from "@/lib/agreements/insights";
import { authorizeOrganizationRequest } from "@/lib/auth/authorization";
import { PERMISSIONS } from "@/lib/auth/permissions";

type Ctx = { params: Promise<{ id: string }> };

/* ── GET — Full version detail with items ──────────────────────── */

export async function GET(req: NextRequest, ctx: Ctx) {
  const authorization = await authorizeOrganizationRequest(req, PERMISSIONS.APP_READ);
  if (!authorization.ok) return authorization.response;
  const { id } = await ctx.params;

  const version = await prisma.agreementVersion.findFirst({
    where: { id, organizationId: authorization.context.organizationId },
    include: {
      items: { orderBy: { lineNumber: "asc" } },
      comparisons: {
        orderBy: { createdAt: "desc" },
        take: 5,
        select: {
          id: true, status: true, sourceFileName: true, totalChanges: true,
          newItems: true, removedItems: true, changedItems: true, priceChanges: true,
          totalPriceImpact: true, completedAt: true, createdAt: true,
        },
      },
      _count: { select: { items: true, comparisons: true } },
    },
  });

  if (!version) {
    return NextResponse.json({ error: "Agreement version not found" }, { status: 404 });
  }

  // Map status
  const mapped = {
    ...version,
    status: version.status === "AgreementActive" ? "Active"
      : version.status === "AgreementExpired" ? "Expired"
      : version.status,
    comparisons: version.comparisons.map((c) => ({
      ...c,
      status: c.status === "ComparisonCompleted" ? "Completed"
        : c.status === "ComparisonFailed" ? "Failed"
        : c.status,
    })),
  };

  return NextResponse.json({ version: mapped });
}

/* ── PATCH — Update version ────────────────────────────────────── */

export async function PATCH(req: NextRequest, ctx: Ctx) {
  const authorization = await authorizeOrganizationRequest(req, PERMISSIONS.AGREEMENTS_WRITE);
  if (!authorization.ok) return authorization.response;
  const { id } = await ctx.params;
  const body = await req.json();

  const existing = await prisma.agreementVersion.findFirst({
    where: { id, organizationId: authorization.context.organizationId },
    select: {
      id: true, status: true, supplierId: true, supplierName: true,
      markupPercent: true, _count: { select: { items: true } },
    },
  });
  if (!existing) {
    return NextResponse.json({ error: "Agreement version not found" }, { status: 404 });
  }

  const data: Record<string, unknown> = {};

  // Status transition
  if (body.status) {
    const statusMap: Record<string, string> = {
      Draft: "Draft", Sent: "Sent", Active: "AgreementActive", Expired: "AgreementExpired", Archived: "Archived",
    };
    const newStatus = statusMap[body.status] || body.status;
    data.status = newStatus;

    if (body.status === "Sent" && existing.status !== "Sent") {
      data.sentAt = new Date();
    }
  }

  if (body.markupPercent !== undefined) {
    data.markupPercent = Number(body.markupPercent);

    // Recalculate marked-up prices for all items
    const items = await prisma.agreementItem.findMany({ where: { versionId: id } });
    const markup = Number(body.markupPercent);
    let totalMarkedUp = 0;
    for (const item of items) {
      const markedUpPrice = Math.round(item.basePrice * (1 + markup / 100) * 100) / 100;
      totalMarkedUp += markedUpPrice;
      await prisma.agreementItem.update({
        where: { id: item.id },
        data: { markedUpPrice },
      });
    }
    data.totalMarkedUpValue = Math.round(totalMarkedUp * 100) / 100;
  }

  if (body.validFrom !== undefined) data.validFrom = body.validFrom ? new Date(body.validFrom) : null;
  if (body.validTo !== undefined) data.validTo = body.validTo ? new Date(body.validTo) : null;
  if (body.notes !== undefined) data.notes = body.notes;

  const updated = await prisma.agreementVersion.update({
    where: { id },
    data,
    include: { _count: { select: { items: true } } },
  });

  // Generate lifecycle insight if status changed
  if (body.status && body.status !== existing.status) {
    await generateVersionInsight(
      id, existing.supplierId, existing.supplierName, "status_changed",
      {
        status: body.status,
        previousStatus: existing.status,
        totalItems: existing._count.items,
        markupPercent: updated.markupPercent,
      },
    );
  }

  // Generate update insight if markup changed
  if (body.markupPercent !== undefined && body.markupPercent !== existing.markupPercent) {
    await generateVersionInsight(
      id, existing.supplierId, existing.supplierName, "updated",
      {
        status: existing.status,
        totalItems: existing._count.items,
        markupPercent: updated.markupPercent,
        markupDiff: updated.markupPercent - existing.markupPercent,
      },
    );
  }

  return NextResponse.json({
    version: {
      ...updated,
      status: updated.status === "AgreementActive" ? "Active"
        : updated.status === "AgreementExpired" ? "Expired"
        : updated.status,
    },
  });
}

/* ── DELETE — Delete draft version ─────────────────────────────── */

export async function DELETE(req: NextRequest, ctx: Ctx) {
  const authorization = await authorizeOrganizationRequest(req, PERMISSIONS.AGREEMENTS_WRITE);
  if (!authorization.ok) return authorization.response;
  const { id } = await ctx.params;

  const existing = await prisma.agreementVersion.findFirst({
    where: { id, organizationId: authorization.context.organizationId },
    select: { status: true },
  });
  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (existing.status !== "Draft") {
    return NextResponse.json({ error: "Only draft agreements can be deleted" }, { status: 400 });
  }

  try {
    await prisma.$transaction(async (tx) => {
      await tx.agreementInsight.deleteMany({ where: { versionId: id } });
      await tx.customerContractSourceAgreement.deleteMany({ where: { agreementVersionId: id } });
      await tx.agreementVersion.delete({ where: { id } });
    });
    return NextResponse.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Agreement could not be deleted";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
