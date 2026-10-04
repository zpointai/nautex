import { authorizeCustomerContractRequest } from "@/lib/auth/entity-access";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createSimplePdf } from "@/lib/pdf/simple-pdf";
import { customerContractDetailInclude } from "@/lib/agreements/customer-contracts";

type Ctx = { params: Promise<{ id: string }> };

function money(value: number | null | undefined, currency = "EUR") {
  return `${currency} ${Number(value || 0).toFixed(2)}`;
}

function date(value: Date | null) {
  if (!value) return "-";
  return value.toISOString().slice(0, 10);
}

export async function GET(_req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const authorization = await authorizeCustomerContractRequest(_req, id);
  if (!authorization.ok) return authorization.response;
  const contract = await prisma.customerContract.findUnique({
    where: { id },
    include: customerContractDetailInclude,
  });
  if (!contract) {
    return NextResponse.json({ error: "Customer contract not found" }, { status: 404 });
  }

  const activeItems = contract.items.filter((item) => item.status !== "Excluded");
  const gross = contract.totalSellValue - contract.totalBaseValue;
  const lines = [
    { text: `Contract number: ${contract.contractNumber}`, bold: true, size: 11 },
    { text: `Customer: ${contract.shippingCompanyName}    Status: ${contract.status}`, size: 9 },
    { text: `Title: ${contract.title}`, size: 9 },
    { text: `Validity: ${date(contract.validFrom)} to ${date(contract.validTo)}    Markup: ${contract.markupPercent}%`, size: 9 },
    { text: `Payment terms: ${contract.paymentTerms || "-"}    Delivery terms: ${contract.deliveryTerms || "-"}`, size: 9 },
    { text: `Base value: ${money(contract.totalBaseValue, contract.currency)}    Sell value: ${money(contract.totalSellValue, contract.currency)}    Gross: ${money(gross, contract.currency)}`, size: 9, gapAfter: 8 },
    { text: "Linked Supplier Agreements", bold: true, size: 12 },
    ...contract.sourceAgreements.map((source) => ({
      text: `- ${source.supplierName} | v${source.agreementVersion?.versionNumber || "-"} | ${source.includedItemCount} item(s)`,
      size: 8,
    })),
    { text: "Contract Items", bold: true, size: 12, gapAfter: 4 },
    ...activeItems.flatMap((item) => [
      { text: `${item.lineNumber}. ${item.itemCode || "-"} | ${item.description}`, bold: true, size: 8 },
      {
        text: `Supplier: ${item.supplierName} | Base: ${money(item.basePrice, item.currency)} | Sell: ${money(item.sellPrice, item.currency)} | Unit: ${item.unit || "-"} | HS: ${item.hsCode || "-"} | COO: ${item.countryOfOrigin || "-"} | Status: ${item.status}`,
        size: 8,
        gapAfter: 3,
      },
    ]),
  ];

  const buffer = createSimplePdf(`Nautex Customer Contract - ${contract.contractNumber}`, lines);
  const fileName = `Nautex_Customer_Contract_${contract.contractNumber}.pdf`;
  return new NextResponse(buffer, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Content-Length": String(buffer.length),
    },
  });
}
