import { authorizeCustomerContractRequest } from "@/lib/auth/entity-access";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { recalculateCustomerContractTotals } from "@/lib/agreements/customer-contracts";
import { validCurrency } from "@/lib/finance/calculations";

type Ctx = { params: Promise<{ id: string; itemId: string }> };

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

export async function PATCH(req: NextRequest, ctx: Ctx) {
  const { id, itemId } = await ctx.params;
  const authorization = await authorizeCustomerContractRequest(req, id);
  if (!authorization.ok) return authorization.response;
  const body = await req.json();

  const existing = await prisma.customerContractItem.findFirst({
    where: { id: itemId, contractId: id },
  });
  if (!existing) {
    return NextResponse.json({ error: "Contract item not found" }, { status: 404 });
  }

  const basePrice = body.basePrice !== undefined ? Number(body.basePrice) : existing.basePrice;
  const markup = body.contractMarkupPercent !== undefined ? Number(body.contractMarkupPercent) : existing.contractMarkupPercent;
  const sellPrice = body.sellPrice !== undefined ? Number(body.sellPrice) : roundMoney(basePrice * (1 + markup / 100));
  const parent = await prisma.customerContract.findUniqueOrThrow({ where: { id }, select: { currency: true } });
  const currency = body.currency === undefined ? existing.currency : body.currency;
  if (!validCurrency(currency) || currency !== parent.currency) return NextResponse.json({ error: "Use the contract currency for this item. Separate currencies require separate contracts." }, { status: 400 });

  if (![basePrice, markup, sellPrice].every(Number.isFinite) || basePrice < 0 || sellPrice < 0 || markup < 0 || markup > 1000) {
    return NextResponse.json({ error: "Prices must be non-negative numbers and markup must be between 0 and 1000 percent." }, { status: 400 });
  }
  for (const field of ["moq", "leadTimeDays"] as const) {
    if (body[field] !== undefined && body[field] !== null && body[field] !== "" && (!Number.isInteger(Number(body[field])) || Number(body[field]) < 0)) {
      return NextResponse.json({ error: `${field} must be a non-negative whole number.` }, { status: 400 });
    }
  }

  const item = await prisma.customerContractItem.update({
    where: { id: itemId },
    data: {
      ...(body.itemCode !== undefined && { itemCode: body.itemCode || null }),
      ...(body.vendorPartNumber !== undefined && { vendorPartNumber: body.vendorPartNumber || null }),
      ...(body.description !== undefined && { description: body.description || existing.description }),
      ...(body.supplierName !== undefined && { supplierName: body.supplierName || existing.supplierName }),
      ...(body.basePrice !== undefined && { basePrice }),
      ...(body.contractMarkupPercent !== undefined && { contractMarkupPercent: markup }),
      ...(body.sellPrice !== undefined || body.basePrice !== undefined || body.contractMarkupPercent !== undefined ? { sellPrice } : {}),
      ...(body.currency !== undefined && { currency: body.currency || existing.currency }),
      ...(body.unit !== undefined && { unit: body.unit || null }),
      ...(body.moq !== undefined && { moq: body.moq !== "" && body.moq !== null ? Number(body.moq) : null }),
      ...(body.leadTimeDays !== undefined && { leadTimeDays: body.leadTimeDays !== "" && body.leadTimeDays !== null ? Number(body.leadTimeDays) : null }),
      ...(body.hsCode !== undefined && { hsCode: body.hsCode || null }),
      ...(body.countryOfOrigin !== undefined && { countryOfOrigin: body.countryOfOrigin || null }),
      ...(body.manufacturer !== undefined && { manufacturer: body.manufacturer || null }),
      ...(body.status !== undefined && { status: body.status }),
      ...(body.reviewNote !== undefined && { reviewNote: body.reviewNote || null }),
    },
  });

  await prisma.customerContractAuditEvent.create({
    data: {
      contractId: id,
      action: "item_updated",
      summary: `Contract item ${item.itemCode || item.lineNumber} updated`,
      actor: "operator",
      metadata: { itemId: item.id, changedFields: Object.keys(body) },
    },
  });

  const contract = await recalculateCustomerContractTotals(id);
  return NextResponse.json({ item, contract });
}

export async function DELETE(_req: NextRequest, ctx: Ctx) {
  const { id, itemId } = await ctx.params;
  const authorization = await authorizeCustomerContractRequest(_req, id);
  if (!authorization.ok) return authorization.response;
  const existing = await prisma.customerContractItem.findFirst({
    where: { id: itemId, contractId: id },
  });
  if (!existing) {
    return NextResponse.json({ error: "Contract item not found" }, { status: 404 });
  }

  await prisma.customerContractItem.delete({ where: { id: itemId } });
  await prisma.customerContractAuditEvent.create({
    data: {
      contractId: id,
      action: "item_deleted",
      summary: `Contract item ${existing.itemCode || existing.lineNumber} deleted`,
      actor: "operator",
      metadata: { itemId },
    },
  });

  const contract = await recalculateCustomerContractTotals(id);
  return NextResponse.json({ deleted: true, contract });
}
