import { authorizeCustomerContractRequest } from "@/lib/auth/entity-access";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { customerContractDetailInclude } from "@/lib/agreements/customer-contracts";

type Ctx = { params: Promise<{ id: string }> };

function date(value: Date | null) {
  if (!value) return "";
  return `${String(value.getDate()).padStart(2, "0")}-${String(value.getMonth() + 1).padStart(2, "0")}-${value.getFullYear()}`;
}

function safeSheetName(value: string, used: Set<string>) {
  const base = (value || "Supplier").replace(/[\\/?*[\]:]/g, "").substring(0, 28) || "Supplier";
  let name = base;
  let counter = 1;
  while (used.has(name)) {
    name = `${base.substring(0, 25)}_${counter}`;
    counter++;
  }
  used.add(name);
  return name;
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

  const XLSX = await import("xlsx");
  const wb = XLSX.utils.book_new();
  const activeItems = contract.items.filter((item) => item.status !== "Excluded");
  const gross = contract.totalSellValue - contract.totalBaseValue;

  const summaryRows = [
    { Field: "Contract Number", Value: contract.contractNumber },
    { Field: "Shipping Company", Value: contract.shippingCompanyName },
    { Field: "Title", Value: contract.title },
    { Field: "Status", Value: contract.status },
    { Field: "Markup %", Value: contract.markupPercent },
    { Field: "Valid From", Value: date(contract.validFrom) },
    { Field: "Valid To", Value: date(contract.validTo) },
    { Field: "Payment Terms", Value: contract.paymentTerms || "" },
    { Field: "Delivery Terms", Value: contract.deliveryTerms || "" },
    { Field: "Base Value", Value: Math.round(contract.totalBaseValue * 100) / 100 },
    { Field: "Sell Value", Value: Math.round(contract.totalSellValue * 100) / 100 },
    { Field: "Gross Margin", Value: Math.round(gross * 100) / 100 },
    { Field: "Items", Value: activeItems.length },
  ];
  const summarySheet = XLSX.utils.json_to_sheet(summaryRows);
  summarySheet["!cols"] = [{ wch: 24 }, { wch: 60 }];
  XLSX.utils.book_append_sheet(wb, summarySheet, "Summary");

  const usedNames = new Set(["Summary"]);
  const suppliers = [...new Set(activeItems.map((item) => item.supplierName || "Supplier"))].sort();

  for (const supplier of suppliers) {
    const supplierItems = activeItems.filter((item) => (item.supplierName || "Supplier") === supplier);
    const rows: Array<Record<string, string | number>> = supplierItems.map((item) => ({
      "Line": item.lineNumber,
      "Item Code": item.itemCode || "",
      "Vendor P/N": item.vendorPartNumber || "",
      "Description": item.description,
      "Unit": item.unit || "",
      "MOQ": item.moq ?? "",
      "Currency": item.currency || contract.currency,
      "Base Price": Math.round((item.basePrice || 0) * 100) / 100,
      "Contract Markup %": item.contractMarkupPercent,
      "Sell Price": Math.round((item.sellPrice || 0) * 100) / 100,
      "Lead Time Days": item.leadTimeDays ?? "",
      "HS Code": item.hsCode || "",
      "Country of Origin": item.countryOfOrigin || "",
      "Manufacturer": item.manufacturer || "",
      "Status": item.status,
    }));

    rows.push({
      "Line": "",
      "Item Code": "",
      "Vendor P/N": "",
      "Description": `TOTAL (${supplierItems.length} items)`,
      "Unit": "",
      "MOQ": "",
      "Currency": "",
      "Base Price": Math.round(supplierItems.reduce((sum, item) => sum + (item.basePrice || 0), 0) * 100) / 100,
      "Contract Markup %": "",
      "Sell Price": Math.round(supplierItems.reduce((sum, item) => sum + (item.sellPrice || 0), 0) * 100) / 100,
      "Lead Time Days": "",
      "HS Code": "",
      "Country of Origin": "",
      "Manufacturer": "",
      "Status": "",
    });

    const sheet = XLSX.utils.json_to_sheet(rows);
    sheet["!cols"] = [
      { wch: 8 }, { wch: 16 }, { wch: 16 }, { wch: 48 }, { wch: 8 },
      { wch: 8 }, { wch: 10 }, { wch: 14 }, { wch: 16 }, { wch: 14 },
      { wch: 14 }, { wch: 12 }, { wch: 16 }, { wch: 24 }, { wch: 12 },
    ];
    XLSX.utils.book_append_sheet(wb, sheet, safeSheetName(supplier, usedNames));
  }

  const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  const fileName = `Nautex_Customer_Contract_${contract.contractNumber}.xlsx`;

  return new NextResponse(buffer, {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Content-Length": String(buffer.length),
    },
  });
}
