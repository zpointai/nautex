/**
 * Agreement Duplicate / Renew API
 *
 * POST /api/v1/agreements/:id/duplicate
 * Body: { markupPercent?: number, validFrom?: string, validTo?: string, notes?: string }
 *
 * Creates a new Draft version for the same supplier, copying all items from
 * the source version. Useful for renewals and revisions.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { generateVersionInsight } from "@/lib/agreements/insights";
import { authorizeAgreementRequest } from "@/lib/auth/entity-access";
import { PERMISSIONS } from "@/lib/auth/permissions";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const authorization = await authorizeAgreementRequest(req, id, PERMISSIONS.AGREEMENTS_WRITE);
  if (!authorization.ok) return authorization.response;
  if (!authorization.agreement) return NextResponse.json({ error: "Source version not found" }, { status: 404 });
  const body = await req.json();
  const { markupPercent, validFrom, validTo, notes } = body;

  // Load source version with items
  const source = await prisma.agreementVersion.findFirst({
    where: { id, organizationId: authorization.context.organizationId },
    include: { items: { orderBy: { lineNumber: "asc" } } },
  });
  if (!source) {
    return NextResponse.json({ error: "Source version not found" }, { status: 404 });
  }

  // Determine next version number for this supplier
  const lastVersion = await prisma.agreementVersion.findFirst({
    where: { supplierId: source.supplierId, organizationId: authorization.context.organizationId },
    orderBy: { versionNumber: "desc" },
    select: { versionNumber: true },
  });
  const versionNumber = (lastVersion?.versionNumber || 0) + 1;

  // Use overrides or fall back to source values
  const newMarkup = markupPercent !== undefined ? Number(markupPercent) : source.markupPercent;

  // Recalculate prices if markup changed
  let totalBaseValue = 0;
  let totalMarkedUpValue = 0;

  const itemRecords = source.items.map((item) => {
    const basePrice = item.basePrice || 0;
    const markedUpPrice = newMarkup > 0
      ? Math.round(basePrice * (1 + newMarkup / 100) * 100) / 100
      : basePrice;
    totalBaseValue += basePrice;
    totalMarkedUpValue += markedUpPrice;

    return {
      lineNumber: item.lineNumber,
      offiNumber: item.offiNumber,
      systemId: item.systemId,
      vendorPartNumber: item.vendorPartNumber,
      description: item.description,
      basePrice,
      markedUpPrice,
      currency: item.currency,
      unit: item.unit,
      moq: item.moq,
      leadTimeDays: item.leadTimeDays,
      hsCode: item.hsCode,
      countryOfOrigin: item.countryOfOrigin,
      manufacturer: item.manufacturer,
    };
  });

  const version = await prisma.agreementVersion.create({
    data: {
      organizationId: authorization.context.organizationId,
      supplierId: source.supplierId,
      supplierName: source.supplierName,
      versionNumber,
      status: "Draft",
      markupPercent: newMarkup,
      totalBaseValue: Math.round(totalBaseValue * 100) / 100,
      totalMarkedUpValue: Math.round(totalMarkedUpValue * 100) / 100,
      currency: source.currency,
      validFrom: validFrom ? new Date(validFrom) : source.validFrom,
      validTo: validTo ? new Date(validTo) : source.validTo,
      notes: notes !== undefined ? notes : `Renewed from v${source.versionNumber}`,
      items: { create: itemRecords },
    },
    include: {
      _count: { select: { items: true } },
    },
  });

  // Generate insight
  await generateVersionInsight(
    version.id, source.supplierId, source.supplierName, "created",
    {
      status: "Draft",
      totalItems: itemRecords.length,
      markupPercent: newMarkup,
      validFrom: validFrom ? new Date(validFrom) : source.validFrom,
      validTo: validTo ? new Date(validTo) : source.validTo,
    },
  );

  return NextResponse.json({
    version: { ...version, status: "Draft" },
    sourceVersionNumber: source.versionNumber,
  }, { status: 201 });
}
