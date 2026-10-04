import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createSimplePdf } from "@/lib/pdf/simple-pdf";
import { authorizeAgreementRequest } from "@/lib/auth/entity-access";
import { PERMISSIONS } from "@/lib/auth/permissions";

type Ctx = { params: Promise<{ id: string }> };

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

export async function GET(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const authorization = await authorizeAgreementRequest(req, id, PERMISSIONS.APP_READ);
  if (!authorization.ok) return authorization.response;
  if (!authorization.agreement) return NextResponse.json({ error: "Agreement not found" }, { status: 404 });
  const version = await prisma.agreementVersion.findFirst({
    where: { id, organizationId: authorization.context.organizationId },
    include: { items: { orderBy: { lineNumber: "asc" } } },
  });
  if (!version) {
    return NextResponse.json({ error: "Agreement not found" }, { status: 404 });
  }

  const lines = [
    { text: `Supplier: ${version.supplierName}`, bold: true, size: 11 },
    { text: `Version: v${version.versionNumber}    Status: ${version.status}    Markup: ${version.markupPercent}%`, size: 9 },
    { text: `Validity: ${date(version.validFrom)} to ${date(version.validTo)}    Currency: ${version.currency}`, size: 9 },
    { text: `Base value: ${money(version.totalBaseValue, version.currency)}    Sell value: ${money(version.totalMarkedUpValue, version.currency)}`, size: 9, gapAfter: 8 },
    { text: "Agreement Items", bold: true, size: 12, gapAfter: 4 },
    ...version.items.flatMap((item) => [
      {
        text: `${item.lineNumber}. ${itemCode(item.offiNumber, item.lineNumber)} | ${item.description}`,
        bold: true,
        size: 8,
      },
      {
        text: `Supplier P/N: ${item.vendorPartNumber || "-"} | Unit: ${item.unit || "-"} | Base: ${money(item.basePrice, item.currency)} | Sell: ${money(item.markedUpPrice, item.currency)} | HS: ${item.hsCode || "-"} | COO: ${item.countryOfOrigin || "-"}`,
        size: 8,
        gapAfter: 3,
      },
    ]),
  ];

  const buffer = createSimplePdf(`Nautex Supplier Agreement - ${version.supplierName}`, lines);
  const safeName = version.supplierName.replace(/[^a-z0-9]+/gi, "_").replace(/^_+|_+$/g, "");
  const fileName = `Nautex_Agreement_${safeName}_v${version.versionNumber}.pdf`;
  return new NextResponse(buffer, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Content-Length": String(buffer.length),
    },
  });
}
