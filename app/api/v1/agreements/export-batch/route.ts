/**
 * Batch Agreement Export API
 *
 * POST /api/v1/agreements/export-batch
 * Body: { versionIds: string[], markAsSent?: boolean }
 *
 * Adapted from SupplyChain Lens exportBatchAgreements.
 * Returns an Excel file with Summary + per-supplier sheets.
 */

import { NextRequest, NextResponse } from "next/server";
import { authorizeOrganizationRequest } from "@/lib/auth/authorization";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { prisma } from "@/lib/prisma";

function formatAgreementItemCode(offiNumber: string | null, lineNumber: number) {
  const raw = offiNumber?.trim();
  if (raw && /^OFFI[-_\s]?\d+$/i.test(raw)) {
    const suffix = raw.replace(/\D/g, "");
    return suffix ? `NTX-${suffix}` : `NTX-${String(1000 + lineNumber).padStart(4, "0")}`;
  }
  return raw || `NTX-${String(1000 + lineNumber).padStart(4, "0")}`;
}

export async function POST(req: NextRequest) {
  const authorization = await authorizeOrganizationRequest(req, PERMISSIONS.AGREEMENTS_WRITE);
  if (!authorization.ok) return authorization.response;

  const body = await req.json();
  const { versionIds, markAsSent = false } = body;

  if (!Array.isArray(versionIds) || versionIds.length === 0) {
    return NextResponse.json({ error: "versionIds array required" }, { status: 400 });
  }
  if (versionIds.length > 50) {
    return NextResponse.json({ error: "Maximum 50 agreements per batch" }, { status: 400 });
  }

  // Fetch all versions with items
  const versions = await prisma.agreementVersion.findMany({
    where: { id: { in: versionIds }, organizationId: authorization.context.organizationId },
    include: { items: { orderBy: { lineNumber: "asc" } } },
  });

  if (versions.length === 0) {
    return NextResponse.json({ error: "No versions found" }, { status: 404 });
  }

  const XLSX = await import("xlsx");
  const wb = XLSX.utils.book_new();

  const formatDate = (d: Date | null) => {
    if (!d) return "";
    return `${String(d.getDate()).padStart(2, "0")}-${String(d.getMonth() + 1).padStart(2, "0")}-${d.getFullYear()}`;
  };

  // Summary sheet
  let grandTotalBase = 0;
  let grandTotalMarkup = 0;
  let grandTotalItems = 0;

  const summaryData = versions.map((v) => {
    const baseVal = v.totalBaseValue || 0;
    const markupVal = v.totalMarkedUpValue || 0;
    const itemCount = v.items.length;
    grandTotalBase += baseVal;
    grandTotalMarkup += markupVal;
    grandTotalItems += itemCount;

    return {
      "Supplier": v.supplierName,
      "Items": itemCount,
      "Markup %": v.markupPercent || 0,
      "Base Value (EUR)": Math.round(baseVal * 100) / 100,
      "Marked-Up Value (EUR)": Math.round(markupVal * 100) / 100,
      "Difference (EUR)": Math.round((markupVal - baseVal) * 100) / 100,
      "Valid From": formatDate(v.validFrom),
      "Valid To": formatDate(v.validTo),
      "Created": formatDate(v.createdAt),
    };
  });

  summaryData.push({
    "Supplier": "TOTALS",
    "Items": grandTotalItems,
    "Markup %": 0,
    "Base Value (EUR)": Math.round(grandTotalBase * 100) / 100,
    "Marked-Up Value (EUR)": Math.round(grandTotalMarkup * 100) / 100,
    "Difference (EUR)": Math.round((grandTotalMarkup - grandTotalBase) * 100) / 100,
    "Valid From": "",
    "Valid To": "",
    "Created": "",
  });

  const summarySheet = XLSX.utils.json_to_sheet(summaryData);
  summarySheet["!cols"] = [
    { wch: 32 }, { wch: 8 }, { wch: 10 },
    { wch: 18 }, { wch: 22 }, { wch: 18 },
    { wch: 14 }, { wch: 14 }, { wch: 14 },
  ];
  XLSX.utils.book_append_sheet(wb, summarySheet, "Summary");

  // Per-supplier sheets
  const usedNames = new Set(["Summary"]);

  for (const v of versions) {
    const sheetRows = v.items.map((item) => ({
      "Nautex Item Code": formatAgreementItemCode(item.offiNumber, item.lineNumber),
      "System ID (CSI)": item.systemId || "",
      "Vendor P/N": item.vendorPartNumber || "",
      "Manufacturer": item.manufacturer || "",
      "Description": item.description || "",
      "Unit": item.unit || "",
      "MOQ": item.moq || "",
      "Currency": item.currency || "EUR",
      "Base Price": Math.round((item.basePrice || 0) * 100) / 100,
      "Markup %": v.markupPercent || 0,
      "Marked-Up Price": Math.round((item.markedUpPrice || 0) * 100) / 100,
      "Lead Time": item.leadTimeDays ? `${item.leadTimeDays}d` : "",
      "HS Code": item.hsCode || "",
      "Origin": item.countryOfOrigin || "",
    }));

    const totalBase = v.items.reduce((s, i) => s + (i.basePrice || 0), 0);
    const totalMarkup = v.items.reduce((s, i) => s + (i.markedUpPrice || 0), 0);
    sheetRows.push({
      "Nautex Item Code": "", "System ID (CSI)": "", "Vendor P/N": "", "Manufacturer": "",
      "Description": `TOTAL (${v.items.length} items)`,
      "Unit": "", "MOQ": "" as unknown as number, "Currency": "",
      "Base Price": Math.round(totalBase * 100) / 100,
      "Markup %": "" as unknown as number,
      "Marked-Up Price": Math.round(totalMarkup * 100) / 100,
      "Lead Time": "", "HS Code": "", "Origin": "",
    });

    const ws = XLSX.utils.json_to_sheet(sheetRows);
    ws["!cols"] = [
      { wch: 16 }, { wch: 14 }, { wch: 16 }, { wch: 22 },
      { wch: 45 }, { wch: 6 }, { wch: 6 }, { wch: 8 },
      { wch: 14 }, { wch: 10 }, { wch: 18 }, { wch: 10 },
      { wch: 12 }, { wch: 8 },
    ];

    let baseName = v.supplierName.replace(/[\\/?*[\]:]/g, "").substring(0, 28);
    let sheetName = baseName;
    let counter = 1;
    while (usedNames.has(sheetName)) {
      sheetName = `${baseName}_${counter}`;
      counter++;
    }
    usedNames.add(sheetName);
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
  }

  const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

  const now = new Date();
  const dateStr = `${String(now.getDate()).padStart(2, "0")}-${String(now.getMonth() + 1).padStart(2, "0")}-${now.getFullYear()}`;
  const timeStr = `${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}`;
  const fileName = `Agreement_Batch_${dateStr}_${timeStr}.xlsx`;

  // Mark as sent if requested
  if (markAsSent) {
    await prisma.agreementVersion.updateMany({
      where: {
        id: { in: versions.map((version) => version.id) },
        organizationId: authorization.context.organizationId,
        status: "Draft",
      },
      data: { status: "Sent", sentAt: new Date(), exportedFileName: fileName },
    });
  }

  return new NextResponse(buffer, {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Content-Length": String(buffer.length),
    },
  });
}
