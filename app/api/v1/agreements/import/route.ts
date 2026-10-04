/**
 * Agreement Import API
 *
 * POST /api/v1/agreements/import
 * Accepts multipart form data with a supplier file (CSV/XLSX).
 * Parses the file, maps columns, and creates a new AgreementVersion with items.
 *
 * Body (form-data):
 *   file:        File (required)
 *   supplierId:  string (optional when supplierName is provided)
 *   supplierName: string (optional; used to resolve/create supplier)
 *   markupPercent: number (optional, default 0)
 *   validFrom:   ISO date string (optional)
 *   validTo:     ISO date string (optional)
 *   notes:       string (optional)
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { parseAgreementFile } from "@/lib/agreements/parser";
import { generateVersionInsight } from "@/lib/agreements/insights";
import { authorizeOrganizationRequest } from "@/lib/auth/authorization";
import { PERMISSIONS } from "@/lib/auth/permissions";

export async function POST(req: NextRequest) {
  const authorization = await authorizeOrganizationRequest(req, PERMISSIONS.AGREEMENTS_WRITE);
  if (!authorization.ok) return authorization.response;
  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  const supplierId = formData.get("supplierId") as string | null;
  const supplierName = (formData.get("supplierName") as string | null)?.trim() || null;
  const markupPercent = Number(formData.get("markupPercent")) || 0;
  const validFrom = formData.get("validFrom") as string | null;
  const validTo = formData.get("validTo") as string | null;
  const notes = formData.get("notes") as string | null;

  if (!file) {
    return NextResponse.json({ error: "file is required" }, { status: 400 });
  }
  if (!supplierId && !supplierName) {
    return NextResponse.json({ error: "supplierId or supplierName is required" }, { status: 400 });
  }

  // Resolve an existing supplier or create a trade-agreement-only profile
  const supplier = supplierId
    ? await prisma.supplier.findFirst({
        where: { id: supplierId, organizationId: authorization.context.organizationId },
        select: { id: true, name: true },
      })
    : await findOrCreateSupplier(supplierName as string, authorization.context.organizationId);
  if (!supplier) {
    return NextResponse.json({ error: "Supplier not found" }, { status: 404 });
  }

  // Parse file
  const buffer = Buffer.from(await file.arrayBuffer());
  const fileName = file.name || "upload";
  const extension = fileName.split(".").pop()?.toLowerCase() || "";
  const fileType = extension === "csv" ? "csv" : extension === "xls" ? "xls" : "xlsx";

  let parseResult;
  try {
    parseResult = await parseAgreementFile(buffer, fileType);
  } catch (err) {
    return NextResponse.json(
      { error: `Failed to parse file: ${err instanceof Error ? err.message : "Unknown error"}` },
      { status: 400 },
    );
  }

  const { rows, mappedColumns } = parseResult;
  if (rows.length === 0) {
    return NextResponse.json({ error: "No rows found in file" }, { status: 400 });
  }

  // Determine next version number
  const lastVersion = await prisma.agreementVersion.findFirst({
    where: { supplierId: supplier.id, organizationId: authorization.context.organizationId },
    orderBy: { versionNumber: "desc" },
    select: { versionNumber: true },
  });
  const versionNumber = (lastVersion?.versionNumber || 0) + 1;

  // Build item records from parsed rows
  let totalBaseValue = 0;
  let totalMarkedUpValue = 0;

  const itemRecords = rows.map((row, idx) => {
    const basePrice = Number(row.price) || 0;
    const markedUpPrice = markupPercent > 0
      ? Math.round(basePrice * (1 + markupPercent / 100) * 100) / 100
      : basePrice;
    totalBaseValue += basePrice;
    totalMarkedUpValue += markedUpPrice;

    return {
      lineNumber: idx + 1,
      offiNumber: row.offi_number || null,
      systemId: row.system_id || null,
      vendorPartNumber: row.vendor_part_number || null,
      description: row.description || "",
      basePrice,
      markedUpPrice,
      currency: row.currency || "EUR",
      unit: row.unit || null,
      moq: row.moq ? Number(row.moq) : null,
      leadTimeDays: row.lead_time_days ? Number(row.lead_time_days) : null,
      hsCode: row.hs_code || null,
      countryOfOrigin: row.country_of_origin || null,
      manufacturer: row.manufacturer || null,
    };
  });

  // Create version with items
  const version = await prisma.agreementVersion.create({
    data: {
      organizationId: authorization.context.organizationId,
      supplierId: supplier.id,
      supplierName: supplier.name,
      versionNumber,
      status: "Draft",
      markupPercent,
      totalBaseValue: Math.round(totalBaseValue * 100) / 100,
      totalMarkedUpValue: Math.round(totalMarkedUpValue * 100) / 100,
      currency: "EUR",
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
      markupPercent,
      validFrom: validFrom ? new Date(validFrom) : null,
      validTo: validTo ? new Date(validTo) : null,
    },
  );

  return NextResponse.json({
    version: { ...version, status: "Draft" },
    importSummary: {
      fileName,
      rowsParsed: rows.length,
      itemsCreated: itemRecords.length,
      mappedColumns,
      totalBaseValue: Math.round(totalBaseValue * 100) / 100,
      totalMarkedUpValue: Math.round(totalMarkedUpValue * 100) / 100,
    },
  }, { status: 201 });
}

async function findOrCreateSupplier(name: string, organizationId: string) {
  const existing = await prisma.supplier.findFirst({
    where: { organizationId, name: { equals: name, mode: "insensitive" } },
    select: { id: true, name: true },
  });
  if (existing) return existing;

  const supplierCode = await generateSupplierCode(organizationId);
  return prisma.supplier.create({
    data: {
      organizationId,
      supplierCode,
      name,
      region: "Unknown",
      categories: ["Trade Agreement"],
      portsCovered: [],
      sourceReferences: ["Agreement import"],
      score: 20,
      leadTimeDays: 0,
      status: "Active",
      enrichmentStatus: "None",
    },
    select: { id: true, name: true },
  });
}

async function generateSupplierCode(organizationId: string): Promise<string> {
  const last = await prisma.supplier.findFirst({
    where: { organizationId },
    orderBy: { supplierCode: "desc" },
    select: { supplierCode: true },
  });

  let next = 1;
  const match = last?.supplierCode?.match(/^SUP-(\d+)$/);
  if (match) next = Number(match[1]) + 1;
  return `SUP-${String(next).padStart(4, "0")}`;
}
