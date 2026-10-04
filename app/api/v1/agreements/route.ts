/**
 * Agreements API — List & Create
 *
 * GET  /api/v1/agreements  — list agreement versions (filterable by supplier, status)
 * POST /api/v1/agreements  — create a new agreement version
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { generateVersionInsight } from "@/lib/agreements/insights";
import { authorizeOrganizationRequest } from "@/lib/auth/authorization";
import { PERMISSIONS } from "@/lib/auth/permissions";

/* ── GET — List agreement versions ─────────────────────────────── */

export async function GET(req: NextRequest) {
  const authorization = await authorizeOrganizationRequest(req, PERMISSIONS.APP_READ);
  if (!authorization.ok) return authorization.response;
  const sp = req.nextUrl.searchParams;
  const supplierId = sp.get("supplierId");
  const status = sp.get("status");
  const search = sp.get("search");
  const page = Math.max(1, Number(sp.get("page")) || 1);
  const limit = Math.min(100, Math.max(1, Number(sp.get("limit")) || 50));
  const skip = (page - 1) * limit;

  const where: Record<string, unknown> = { organizationId: authorization.context.organizationId };
  if (supplierId) where.supplierId = supplierId;
  if (status) {
    // Map frontend status names to Prisma enum values
    const statusMap: Record<string, string> = {
      Draft: "Draft", Sent: "Sent", Active: "AgreementActive", Expired: "AgreementExpired", Archived: "Archived",
    };
    where.status = statusMap[status] || status;
  }
  if (search) {
    where.supplierName = { contains: search, mode: "insensitive" };
  }

  const [versions, total] = await Promise.all([
    prisma.agreementVersion.findMany({
      where,
      include: {
        _count: { select: { items: true, comparisons: true } },
      },
      orderBy: { updatedAt: "desc" },
      skip,
      take: limit,
    }),
    prisma.agreementVersion.count({ where }),
  ]);

  // Map Prisma enum values to frontend-friendly status names
  const mapped = versions.map((v) => ({
    ...v,
    status: v.status === "AgreementActive" ? "Active"
      : v.status === "AgreementExpired" ? "Expired"
      : v.status,
  }));

  return NextResponse.json({ versions: mapped, total, page, limit });
}

/* ── POST — Create new agreement version ───────────────────────── */

export async function POST(req: NextRequest) {
  const authorization = await authorizeOrganizationRequest(req, PERMISSIONS.AGREEMENTS_WRITE);
  if (!authorization.ok) return authorization.response;
  const body = await req.json();
  const { supplierId, markupPercent = 0, validFrom, validTo, notes, items } = body;

  if (!supplierId) {
    return NextResponse.json({ error: "supplierId is required" }, { status: 400 });
  }

  // Get supplier
  const supplier = await prisma.supplier.findFirst({
    where: { id: supplierId, organizationId: authorization.context.organizationId },
    select: { id: true, name: true },
  });
  if (!supplier) {
    return NextResponse.json({ error: "Supplier not found" }, { status: 404 });
  }

  // Determine next version number
  const lastVersion = await prisma.agreementVersion.findFirst({
    where: { supplierId, organizationId: authorization.context.organizationId },
    orderBy: { versionNumber: "desc" },
    select: { versionNumber: true },
  });
  const versionNumber = (lastVersion?.versionNumber || 0) + 1;

  // Calculate totals from items
  const parsedItems = Array.isArray(items) ? items : [];
  let totalBaseValue = 0;
  let totalMarkedUpValue = 0;
  const markup = Number(markupPercent) || 0;

  const itemRecords = parsedItems.map((item: Record<string, unknown>, idx: number) => {
    const basePrice = Number(item.basePrice) || 0;
    const markedUpPrice = markup > 0 ? Math.round(basePrice * (1 + markup / 100) * 100) / 100 : basePrice;
    totalBaseValue += basePrice;
    totalMarkedUpValue += markedUpPrice;

    return {
      lineNumber: idx + 1,
      offiNumber: (item.offiNumber as string) || null,
      systemId: (item.systemId as string) || null,
      vendorPartNumber: (item.vendorPartNumber as string) || null,
      description: String(item.description || ""),
      basePrice,
      markedUpPrice,
      currency: (item.currency as string) || "EUR",
      unit: (item.unit as string) || null,
      moq: item.moq ? Number(item.moq) : null,
      leadTimeDays: item.leadTimeDays ? Number(item.leadTimeDays) : null,
      hsCode: (item.hsCode as string) || null,
      countryOfOrigin: (item.countryOfOrigin as string) || null,
      manufacturer: (item.manufacturer as string) || null,
    };
  });

  const version = await prisma.agreementVersion.create({
    data: {
      organizationId: authorization.context.organizationId,
      supplierId: supplier.id,
      supplierName: supplier.name,
      versionNumber,
      status: "Draft",
      markupPercent: markup,
      totalBaseValue: Math.round(totalBaseValue * 100) / 100,
      totalMarkedUpValue: Math.round(totalMarkedUpValue * 100) / 100,
      validFrom: validFrom ? new Date(validFrom) : null,
      validTo: validTo ? new Date(validTo) : null,
      notes: notes || null,
      items: { create: itemRecords },
    },
    include: {
      _count: { select: { items: true } },
    },
  });

  // Generate lifecycle insight
  await generateVersionInsight(
    version.id, supplier.id, supplier.name, "created",
    {
      status: "Draft",
      totalItems: itemRecords.length,
      markupPercent: markup,
      validFrom: validFrom ? new Date(validFrom) : null,
      validTo: validTo ? new Date(validTo) : null,
    },
  );

  return NextResponse.json({ version: { ...version, status: "Draft" } }, { status: 201 });
}
