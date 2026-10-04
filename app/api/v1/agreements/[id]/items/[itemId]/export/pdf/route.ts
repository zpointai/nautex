import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createSimplePdf } from "@/lib/pdf/simple-pdf";
import { authorizeAgreementRequest } from "@/lib/auth/entity-access";
import { PERMISSIONS } from "@/lib/auth/permissions";

type Ctx = { params: Promise<{ id: string; itemId: string }> };

function itemCode(offiNumber: string | null, lineNumber: number) {
  const raw = offiNumber?.trim();
  if (raw && /^OFFI[-_\s]?\d+$/i.test(raw)) {
    const suffix = raw.replace(/\D/g, "");
    return suffix ? `NTX-${suffix}` : `NTX-${String(1000 + lineNumber).padStart(4, "0")}`;
  }
  return raw || `NTX-${String(1000 + lineNumber).padStart(4, "0")}`;
}

function money(value: number | null | undefined, currency = "EUR") {
  return `${currency} ${Number(value || 0).toFixed(2)}`;
}

function date(value: Date | null) {
  if (!value) return "-";
  return value.toISOString().slice(0, 10);
}

function safeFilePart(value: string) {
  return value.replace(/[^a-z0-9]+/gi, "_").replace(/^_+|_+$/g, "").slice(0, 80) || "item";
}

export async function GET(req: NextRequest, ctx: Ctx) {
  const { id, itemId } = await ctx.params;
  const authorization = await authorizeAgreementRequest(req, id, PERMISSIONS.APP_READ);
  if (!authorization.ok) return authorization.response;
  if (!authorization.agreement) return NextResponse.json({ error: "Agreement version not found" }, { status: 404 });

  const item = await prisma.agreementItem.findFirst({
    where: { id: itemId, versionId: id },
    include: {
      version: {
        select: {
          supplierName: true,
          versionNumber: true,
          status: true,
          markupPercent: true,
          validFrom: true,
          validTo: true,
          currency: true,
        },
      },
    },
  });

  if (!item) {
    return NextResponse.json({ error: "Agreement item not found" }, { status: 404 });
  }

  const code = itemCode(item.offiNumber, item.lineNumber);
  const lines = [
    { text: `Supplier: ${item.version.supplierName}`, bold: true, size: 11 },
    { text: `Agreement version: v${item.version.versionNumber}    Status: ${item.version.status}    Markup: ${item.version.markupPercent}%`, size: 9 },
    { text: `Validity: ${date(item.version.validFrom)} to ${date(item.version.validTo)}    Currency: ${item.version.currency}`, size: 9, gapAfter: 8 },
    { text: `Item: ${code}`, bold: true, size: 12 },
    { text: `Line: ${item.lineNumber}    Vendor SKU: ${item.vendorPartNumber || "-"}    System ID: ${item.systemId || "-"}`, size: 9 },
    { text: `Description: ${item.description}`, size: 9, gapAfter: 4 },
    { text: `Base price: ${money(item.basePrice, item.currency)}    Sell price: ${money(item.markedUpPrice, item.currency)}`, size: 9 },
    { text: `Unit: ${item.unit || "-"}    MOQ: ${item.moq ?? "-"}    Lead time: ${item.leadTimeDays != null ? `${item.leadTimeDays} days` : "-"}`, size: 9 },
    { text: `HS code: ${item.hsCode || "-"}    Country of origin: ${item.countryOfOrigin || "-"}    COO confidence: ${item.cooConfidence || "-"}`, size: 9 },
    { text: `Manufacturer: ${item.manufacturer || "-"}`, size: 9 },
  ];

  const buffer = createSimplePdf(`Nautex Agreement Item - ${code}`, lines);
  const fileName = `Nautex_Agreement_Item_${safeFilePart(code)}_${safeFilePart(item.version.supplierName)}.pdf`;

  return new NextResponse(buffer, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Content-Length": String(buffer.length),
    },
  });
}
