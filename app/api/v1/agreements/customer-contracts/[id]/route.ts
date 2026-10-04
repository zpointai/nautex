import { authorizeCustomerContractRequest } from "@/lib/auth/entity-access";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  customerContractDetailInclude,
  updateCustomerContract,
} from "@/lib/agreements/customer-contracts";

type Ctx = { params: Promise<{ id: string }> };

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
  return NextResponse.json({ contract });
}

export async function PATCH(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const authorization = await authorizeCustomerContractRequest(req, id);
  if (!authorization.ok) return authorization.response;
  const body = await req.json();

  try {
    const contract = await updateCustomerContract(id, {
      title: body.title,
      status: body.status,
      markupPercent: body.markupPercent,
      validFrom: body.validFrom,
      validTo: body.validTo,
      paymentTerms: body.paymentTerms,
      deliveryTerms: body.deliveryTerms,
      notes: body.notes,
      agreementVersionIds: body.agreementVersionIds,
    });
    return NextResponse.json({ contract });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to update contract";
    return NextResponse.json({ error: message }, { status: message.includes("not found") ? 404 : 400 });
  }
}

export async function DELETE(_req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const authorization = await authorizeCustomerContractRequest(_req, id);
  if (!authorization.ok) return authorization.response;
  const existing = await prisma.customerContract.findUnique({
    where: { id },
    select: { status: true },
  });
  if (!existing) {
    return NextResponse.json({ error: "Customer contract not found" }, { status: 404 });
  }
  if (existing.status === "Active") {
    return NextResponse.json({ error: "Active contracts must be archived before deletion" }, { status: 400 });
  }
  await prisma.customerContract.delete({ where: { id } });
  return NextResponse.json({ success: true });
}
