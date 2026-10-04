/**
 * Single Agreement Export API
 *
 * GET /api/v1/agreements/:id/export  — export as XLSX
 * Query: ?markAsSent=true to update status to Sent
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authorizeAgreementRequest } from "@/lib/auth/entity-access";
import { PERMISSIONS } from "@/lib/auth/permissions";

type Ctx = { params: Promise<{ id: string }> };

function formatAgreementItemCode(offiNumber: string | null, lineNumber: number) {
  const raw = offiNumber?.trim();
  if (raw && /^OFFI[-_\s]?\d+$/i.test(raw)) {
    const suffix = raw.replace(/\D/g, "");
    return suffix ? `NTX-${suffix}` : `NTX-${String(1000 + lineNumber).padStart(4, "0")}`;
  }
  return raw || `NTX-${String(1000 + lineNumber).padStart(4, "0")}`;
}

export async function GET(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const authorization = await authorizeAgreementRequest(req, id, PERMISSIONS.APP_READ);
  if (!authorization.ok) return authorization.response;
  if (!authorization.agreement) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const markAsSent = req.nextUrl.searchParams.get("markAsSent") === "true";

  const version = await prisma.agreementVersion.findFirst({
    where: { id, organizationId: authorization.context.organizationId },
    include: { items: { orderBy: { lineNumber: "asc" } } },
  });
  if (!version) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const XLSX = await import("xlsx");
  const wb = XLSX.utils.book_new();

  const formatDate = (d: Date | null) => {
    if (!d) return "";
    return `${String(d.getDate()).padStart(2, "0")}-${String(d.getMonth() + 1).padStart(2, "0")}-${d.getFullYear()}`;
  };

  // Items sheet
  const sheetData = version.items.map((item) => ({
    "Nautex Item Code": formatAgreementItemCode(item.offiNumber, item.lineNumber),
    "System ID (CSI)": item.systemId || "",
    "Vendor P/N": item.vendorPartNumber || "",
    "Manufacturer": item.manufacturer || "",
    "Description": item.description || "",
    "Unit": item.unit || "",
    "MOQ": item.moq || "",
    "Currency": item.currency || "EUR",
    "Base Price": Math.round((item.basePrice || 0) * 100) / 100,
    "Markup %": version.markupPercent || 0,
    "Marked-Up Price": Math.round((item.markedUpPrice || 0) * 100) / 100,
    "Lead Time": item.leadTimeDays ? `${item.leadTimeDays}d` : "",
    "HS Code": item.hsCode || "",
    "Origin": item.countryOfOrigin || "",
  }));

  // Totals row
  const totalBase = version.items.reduce((s, i) => s + (i.basePrice || 0), 0);
  const totalMarkup = version.items.reduce((s, i) => s + (i.markedUpPrice || 0), 0);
  sheetData.push({
    "Nautex Item Code": "",
    "System ID (CSI)": "",
    "Vendor P/N": "",
    "Manufacturer": "",
    "Description": `TOTAL (${version.items.length} items)`,
    "Unit": "",
    "MOQ": "",
    "Currency": "",
    "Base Price": Math.round(totalBase * 100) / 100,
    "Markup %": "" as unknown as number,
    "Marked-Up Price": Math.round(totalMarkup * 100) / 100,
    "Lead Time": "",
    "HS Code": "",
    "Origin": "",
  });

  const ws = XLSX.utils.json_to_sheet(sheetData);
  ws["!cols"] = [
    { wch: 16 }, { wch: 14 }, { wch: 16 }, { wch: 22 },
    { wch: 45 }, { wch: 6 }, { wch: 6 }, { wch: 8 },
    { wch: 14 }, { wch: 10 }, { wch: 18 }, { wch: 10 },
    { wch: 12 }, { wch: 8 },
  ];

  const sheetName = version.supplierName.replace(/[\\/?*[\]:]/g, "").substring(0, 31);
  XLSX.utils.book_append_sheet(wb, ws, sheetName);

  const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

  // Build filename
  const now = new Date();
  const dateStr = `${String(now.getDate()).padStart(2, "0")}-${String(now.getMonth() + 1).padStart(2, "0")}-${now.getFullYear()}`;
  const safeName = version.supplierName.replace(/[^a-zA-Z0-9]/g, "_").substring(0, 30);
  const fileName = `Agreement_${safeName}_v${version.versionNumber}_${dateStr}.xlsx`;

  // Mark as sent if requested
  if (markAsSent && version.status === "Draft") {
    await prisma.agreementVersion.update({
      where: { id },
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
