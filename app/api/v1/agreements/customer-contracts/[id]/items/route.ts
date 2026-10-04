import { authorizeCustomerContractRequest } from "@/lib/auth/entity-access";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { recalculateCustomerContractTotals } from "@/lib/agreements/customer-contracts";
import { validCurrency } from "@/lib/finance/calculations";

type Ctx = { params: Promise<{ id: string }> };

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

export async function POST(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const authorization = await authorizeCustomerContractRequest(req, id);
  if (!authorization.ok) return authorization.response;
  const body = await req.json();

  const contract = await prisma.customerContract.findUnique({
    where: { id },
    select: { id: true, markupPercent: true, currency: true },
  });
  if (!contract) {
    return NextResponse.json({ error: "Customer contract not found" }, { status: 404 });
  }

  const latest = await prisma.customerContractItem.findFirst({
    where: { contractId: id },
    orderBy: { lineNumber: "desc" },
    select: { lineNumber: true },
  });
  const lineNumber = (latest?.lineNumber || 0) + 1;
  const basePrice = Number(body.basePrice || 0);
  const markup = body.contractMarkupPercent !== undefined ? Number(body.contractMarkupPercent) : contract.markupPercent;
  const sellPrice = body.sellPrice !== undefined ? Number(body.sellPrice) : roundMoney(basePrice * (1 + markup / 100));
  const currency = body.currency === undefined ? contract.currency : body.currency;
  if (!validCurrency(currency) || currency !== contract.currency) return NextResponse.json({ error: "Use the contract currency for this item. Separate currencies require separate contracts." }, { status: 400 });
  if (![basePrice, markup, sellPrice].every(Number.isFinite) || basePrice < 0 || sellPrice < 0 || markup < 0 || markup > 1000) return NextResponse.json({ error: "Prices must be non-negative numbers and markup must be between 0 and 1000 percent." }, { status: 400 });
  for (const field of ["moq", "leadTimeDays"] as const) if (body[field] !== undefined && body[field] !== null && body[field] !== "" && (!Number.isInteger(Number(body[field])) || Number(body[field]) < 0)) return NextResponse.json({ error: `${field} must be a non-negative whole number.` }, { status: 400 });

  const item = await prisma.customerContractItem.create({
    data: {
      contractId: id,
      supplierId: body.supplierId || "manual",
      supplierName: body.supplierName || "Customer contract item",
      lineNumber,
      itemCode: body.itemCode || `NTX-${String(1000 + lineNumber).padStart(4, "0")}`,
      vendorPartNumber: body.vendorPartNumber || null,
      description: body.description || "New contract item",
      basePrice,
      contractMarkupPercent: markup,
      sellPrice,
      currency,
      unit: body.unit || null,
      moq: body.moq !== undefined && body.moq !== "" ? Number(body.moq) : null,
      leadTimeDays: body.leadTimeDays !== undefined && body.leadTimeDays !== "" ? Number(body.leadTimeDays) : null,
      hsCode: body.hsCode || null,
      countryOfOrigin: body.countryOfOrigin || null,
      manufacturer: body.manufacturer || null,
      status: body.status || "NeedsReview",
      reviewNote: body.reviewNote || "Manually added contract item requires review before customer release.",
    },
  });

  await prisma.customerContractAuditEvent.create({
    data: {
      contractId: id,
      action: "item_added",
      summary: `Contract item ${item.itemCode || item.lineNumber} added`,
      actor: "operator",
      metadata: { itemId: item.id },
    },
  });

  const updatedContract = await recalculateCustomerContractTotals(id);
  return NextResponse.json({ item, contract: updatedContract });
}
